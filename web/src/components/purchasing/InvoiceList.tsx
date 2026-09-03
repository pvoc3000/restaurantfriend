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
  BILL_STAGE_CLASS,
  BILL_STAGE_LABEL,
  BILL_STAGE_ORDER,
  billStage,
  type AgingBucket,
} from "@/lib/invoices";
import {
  invoiceDetailHref,
  invoiceFiltersToQuery,
  invoiceListHref,
  parseInvoiceFilters,
  serializeInvoiceView,
  INVOICE_VIEW_COOKIE,
  RANGES,
  type AgingFilter,
  type InvoiceFilters,
  type InvoiceSortKey,
  type InvoiceStatusFilter,
  type RangeKey,
} from "@/lib/invoiceFilters";
import { urlFilterParams } from "@/lib/filterMenus";
import { makeComparator, type SortValue } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { usePublishRecordSet } from "@/lib/recordSet";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Checkbox } from "@/components/ui/Checkbox";
import { InvoiceBatchActions } from "./InvoiceBatchActions";
import { NewInvoice } from "./NewInvoice";
import type { InvoiceListRow } from "@/app/(app)/invoices/page";

const INVOICE_WIDTHS_KEY = "rf.invoices.columnWidths.v1";

/** When the ordering behind this invoice began — the earliest of its purchase
 *  orders' dates, or null when it has none. Sorting, grouping and the cell all
 *  read this one function, so they cannot disagree about which date it is. */
function poDate(i: InvoiceListRow): string | null {
  const dates = i.purchase_orders.map((p) => p.order_date).filter(Boolean) as string[];
  if (dates.length === 0) return null;
  // ISO strings, so a plain comparison is a date comparison — `new Date` here
  // would be UTC midnight and could move the day west of Greenwich.
  return dates.reduce((a, b) => (a < b ? a : b));
}

/** Where a bill has got to, from what is on the row. Derived here rather than
 *  stored — see `billStage`. One call, so the chip, the sort and the search
 *  cannot disagree about which rung a bill is on. */
function stageOf(i: InvoiceListRow) {
  return billStage({
    status: i.status,
    linked: i.qbo_linked,
    qbo_balance: i.qbo_balance,
    qbo_checked_at: i.qbo_checked_at,
  });
}

function sortValue(invoice: InvoiceListRow, key: InvoiceSortKey): SortValue {
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
      // THE LADDER, because that is what the chip says. It read
      // `INVOICE_STATUS_ORDER.indexOf(invoice.status)` until 2026-09-02, so
      // after the chip became Open/Approved/Submitted/Paid the column sorted by
      // a vocabulary it no longer displayed — Paid and Submitted tied, since
      // both are `approved` underneath.
      return BILL_STAGE_ORDER.indexOf(stageOf(invoice));
    case "po":
      // A set, so it sorts by how MANY orders it touches — there is no single
      // number to order by, and "which one comes first alphabetically" would
      // be an answer about a detail the column only shows part of.
      return invoice.purchase_orders.length;
    case "total":
      return signedTotal(invoice);
    case "po_date":
      return poDate(invoice);
    case "lines":
      return invoice.line_count;
  }
  // EXHAUSTIVE, AND THE COMPILER CHECKS IT. This used to fall through to the
  // aging bucket "for the linter's benefit", which meant a sort key added later
  // sorted silently by the wrong thing — `po_date` did exactly that for the
  // ten minutes between adding the column and finding this. A `never` makes the
  // next one a build error instead.
  const unreachable: never = key;
  return unreachable;
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
  status: (i) => BILL_STAGE_LABEL[stageOf(i)],
  vendor: (i) => i.vendors?.name ?? "No vendor",
  due_date: (i, today) => AGING_LABEL[agingBucket(i.due_date, today)],
  // BY THE DATE ITSELF, not a bucket. Ordering here is WEEKLY, so each PO date
  // is one shop's order for that week and the band is the batch — which is the
  // reason to group by it at all.
  po_date: (i) => poDate(i) ?? "No purchase order",
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
  canApprove,
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
  vendors: { id: string; name: string; inactive?: boolean }[];
  canEdit: boolean;
  /** Manager and Owner only — the module's own decision (025). */
  canApprove: boolean;
}) {
  const router = useRouter();
  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
  // The props are the fallback PER FIELD — see the PO list for the argument.
  const [filters, setFilters] = useState<InvoiceFilters>(() => {
    const live = urlFilterParams("/invoices");
    return live ? parseInvoiceFilters(live, initialFilters) : initialFilters;
  });
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
    for (const i of invoices) {
      const stage = stageOf(i);
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
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
      if (filters.status !== "all" && stageOf(i) !== filters.status) return false;
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
          value: (i) => sortValue(i, filters.sort),
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
    [visible, filters.sort, filters.dir]
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

  /** What the last bulk command did. Held HERE rather than in the bar, because
   *  clearing the selection unmounts the bar — see `InvoiceBatchActions`. */
  const [batchReport, setBatchReport] = useState<{
    message: string;
    tone: "done" | "error";
  } | null>(null);
  const [qboBusy, setQboBusy] = useState(false);
  const [qboError, setQboError] = useState<string | null>(null);
  const qboSupabase = createClient();

  /**
   * Ask QuickBooks what these bills' balances are, write them (088), and
   * refresh so the STORED figures land on screen.
   *
   * NO LOCAL PREVIEW ANY MORE (Mark, 2026-09-03: the per-row "paid · as
   * of…" line under the invoice number "not necessary"). `refresh_status`'s
   * response used to be held in state so a row could say what QuickBooks
   * *just* answered before the page had re-read it; without that line to
   * feed, there is nothing left to hold — the router refresh below is the
   * only path a checked balance needs to reach the screen.
   *
   * WITHOUT THE REFRESH THE CHIP CANNOT MOVE. The balance was written
   * server-side, so the rows this list is holding are the ones the last
   * render was given — measured: QuickBooks reported "2 of 3 paid" while
   * the tabs still read "Submitted 3", because `billStage` reads the row
   * and the row was stale.
   *
   * Below purchaser+ the write changes nothing (025's policy) and the
   * server says so in `not_stored`, which is the one thing still worth a
   * sentence — the figures on screen are still correct for THIS visit, and
   * a reload would quietly lose them.
   */
  async function checkQuickBooks() {
    setQboBusy(true);
    setQboError(null);
    const { data, message } = await invokeQbo(qboSupabase, { mode: "refresh_status" });
    setQboBusy(false);
    if (message) {
      setQboError(message);
      return;
    }
    if (Number(data?.stored ?? 0) > 0) router.refresh();
    if (Number(data?.not_stored ?? 0) > 0) {
      setQboError(
        `${data!.not_stored} of these could not be saved, so they will be blank again ` +
          `after a reload. Recording what QuickBooks says needs purchaser access.`
      );
    }
  }

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
      sortValue: (i) => BILL_STAGE_ORDER.indexOf(stageOf(i)),
      render: (i) => {
        const stage = stageOf(i);
        return (
          <span
            className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${BILL_STAGE_CLASS[stage]}`}
          >
            {BILL_STAGE_LABEL[stage]}
          </span>
        );
      },
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
      key: "po_date",
      label: "PO Date",
      width: 120,
      // THE EARLIEST, when an invoice covers more than one order — the question
      // this column answers is "when was this ordered", and that is when the
      // ordering began. Measured on the real data: 47 of 50 linked invoices
      // carry ONE purchase order, the other 3 carry two a week apart, and in
      // all three the lowest PO NUMBER is also the earliest date, so this
      // agrees with the PO column beside it rather than naming a different
      // document. The `+N` there already says there are more.
      sortValue: (i) => poDate(i),
      render: (i) => {
        const date = poDate(i);
        return (
          <span className="tabular-nums text-muted">{date ?? <span className="text-faint">—</span>}</span>
        );
      },
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
    ...BILL_STAGE_ORDER.filter((s) => s !== "open" && (statusCounts[s] ?? 0) > 0),
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
            className="w-72"
          />

          <TabPicker
            ariaLabel="Status"
            value={filters.status}
            onChange={(status) => update({ status })}
            options={statusTabs.map((s) => ({
              key: s,
              label: s === "all" ? "All" : BILL_STAGE_LABEL[s],
              count: s === "all" ? invoices.length : statusCounts[s] ?? 0,
            }))}
          />

          {/* MOVED HERE, beside New invoice (Mark, 2026-09-03) — it had its
              own row below the filters, on its own, which put it nowhere
              near the other command on this screen. `NewInvoice`'s own
              trigger carries `ml-auto`, so this sits immediately to its
              left just by coming before it in this row. */}
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={qboBusy}
            onClick={() => void checkQuickBooks()}
          >
            {qboBusy ? "Checking QuickBooks…" : "Check QuickBooks"}
          </button>
          {qboError && <span className="text-[13px] text-accent">{qboError}</span>}

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

      {/* The outcome of the last bulk command, OUTSIDE the bar it came from.
          Cleared as soon as a new selection begins, so it can never be read as
          being about the rows now ticked. */}
      {batchReport && checked.size === 0 && (
        <p
          className={`border px-4 py-3 text-sm ${
            batchReport.tone === "error"
              ? "border-accent text-accent"
              : "border-ink text-ink"
          }`}
        >
          {batchReport.message}
        </p>
      )}

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 border border-ink px-4 py-3 text-sm">
          <span>{checked.size} selected</span>
          <span className="tabular-nums text-muted">{money(selectedTotal)}</span>
          <InvoiceBatchActions
            selected={sorted.filter((i) => checked.has(i.id))}
            canEdit={canEdit}
            canApprove={canApprove}
            onReport={(message, tone) => {
              setBatchReport({ message, tone });
              setChecked(new Set());
            }}
          />
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
        // Eleven columns summing to 1338, the width the PO list's own columns
        // were tuned to. Tax and Freight came off on 2026-09-02 and PO Date
        // took part of what they left; the compact set drops Lines.
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
