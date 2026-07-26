"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  fetchPoDocData,
  openWindowNow,
  showBlob,
  SENT_VIA_FOR_ORDER_TYPE,
} from "@/lib/poProcessing";
import {
  money,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  type PoStatus,
} from "@/lib/purchaseOrders";
import {
  poDetailHref,
  poFiltersToQuery,
  poListHref,
  RANGES,
  type PoFilters,
  type PoSortKey,
  type RangeKey,
  type StatusFilter,
} from "@/lib/poFilters";
import { makeComparator, type SortValue } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { Checkbox } from "@/components/ui/Checkbox";
import type { PoListRow } from "@/app/(app)/purchase-orders/page";

function sortValue(po: PoListRow, key: PoSortKey): SortValue {
  switch (key) {
    case "po_number":
      return po.po_number;
    case "order_date":
      return po.order_date;
    case "vendor":
      return po.vendors?.name ?? null;
    case "status":
      return PO_STATUS_ORDER.indexOf(po.status);
    case "lines":
      return po.line_count;
    case "total":
      return po.ordered_total;
  }
}

/**
 * The PO list — the Monday workflow surface (spec §4.8): status at a glance,
 * a totals row, and selection for the batch operations that follow once PDF
 * generation exists.
 */
export function PurchaseOrderList({
  orders,
  initialFilters,
  activeLocationCode,
  capped,
}: {
  orders: PoListRow[];
  initialFilters: PoFilters;
  activeLocationCode: string;
  capped: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [filters, setFilters] = useState<PoFilters>(initialFilters);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  function update(patch: Partial<PoFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = poFiltersToQuery(next);
    window.history.replaceState(
      null,
      "",
      query ? `/purchase-orders?${query}` : "/purchase-orders"
    );
  }

  // The date window is a server filter, so changing it must re-run the page —
  // router.push, not the replaceState the other filters use.
  function setRange(range: RangeKey) {
    router.push(poListHref({ ...filters, range }));
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const po of orders) counts[po.status] = (counts[po.status] ?? 0) + 1;
    return counts;
  }, [orders]);

  const visible = useMemo(() => {
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return orders.filter((po) => {
      if (filters.status !== "all" && po.status !== filters.status) return false;
      if (words.length === 0) return true;
      const haystack = `${po.po_number} ${po.vendors?.name ?? ""} ${po.status}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [orders, filters.status, filters.q]);

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<PoListRow>({
          value: (po) => sortValue(po, filters.sort),
          dir: filters.dir,
          tiebreaks: [(po) => po.po_number],
        })
      ),
    [visible, filters.sort, filters.dir]
  );

  const pageTotal = useMemo(
    () => visible.reduce((sum, po) => sum + po.ordered_total, 0),
    [visible]
  );
  const selectedTotal = useMemo(
    () =>
      visible
        .filter((po) => checked.has(po.id))
        .reduce((sum, po) => sum + po.ordered_total, 0),
    [visible, checked]
  );

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedDrafts = useMemo(
    () => orders.filter((po) => checked.has(po.id) && po.status === "draft"),
    [orders, checked]
  );

  /** One PDF for the whole selection — a page run per PO (spec §4.8's batch
   *  preview / shopping-list modes). Opened, not downloaded: batch output is
   *  for reading or printing, and the per-PO email flow does its own download. */
  async function batchPdf(kind: "po" | "shopping") {
    // Opened before any await, while the click gesture still counts — a popup
    // opened after async work is silently blocked.
    const win = openWindowNow();
    setBatchBusy(kind);
    setBatchError(null);
    try {
      const [{ pdf }, docs, { org, pos }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./pdf/PoPdfDocs"),
        fetchPoDocData(supabase, [...checked]),
      ]);
      pos.sort((a, b) => a.po_number.localeCompare(b.po_number, undefined, { numeric: true }));
      const Doc = kind === "po" ? docs.PoPdf : docs.ShoppingListPdf;
      const blob = await pdf(<Doc pos={pos} org={org} />).toBlob();
      const name =
        kind === "po"
          ? `POs ${pos.map((p) => p.po_number).join(", ")}.pdf`
          : `Shopping lists ${pos.map((p) => p.po_number).join(", ")}.pdf`;
      showBlob(win, blob, name);
    } catch (e) {
      win?.close();
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /**
   * Delete the selection, PO lines cascading with their orders. Drafts are
   * the expected case; anything already sent/received is order HISTORY (and
   * feeds "last ordered"), so the confirm names those separately before
   * anything irreversible happens.
   */
  async function batchDelete() {
    const selected = orders.filter((po) => checked.has(po.id));
    const nonDraft = selected.filter((po) => po.status !== "draft");
    const message =
      `Delete ${selected.length} purchase order${selected.length === 1 ? "" : "s"}` +
      ` and ${selected.length === 1 ? "its" : "their"} lines?` +
      (nonDraft.length > 0
        ? `\n\nWARNING: ${nonDraft.length} of them ${
            nonDraft.length === 1 ? "is" : "are"
          } not a draft (${[...new Set(nonDraft.map((po) => po.status))].join(", ")}).` +
          " Deleting sent or received orders erases order history permanently."
        : "\n\nThis cannot be undone.");
    if (!window.confirm(message)) return;

    setBatchBusy("delete");
    setBatchError(null);
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .delete()
        .in("id", [...checked]);
      if (error) throw new Error(error.message);
      setChecked(new Set());
      router.refresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /** Drafts only — sent_via comes from each vendor's order type. */
  async function batchMarkSent() {
    setBatchBusy("sent");
    setBatchError(null);
    try {
      const byVia = new Map<string, string[]>();
      for (const po of selectedDrafts) {
        const via = SENT_VIA_FOR_ORDER_TYPE[po.vendors?.order_type ?? "none"] ?? "print";
        byVia.set(via, [...(byVia.get(via) ?? []), po.id]);
      }
      for (const [via, ids] of byVia) {
        const { error } = await supabase
          .from("purchase_orders")
          .update({ status: "sent", sent_via: via })
          .in("id", ids);
        if (error) throw new Error(error.message);
      }
      setChecked(new Set());
      router.refresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  const allVisibleChecked =
    sorted.length > 0 && sorted.every((po) => checked.has(po.id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) sorted.forEach((po) => next.delete(po.id));
      else sorted.forEach((po) => next.add(po.id));
      return next;
    });
  }

  const columns: DataColumn<PoListRow>[] = [
    {
      key: "select",
      label: "",
      width: 48,
      render: (po) => (
        <Checkbox
          checked={checked.has(po.id)}
          onChange={() => toggleOne(po.id)}
          label={`select ${po.po_number}`}
          size={18}
        />
      ),
    },
    {
      key: "po_number",
      label: "PO number",
      width: 170,
      sortValue: (po) => po.po_number,
      render: (po) => (
        <Link
          href={poDetailHref(po.id, filters)}
          className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          {po.po_number}
        </Link>
      ),
    },
    {
      key: "order_date",
      label: "Ordered",
      width: 130,
      sortValue: (po) => po.order_date,
      render: (po) => <span className="tabular-nums text-muted">{po.order_date}</span>,
    },
    {
      key: "vendor",
      label: "Vendor",
      width: 240,
      sortValue: (po) => po.vendors?.name ?? null,
      render: (po) =>
        po.vendors ? (
          <Link
            href={withFrom(`/vendors/${po.vendors.id}`, {
              href: poListHref(filters),
              label: "POs",
            })}
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            {po.vendors.name}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (po) => PO_STATUS_ORDER.indexOf(po.status),
      render: (po) => (
        <span
          className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[po.status]}`}
        >
          {PO_STATUS_LABEL[po.status]}
        </span>
      ),
    },
    {
      key: "sent_via",
      label: "Sent via",
      width: 120,
      sortValue: (po) => po.sent_via,
      render: (po) => <span className="text-muted">{po.sent_via ?? "—"}</span>,
    },
    {
      key: "delivery_date",
      label: "Delivery",
      width: 130,
      sortValue: (po) => po.delivery_date,
      render: (po) => (
        <span className="tabular-nums text-muted">{po.delivery_date ?? "—"}</span>
      ),
    },
    {
      key: "lines",
      label: "Lines",
      width: 85,
      align: "right",
      sortValue: (po) => po.line_count,
      render: (po) => <span className="text-muted">{po.line_count}</span>,
    },
    {
      key: "total",
      label: "Ordered",
      width: 130,
      align: "right",
      sortValue: (po) => po.ordered_total,
      render: (po) => <span className="text-body">{money(po.ordered_total)}</span>,
    },
    {
      key: "received_total",
      label: "Received",
      width: 130,
      align: "right",
      sortValue: (po) => po.received_total,
      render: (po) => (
        <span
          className={
            // A received total short of what was ordered is the signal worth
            // catching on this screen.
            po.status === "received" && po.received_total < po.ordered_total - 0.005
              ? "font-semibold text-accent"
              : "text-muted"
          }
        >
          {money(po.received_total)}
        </span>
      ),
    },
  ];

  const statusTabs: StatusFilter[] = [
    "all",
    ...PO_STATUS_ORDER.filter((s) => (statusCounts[s] ?? 0) > 0),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Purchase Orders
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {activeLocationCode} · {visible.length} of {orders.length} orders
          </p>
        </div>
        {/* The window total as a Statistic: small-caps label over the figure. */}
        <div className="ml-auto text-right">
          <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Window total
          </div>
          <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
            {money(pageTotal)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search PO number or vendor…"
          className="h-9 w-64 border border-ink px-3 text-sm outline-none focus:border-2"
        />

        {/* Status tabs: an underline marker, not a fill — they scope the view. */}
        <div className="flex items-center gap-4 text-[12px] font-semibold uppercase tracking-[0.06em]">
          {statusTabs.map((s) => (
            <button
              key={s}
              onClick={() => update({ status: s })}
              className={`border-b-2 px-1 pb-0.5 ${
                filters.status === s
                  ? "border-ink text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {s === "all" ? "All" : PO_STATUS_LABEL[s as PoStatus]}
              <span className="ml-1.5 font-normal tabular-nums text-faint">
                {s === "all" ? orders.length : statusCounts[s] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4 text-[12px] font-semibold uppercase tracking-[0.06em]">
          <span className="font-normal tracking-[0.12em] text-subtle">Window</span>
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`border-b-2 px-1 pb-0.5 ${
                filters.range === r.key
                  ? "border-ink text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {capped && (
        <p className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
          Showing the 500 most recent orders in this window — narrow the window
          to see everything in it.
        </p>
      )}

      {checked.size > 0 && (
        <div className="space-y-1 border border-ink px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span>{checked.size} selected</span>
            <span className="tabular-nums text-muted">{money(selectedTotal)}</span>

            {/* Batch preview (spec §4.8): every selected PO as one PDF, a page
                run per order, opened for reading or printing. */}
            <button
              disabled={batchBusy !== null}
              onClick={() => batchPdf("po")}
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "po" ? "Rendering…" : "PO PDFs"}
            </button>
            <button
              disabled={batchBusy !== null}
              onClick={() => batchPdf("shopping")}
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "shopping" ? "Rendering…" : "Shopping lists"}
            </button>
            <button
              disabled={batchBusy !== null || selectedDrafts.length === 0}
              onClick={batchMarkSent}
              title={
                selectedDrafts.length === 0
                  ? "No drafts selected — only drafts can be marked sent"
                  : `Marks ${selectedDrafts.length} draft${
                      selectedDrafts.length === 1 ? "" : "s"
                    } sent, sent_via from each vendor's order type`
              }
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {batchBusy === "sent"
                ? "Saving…"
                : `Mark sent (${selectedDrafts.length})`}
            </button>

            {/* Danger inverts red on hover — same move, different meaning. */}
            <button
              disabled={batchBusy !== null}
              onClick={batchDelete}
              className="h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
            >
              {batchBusy === "delete" ? "Deleting…" : "Delete"}
            </button>

            <button
              onClick={() => setChecked(new Set())}
              className="ml-auto text-muted underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              Clear
            </button>
          </div>
          {batchError && <p className="text-accent">{batchError}</p>}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        <Checkbox
          checked={allVisibleChecked}
          onChange={toggleAllVisible}
          label="select all"
          size={18}
        >
          <span className="text-subtle">Select all shown</span>
        </Checkbox>
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(po) => po.id}
        storageKey="rf.purchaseOrders.columnWidths.v1"
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as PoSortKey, dir: next.dir })
        }
        empty={<p className="text-sm text-muted">No orders in this window.</p>}
      />
    </div>
  );
}
