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
import { PROCESSOR_LABEL } from "@/lib/customerInvoices";
import {
  CREDIT_MEMO_KIND_LABEL,
  CREDIT_MEMO_STATUS_LABEL,
  CREDIT_MEMO_STATUS_ORDER as STATUS_ORDER,
  type CreditMemoKind,
  type CreditMemoStatus,
} from "@/lib/creditMemos";

export type CreditMemoRow = {
  id: string;
  number: number;
  numberText: string;
  customer: string;
  kind: CreditMemoKind;
  reason: string;
  issued_on: string;
  invoice: string | null;
  order: string | null;
  processor: "square" | "quickbooks";
  inQuickBooks: boolean;
  status: CreditMemoStatus;
  total: number;
  unapplied: number;
};

const PATH = "/credit-memos";
const SORT_KEYS = ["number", "customer", "kind", "issued", "invoice", "order", "status", "total", "unapplied"] as const;

/**
 * Every customer credit memo (218). Issued from an order (Issue Credit
 * Memo… on its Items tab) or a customer (New Allowance…), never from here:
 * a memo always corrects something, and this list has nothing in hand to
 * correct.
 */
export function CreditMemosList({
  rows,
  initialFilters,
  initialSearch = "",
}: {
  rows: CreditMemoRow[];
  initialFilters?: RawSearchParams;
  initialSearch?: string;
}) {
  const dimensions = useMemo<FilterDimension<CreditMemoRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: STATUS_ORDER.map((s) => ({ value: s, label: CREDIT_MEMO_STATUS_LABEL[s] })),
        matches: (r, v) => r.status === v,
      },
      {
        key: "kind",
        label: "Kind",
        options: (Object.keys(CREDIT_MEMO_KIND_LABEL) as CreditMemoKind[]).map((k) => ({
          value: k,
          label: CREDIT_MEMO_KIND_LABEL[k],
        })),
        matches: (r, v) => r.kind === v,
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
      [r.numberText, r.customer, r.invoice ?? "", r.order ?? "", r.reason].some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);
  const visible = useMemo(() => applyListFilters(searched, dimensions, filters), [searched, dimensions, filters]);

  const listHref = filterHref(PATH, dimensions, filters, search, sort);
  const detailHref = (id: string) => withFrom(`${PATH}/${id}`, { href: listHref, label: "Credit Memos" });
  const tie = (r: CreditMemoRow) => String(r.number).padStart(9, "0");

  const columns: DataColumn<CreditMemoRow>[] = [
    {
      key: "number",
      label: "Memo",
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
      width: 220,
      wrap: true,
      sortValue: (r) => r.customer.toLowerCase(),
      sortTiebreaks: [tie],
      render: (r) => <span>{r.customer}</span>,
    },
    {
      key: "kind",
      label: "Kind",
      width: 150,
      wrap: true,
      sortValue: (r) => r.kind,
      sortTiebreaks: [tie],
      render: (r) => (
        <span className="text-muted">
          {CREDIT_MEMO_KIND_LABEL[r.kind]}
          {r.kind === "allowance" ? ` · ${r.reason}` : ""}
        </span>
      ),
    },
    {
      key: "issued",
      label: "Issued",
      width: 110,
      sortValue: (r) => r.issued_on,
      sortTiebreaks: [tie],
      render: (r) => <span className="tabular-nums text-muted">{usDate(r.issued_on)}</span>,
    },
    {
      key: "invoice",
      label: "Credits invoice",
      width: 130,
      sortValue: (r) => r.invoice ?? "",
      sortTiebreaks: [tie],
      render: (r) => <span className="tabular-nums text-muted">{r.invoice ?? "—"}</span>,
    },
    {
      key: "order",
      label: "Order",
      width: 100,
      sortValue: (r) => r.order ?? "",
      sortTiebreaks: [tie],
      render: (r) => <span className="tabular-nums text-muted">{r.order ?? "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 190,
      wrap: true,
      sortValue: (r) => STATUS_ORDER.indexOf(r.status),
      sortTiebreaks: [tie],
      render: (r) => (
        <span className={r.status === "to_refund" ? "bg-mark-fill px-1" : "text-muted"}>
          {CREDIT_MEMO_STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      key: "processor",
      label: "Collected through",
      width: 150,
      wrap: true,
      sortValue: (r) => r.processor,
      sortTiebreaks: [tie],
      render: (r) => (
        <span className="text-muted">
          {PROCESSOR_LABEL[r.processor]}
          {r.processor === "quickbooks" && r.status !== "void" && r.status !== "to_refund" && r.status !== "refunded" && !r.inQuickBooks ? (
            <span className="ml-1 bg-mark-fill px-1 text-ink">not in QuickBooks</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "total",
      label: "Total",
      width: 110,
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => <span className="tabular-nums">{money(r.total)}</span>,
    },
    {
      key: "unapplied",
      label: "Credit left",
      width: 110,
      align: "right",
      sortValue: (r) => (r.status === "void" || r.status === "to_refund" ? 0 : r.unapplied),
      render: (r) =>
        r.status !== "void" && r.status !== "to_refund" && r.unapplied > 0.005 ? (
          <span className="tabular-nums">{money(r.unapplied)}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  const sorted = sortRows(visible, columns, sort);
  usePublishRecordSet(PATH, sorted.map((r) => ({ id: r.id, href: detailHref(r.id) })));

  return (
    <div className="space-y-4">
      <PageHeading title="Credit Memos" visible={visible.length} total={rows.length} noun="credit memos" />
      <FilterMenus
        rows={searched}
        total={rows.length}
        noun="credit memos"
        dimensions={dimensions}
        values={filters}
        onChange={changeFilters}
        showCount={false}
        leading={
          <div className={`${SEARCH_PEN} space-y-1.5`}>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Search</span>
            <TextInput
              value={search}
              onValueChange={changeSearch}
              fullWidth
              search
              aria-label="Search credit memos"
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
        rowClassName={(r) => (r.status === "void" ? "text-faint line-through" : "")}
        storageKey="credit-memos.v1"
        columnChooser
        empty={
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "No credit memos yet. Record a short on an order's Items tab, then Issue Credit Memo…"
              : "No credit memos match these filters."}
          </p>
        }
      />
    </div>
  );
}
