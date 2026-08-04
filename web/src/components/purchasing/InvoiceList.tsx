"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { money } from "@/lib/purchaseOrders";
import {
  agingBucket,
  signedTotal,
  sumSignedTotals,
  AGING_LABEL,
  AGING_ORDER,
  INVOICE_STATUS_CLASS,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_ORDER,
  type AgingBucket,
  type InvoiceStatus,
} from "@/lib/invoices";
import {
  invoiceDetailHref,
  invoiceFiltersToQuery,
  invoiceListHref,
  serializeInvoiceView,
  INVOICE_VIEW_COOKIE,
  RANGES,
  type AgingFilter,
  type InvoiceFilters,
  type InvoiceSortKey,
  type InvoiceStatusFilter,
  type RangeKey,
} from "@/lib/invoiceFilters";
import { makeComparator, type SortValue } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { usePublishRecordSet } from "@/lib/recordSet";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { Checkbox } from "@/components/ui/Checkbox";
import { NewInvoice } from "./NewInvoice";
import type { InvoiceListRow } from "@/app/(app)/invoices/page";

const INVOICE_WIDTHS_KEY = "rf.invoices.columnWidths.v1";

function sortValue(
  invoice: InvoiceListRow,
  key: InvoiceSortKey,
  today: string
): SortValue {
  switch (key) {
    case "invoice_number":
      return invoice.invoice_number;
    case "invoice_date":
      return invoice.invoice_date;
    case "due_date":
      return invoice.due_date;
    case "vendor":
      return invoice.vendors?.name ?? null;
    case "status":
      return INVOICE_STATUS_ORDER.indexOf(invoice.status);
    case "po":
      // A set, so it sorts by how MANY orders it touches — there is no single
      // number to order by, and "which one comes first alphabetically" would
      // be an answer about a detail the column only shows part of.
      return invoice.purchase_orders.length;
    case "total":
      return signedTotal(invoice);
    case "lines":
      return invoice.line_count;
  }
  // Unreachable; keeps the switch exhaustive for the linter's benefit.
  return agingBucket(invoice.due_date, today);
}

/**
 * The columns whose runs are worth a band — few values, many rows each.
 *
 * No `invoice_date`, deliberately, and this is where the invoice list departs
 * from the PO list: purchase orders are generated in a Monday batch, so a date
 * band there names a real run. Invoices arrive one per delivery, all week, so a
 * date band would be a heading above one or two rows.
 *
 * `due_date` bands by BUCKET rather than raw value — the one place a band names
 * something other than its own column. The raw date fails the few-values test
 * and its bucket passes, and because the list is sorted by that same date the
 * buckets come out contiguous, so the band is honest about what it opens.
 */
const GROUP_LABEL: Partial<
  Record<InvoiceSortKey, (i: InvoiceListRow, today: string) => string>
> = {
  status: (i) => INVOICE_STATUS_LABEL[i.status],
  vendor: (i) => i.vendors?.name ?? "No vendor",
  due_date: (i, today) => AGING_LABEL[agingBucket(i.due_date, today)],
};

/**
 * The invoice list — what we owe, and what needs a decision.
 *
 * Where the PO list answers "what did we order", this answers "what do we owe
 * and when", which is why it opens on Open and sorts by due date ascending.
 */
export function InvoiceList({
  invoices,
  initialFilters,
  activeLocationCode,
  today,
  capped,
  orgId,
  locationId,
  vendors,
  canEdit,
}: {
  invoices: InvoiceListRow[];
  initialFilters: InvoiceFilters;
  activeLocationCode: string;
  /** The org's calendar day, computed once on the server — see lib/today. */
  today: string;
  capped: boolean;
  orgId: string;
  locationId: string;
  /** Every ACTIVE vendor, order_type 'none' included — the landlord and the
   *  plumber are the whole reason this screen can create anything. */
  vendors: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<InvoiceFilters>(initialFilters);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.cookie = `${INVOICE_VIEW_COOKIE}=${serializeInvoiceView(filters)}; path=/; SameSite=Lax`;
  }, [filters]);

  function update(patch: Partial<InvoiceFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = invoiceFiltersToQuery(next);
    window.history.replaceState(null, "", query ? `/invoices?${query}` : "/invoices");
  }

  // The date window is a SERVER filter, so it has to re-run the page —
  // router.push rather than replaceState, and setFilters as well, because the
  // push re-renders the server component without remounting this one.
  function setRange(range: RangeKey) {
    const next = { ...filters, range };
    setFilters(next);
    router.push(invoiceListHref(next));
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of invoices) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, [invoices]);

  const agingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of invoices) {
      const bucket = agingBucket(i.due_date, today);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
  }, [invoices, today]);

  const visible = useMemo(() => {
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return invoices.filter((i) => {
      if (filters.status !== "all" && i.status !== filters.status) return false;
      if (filters.aging !== "all" && agingBucket(i.due_date, today) !== filters.aging) {
        return false;
      }
      if (words.length === 0) return true;
      const haystack = [
        i.invoice_number ?? "",
        i.vendors?.name ?? "",
        i.status,
        ...i.purchase_orders.map((p) => p.po_number),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [invoices, filters.status, filters.aging, filters.q, today]);

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<InvoiceListRow>({
          value: (i) => sortValue(i, filters.sort, today),
          dir: filters.dir,
          // Vendor as the secondary sort whatever the primary is, matching the
          // PO list: a due-date band and a status band are both read vendor by
          // vendor. The invoice number is last because it is the closest thing
          // to unique per row, so it makes the whole order deterministic.
          tiebreaks: [
            (i) => i.vendors?.name ?? "",
            (i) => i.invoice_number ?? "",
          ],
        })
      ),
    [visible, filters.sort, filters.dir, today]
  );

  usePublishRecordSet(
    "/invoices",
    useMemo(
      () => sorted.map((i) => ({ id: i.id, href: invoiceDetailHref(i.id, filters) })),
      [sorted, filters]
    )
  );

  // Three figures rather than the PO list's one: a bills list that can't tell
  // you how much is overdue isn't doing its job.
  const windowTotal = useMemo(() => sumSignedTotals(visible), [visible]);
  const openTotal = useMemo(
    () => sumSignedTotals(visible.filter((i) => i.status === "open")),
    [visible]
  );
  const overdueTotal = useMemo(
    () =>
      sumSignedTotals(
        visible.filter(
          (i) => i.status === "open" && agingBucket(i.due_date, today) === "overdue"
        )
      ),
    [visible, today]
  );

  const allVisibleChecked =
    sorted.length > 0 && sorted.every((i) => checked.has(i.id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) sorted.forEach((i) => next.delete(i.id));
      else sorted.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedTotal = useMemo(
    () => sumSignedTotals(visible.filter((i) => checked.has(i.id))),
    [visible, checked]
  );

  const columns: DataColumn<InvoiceListRow>[] = [
    {
      key: "select",
      label: "",
      width: 48,
      header: (
        <Checkbox
          checked={allVisibleChecked}
          onChange={toggleAllVisible}
          label="Select all shown"
          size={18}
        />
      ),
      render: (i) => (
        <Checkbox
          checked={checked.has(i.id)}
          onChange={() => toggleOne(i.id)}
          label={`select ${i.invoice_number ?? "invoice"}`}
          size={18}
        />
      ),
    },
    {
      key: "invoice_number",
      label: "Invoice",
      pinned: true,
      width: 150,
      sortValue: (i) => i.invoice_number,
      render: (i) => (
        <Link
          href={invoiceDetailHref(i.id, filters)}
          className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          {/* A rent bill has no number, and saying so beats an em dash you
              can't click. */}
          {i.invoice_number ?? <span className="text-faint">No number</span>}
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      width: 205,
      sortValue: (i) => i.vendors?.name ?? null,
      render: (i) =>
        i.vendors ? (
          <Link
            href={withFrom(`/vendors/${i.vendors.id}`, {
              href: invoiceListHref(filters),
              label: "Invoices",
            })}
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            {i.vendors.name}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "invoice_date",
      label: "Invoiced",
      width: 120,
      sortValue: (i) => i.invoice_date,
      render: (i) => (
        <span className="tabular-nums text-muted">{i.invoice_date ?? "—"}</span>
      ),
    },
    {
      key: "due_date",
      label: "Due",
      width: 120,
      sortValue: (i) => i.due_date,
      render: (i) => {
        // Red only when it's genuinely a problem: an overdue bill nobody has
        // approved. An approved one is someone else's clock.
        const overdue =
          i.status === "open" && agingBucket(i.due_date, today) === "overdue";
        return (
          <span
            className={
              overdue ? "font-semibold tabular-nums text-accent" : "tabular-nums text-muted"
            }
          >
            {i.due_date ?? "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      sortValue: (i) => INVOICE_STATUS_ORDER.indexOf(i.status),
      render: (i) => (
        <span
          className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${INVOICE_STATUS_CLASS[i.status]}`}
        >
          {INVOICE_STATUS_LABEL[i.status]}
        </span>
      ),
    },
    {
      key: "po",
      label: "PO",
      width: 160,
      sortValue: (i) => i.purchase_orders.length,
      render: (i) => {
        if (i.purchase_orders.length === 0) return <span className="text-faint">—</span>;
        const [first, ...rest] = i.purchase_orders;
        return (
          <span className="text-muted">
            <Link
              href={withFrom(`/purchase-orders/${first.id}`, {
                href: invoiceListHref(filters),
                label: "Invoices",
              })}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {first.po_number}
            </Link>
            {rest.length > 0 && ` +${rest.length}`}
          </span>
        );
      },
    },
    {
      key: "tax",
      label: "Tax",
      width: 95,
      align: "right",
      hideWhenCompact: true,
      sortValue: (i) => i.tax,
      render: (i) =>
        i.tax === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="text-muted">{money(i.tax)}</span>
        ),
    },
    {
      key: "freight",
      label: "Freight",
      width: 100,
      align: "right",
      hideWhenCompact: true,
      sortValue: (i) => i.freight,
      render: (i) =>
        i.freight === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="text-muted">{money(i.freight)}</span>
        ),
    },
    {
      key: "total",
      label: "Total",
      width: 135,
      align: "right",
      sortValue: (i) => signedTotal(i),
      render: (i) => (
        // A credit carries its sign and the mark colour: it is money moving the
        // other way, which is worth seeing in a column of amounts owed.
        <span className={i.is_credit ? "font-semibold text-accent" : "text-body"}>
          {money(signedTotal(i))}
        </span>
      ),
    },
    {
      key: "lines",
      label: "Lines",
      width: 80,
      align: "right",
      hideWhenCompact: true,
      sortValue: (i) => i.line_count,
      render: (i) =>
        i.line_count === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums text-muted">{i.line_count}</span>
        ),
    },
    {
      key: "documents",
      label: "Files",
      width: 80,
      align: "right",
      sortValue: (i) => i.document_count,
      render: (i) =>
        i.document_count === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums text-muted">{i.document_count}</span>
        ),
    },
  ];

  /**
   * All and Open are always shown even at zero; Approved and Void are dropped
   * when empty. The PO list's argument: "Approved 0" says only that nothing
   * happens to be in that state, where "Open 0" says nothing is outstanding,
   * which is the answer you came for.
   */
  const statusTabs: InvoiceStatusFilter[] = [
    "all",
    "open",
    ...INVOICE_STATUS_ORDER.filter(
      (s) => s !== "open" && (statusCounts[s] ?? 0) > 0
    ),
  ];

  const agingTabs: AgingFilter[] = [
    "all",
    ...AGING_ORDER.filter((b) => (agingCounts[b] ?? 0) > 0),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Invoices
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {activeLocationCode} · {visible.length} of {invoices.length} invoices
          </p>
        </div>
        <div className="ml-auto flex items-end gap-8 text-right">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Window total
            </div>
            <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(windowTotal)}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Open
            </div>
            <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(openTotal)}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Overdue
            </div>
            <div
              className={`text-[22px] font-bold tabular-nums tracking-[-0.01em] ${
                overdueTotal > 0.005 ? "text-accent" : ""
              }`}
            >
              {money(overdueTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Two rows, and which control sits on which is deliberate: three
          TabPickers on one line do not fit at 1440 (vendor detail measured four
          wanting 1441px against 1329 available). Typing controls and the status
          on the first, the two remaining pickers on the second. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <TextInput
            value={filters.q}
            onValueChange={(q) => update({ q })}
            placeholder="Search invoice number, vendor or PO…"
            clearLabel="Clear the search"
            className="h-9 w-72 text-sm"
          />

          <TabPicker
            ariaLabel="Status"
            value={filters.status}
            onChange={(status) => update({ status })}
            options={statusTabs.map((s) => ({
              key: s,
              label: s === "all" ? "All" : INVOICE_STATUS_LABEL[s as InvoiceStatus],
              count: s === "all" ? invoices.length : statusCounts[s] ?? 0,
            }))}
          />

          {/* The create command, right-aligned in the list's filter row — where
              New employee sits, which is the template this follows. */}
          {canEdit && (
            <NewInvoice
              orgId={orgId}
              locationId={locationId}
              vendors={vendors}
              today={today}
              // The vendor's id lives on the embed, not as its own column on
              // the row — the duplicate check only ever compares within one
              // vendor, so that's the shape it wants.
              existing={invoices.map((i) => ({
                id: i.id,
                vendor_id: i.vendors?.id ?? "",
                invoice_number: i.invoice_number,
                invoice_date: i.invoice_date,
                total: i.total,
                status: i.status,
              }))}
            />
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          {/* The label sits ABOVE its picker (Mark, 2026-08-01): a five-cell bar
              with a label to its left starts 130px in and no longer lines up
              with the search box above it. */}
          <div className="space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Due
            </span>
            <TabPicker
              ariaLabel="Aging"
              value={filters.aging}
              onChange={(aging) => update({ aging })}
              options={agingTabs.map((b) => ({
                key: b,
                label: b === "all" ? "All" : AGING_LABEL[b as AgingBucket],
                count: b === "all" ? invoices.length : agingCounts[b] ?? 0,
              }))}
            />
          </div>

          <div className="ml-auto space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Window
            </span>
            <TabPicker
              ariaLabel="Date window"
              value={filters.range}
              onChange={setRange}
              options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
            />
          </div>
        </div>
      </div>

      {capped && (
        <p className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
          Showing the 500 most recent invoices in this window — narrow the window
          to see everything in it.
        </p>
      )}

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 border border-ink px-4 py-3 text-sm">
          <span>{checked.size} selected</span>
          <span className="tabular-nums text-muted">{money(selectedTotal)}</span>
          <button
            onClick={() => setChecked(new Set())}
            className="ml-auto text-muted underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Clear
          </button>
        </div>
      )}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(i) => i.id}
        // Twelve columns summing to 1413. The compact set drops Tax, Freight
        // and Lines — the three a tablet can do without — bringing it to 1098.
        compactBelow={1280}
        storageKey={INVOICE_WIDTHS_KEY}
        columnChooser
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as InvoiceSortKey, dir: next.dir })
        }
        group={
          GROUP_LABEL[filters.sort]
            ? { label: (i: InvoiceListRow) => GROUP_LABEL[filters.sort]!(i, today) }
            : undefined
        }
        empty={<p className="text-sm text-muted">No invoices in this window.</p>}
      />
    </div>
  );
}
