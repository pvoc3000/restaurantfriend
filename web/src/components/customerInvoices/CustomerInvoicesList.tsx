"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { PageHeading } from "@/components/ui/PageHeading";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
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
import { money } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import {
  INVOICE_STATUS_CLASS,
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

const SORT_KEYS = ["number", "customer", "issued", "due", "status", "processor", "orders", "total", "balance"] as const;

/**
 * Every customer invoice (migration 124). There is NO create command here:
 * an invoice is made from the orders it bills — select them on Special Orders
 * and choose Create Invoice… — so the only thing this screen could offer is a
 * dialog that asks you to go and pick orders.
 */
export function CustomerInvoicesList({
  rows,
  initialFilters,
  initialSearch = "",
}: {
  rows: CustomerInvoiceRow[];
  initialFilters?: RawSearchParams;
  initialSearch?: string;
}) {
  const dimensions = useMemo<FilterDimension<CustomerInvoiceRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: (["draft", "sent", "overdue", "paid", "void"] as InvoiceStatus[]).map((s) => ({
          value: s,
          label: INVOICE_STATUS_LABEL[s],
        })),
        matches: (r, v) => r.status === v,
      },
    ],
    []
  );

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

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.numberText, r.customer].some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);

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
        <span
          className={`inline-flex h-6 items-center whitespace-nowrap px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${INVOICE_STATUS_CLASS[r.status]}`}
        >
          {INVOICE_STATUS_LABEL[r.status]}
        </span>
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
        rows={searched}
        total={rows.length}
        noun="invoices"
        dimensions={dimensions}
        values={filters}
        onChange={changeFilters}
        showCount={false}
        leading={
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
