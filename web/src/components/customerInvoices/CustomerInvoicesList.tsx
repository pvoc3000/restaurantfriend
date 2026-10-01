"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { PageHeading } from "@/components/ui/PageHeading";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { RangePicker } from "@/components/ui/RangePicker";
import type { DateRange } from "@/lib/dateRange";
import {
  DEFAULT_INVOICE_RANGE,
  INVOICE_RANGE_PRESETS,
  inInvoiceRange,
  invoiceRangeBounds,
  invoiceRangeToken,
  isInvoiceRangeToken,
} from "@/lib/invoiceRange";
import { SEARCH_PEN } from "@/components/ui/fieldMetrics";
import { usePublishRecordSet } from "@/lib/recordSet";
import { withFrom } from "@/lib/breadcrumbs";
import {
  applyListFilters,
  filterHref,
  parseFilterSearch,
  parseFilterValues,
  parseListSort,
  urlFilterParams,
  type FilterDimension,
  type FilterValues,
  type ListSort,
  type RawSearchParams,
} from "@/lib/filterMenus";
import { sortRows } from "@/lib/tableSort";
import { InvoiceStatusChip } from "./InvoiceStatusChip";
import { CheckQuickBooksPayments } from "./QuickBooksPaymentCheck";
import { NewCustomerInvoice } from "./NewCustomerInvoice";
import { money } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_ORDER,
  PROCESSOR_LABEL,
  type InvoiceProcessor,
  type InvoiceStatus,
} from "@/lib/customerInvoices";

export type CustomerInvoiceRow = {
  id: string;
  number: number;
  numberText: string;
  customer_id: string | null;
  customer: string;
  /** The shop that collects (141's header). */
  shop: string | null;
  issued_on: string;
  due_on: string | null;
  status: InvoiceStatus;
  processor: InvoiceProcessor;
  orders: number;
  total: number;
  paid: number;
  balance: number;
};

const PATH = "/customer-invoices";

const SORT_KEYS = ["number", "customer", "shop", "issued", "due", "status", "processor", "orders", "total", "balance"] as const;

/**
 * Every customer invoice (migration 124). NEW INVOICE… makes one for a
 * customer at a shop with no orders yet (141, Mark 2026-09-27); Create
 * Invoice… on a selection of Special Orders is still the quick way to bill a
 * week.
 */
export function CustomerInvoicesList({
  rows,
  initialFilters,
  initialSearch = "",
  today,
  create = null,
}: {
  rows: CustomerInvoiceRow[];
  /** The org's day — the range presets are functions of it. */
  today: string;
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  /** Supervisor+: what New Invoice… needs. Null hides it. */
  create?: { orgId: string; shops: { id: string; code: string }[]; today: string; termsDays: number } | null;
}) {
  const dimensions = useMemo<FilterDimension<CustomerInvoiceRow>[]>(
    () => [
      {
        // THE ISSUED WINDOW, drawn as a `RangePicker` rather than a menu —
        // still a dimension, so it rides the URL like the others (`?issued=`),
        // and `accepts` lets a picked `from..to` through. `lib/invoiceRange`
        // has the vocabulary and why All Time is where it rests.
        key: "issued",
        label: "Issued",
        options: INVOICE_RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
        accepts: isInvoiceRangeToken,
        defaultValue: DEFAULT_INVOICE_RANGE,
        matches: (r, v) => inInvoiceRange(r.issued_on, invoiceRangeBounds(v, today)),
      },
      {
        key: "status",
        label: "Status",
        options: (["draft", "sent", "overdue", "paid", "void"] as InvoiceStatus[]).map((s) => ({
          value: s,
          label: INVOICE_STATUS_LABEL[s],
        })),
        matches: (r, v) => r.status === v,
      },
      {
        // The desk page's Invoices card counts its own shop's, and links here
        // with this set so the two agree.
        key: "shop",
        label: "Shop",
        options: [...new Set(rows.map((r) => r.shop).filter((c): c is string => !!c))]
          .sort()
          .map((c) => ({ value: c, label: c })),
        matches: (r, v) => r.shop === v,
      },
    ],
    [rows, today]
  );
  // Every dimension but the window, which is not a menu.
  const menuDimensions = useMemo(() => dimensions.filter((d) => d.key !== "issued"), [dimensions]);

  const [search, setSearch] = useState(() => {
    const live = urlFilterParams(PATH);
    return live ? parseFilterSearch(live) : initialSearch;
  });
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, urlFilterParams(PATH) ?? initialFilters ?? {})
  );
  const [sort, setSort] = useState<ListSort | null>(() =>
    parseListSort(urlFilterParams(PATH) ?? initialFilters ?? {}, SORT_KEYS)
  );

  function writeUrl(f: FilterValues, q: string, s: ListSort | null) {
    window.history.replaceState(null, "", filterHref(PATH, dimensions, f, q, s));
  }
  const changeFilters = (next: FilterValues) => { setFilters(next); writeUrl(next, search, sort); };
  const changeSearch = (next: string) => { setSearch(next); writeUrl(filters, next, sort); };
  const changeSort = (next: ListSort) => { setSort(next); writeUrl(filters, search, next); };
  const changeRange = (picked: DateRange | null) =>
    changeFilters({ ...filters, issued: invoiceRangeToken(picked, today) });
  const rangeBounds = useMemo(
    () => invoiceRangeBounds(filters.issued ?? DEFAULT_INVOICE_RANGE, today),
    [filters.issued, today]
  );

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.numberText, r.customer].some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);

  // What the menus count over: the search AND the window, since the window is
  // not one of the dimensions they are handed.
  const ranged = useMemo(
    () => searched.filter((r) => inInvoiceRange(r.issued_on, rangeBounds)),
    [searched, rangeBounds]
  );

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  const listHref = filterHref(PATH, dimensions, filters, search, sort);
  const detailHref = (id: string) =>
    withFrom(`${PATH}/${id}`, { href: listHref, label: "Invoices" });

  const columns: DataColumn<CustomerInvoiceRow>[] = [
    {
      key: "number",
      label: "Invoice",
      width: 110,
      pinned: true,
      sortValue: (r) => r.number,
      render: (r) => (
        <Link href={detailHref(r.id)} className="font-medium tabular-nums hover:underline">
          {r.numberText}
        </Link>
      ),
    },
    {
      key: "customer",
      label: "Customer",
      width: 240,
      wrap: true,
      sortValue: (r) => r.customer.toLowerCase(),
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      render: (r) => <span>{r.customer}</span>,
    },
    {
      key: "shop",
      label: "Shop",
      width: 80,
      sortValue: (r) => r.shop ?? "",
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      render: (r) => <span className="text-muted">{r.shop ?? "—"}</span>,
    },
    {
      key: "issued",
      label: "Issued",
      width: 120,
      sortValue: (r) => r.issued_on,
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      render: (r) => <span className="tabular-nums text-muted">{usDate(r.issued_on)}</span>,
    },
    {
      key: "due",
      label: "Due",
      width: 120,
      sortValue: (r) => r.due_on ?? "",
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      render: (r) => <span className="tabular-nums text-muted">{r.due_on ? usDate(r.due_on) : "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      // Room for the longest chip, CHANGED SINCE SENT, without clipping.
      width: 200,
      sortValue: (r) => INVOICE_STATUS_ORDER.indexOf(r.status),
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      // The PO list's chip: colour is record STATE.
      render: (r) => (
        <InvoiceStatusChip status={r.status} />
      ),
    },
    {
      key: "processor",
      label: "Collect through",
      width: 120,
      sortValue: (r) => r.processor,
      sortTiebreaks: [(r) => String(r.number).padStart(9, "0")],
      render: (r) => <span className="text-muted">{PROCESSOR_LABEL[r.processor]}</span>,
    },
    {
      key: "orders",
      label: "Orders",
      width: 90,
      align: "right",
      sortValue: (r) => r.orders,
      render: (r) => <span className="tabular-nums text-muted">{r.orders}</span>,
    },
    {
      key: "total",
      label: "Total",
      width: 120,
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => <span className="tabular-nums">{money(r.total)}</span>,
    },
    {
      key: "balance",
      label: "Due now",
      width: 120,
      align: "right",
      sortValue: (r) => (r.status === "void" ? 0 : r.balance),
      render: (r) =>
        r.status !== "void" && r.balance > 0.005 ? (
          <span className="tabular-nums text-accent">{money(r.balance)}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  const sorted = sortRows(visible, columns, sort);
  usePublishRecordSet(PATH, sorted.map((r) => ({ id: r.id, href: detailHref(r.id) })));

  return (
    <div className="space-y-4">
      <PageHeading title="Invoices" visible={visible.length} total={rows.length} noun="invoices" />

      <FilterMenus
        rows={ranged}
        total={rows.length}
        noun="invoices"
        dimensions={menuDimensions}
        values={filters}
        onChange={changeFilters}
        showCount={false}
        rowAction={
          <div className="flex items-center gap-2">
            {/* Only while there is a QuickBooks invoice still waiting on money. */}
            {rows.some((r) => r.processor === "quickbooks" && (r.status === "sent" || r.status === "overdue")) ? (
              <CheckQuickBooksPayments />
            ) : null}
            {create ? <NewCustomerInvoice {...create} /> : null}
          </div>
        }
        leading={
          <>
            <div className={`${SEARCH_PEN} space-y-1.5`}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Search
              </span>
              <TextInput
                value={search}
                onValueChange={changeSearch}
                fullWidth
                search
                aria-label="Search invoices"
                clearLabel="Clear the search"
                icon={<SearchGlyph />}
              />
            </div>
            {/* The window straight after the search — where the PO, bill and
                special order lists all put theirs. */}
            <div className="w-44 space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Issued
              </span>
              <RangePicker
                value={rangeBounds}
                onChange={changeRange}
                presets={INVOICE_RANGE_PRESETS}
                today={today}
                ariaLabel="Which invoices to show, by the date issued"
                className="w-full"
              />
            </div>
          </>
        }

      />

      <DataTable
        rows={sorted}
        sort={sort}
        onSortChange={changeSort}
        defaultSort={{ key: "number", dir: "desc" }}
        columns={columns}
        rowKey={(r) => r.id}
        // A void invoice struck through — the Orders list's cancelled row.
        rowClassName={(r) => (r.status === "void" ? "text-faint line-through" : "")}
        storageKey="customer-invoices.v1"
        columnChooser
        empty={
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "No invoices yet. Select the orders to bill on Special Orders and choose Create Invoice…"
              : "No invoices match these filters."}
          </p>
        }
      />
    </div>
  );
}
