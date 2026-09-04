"use client";

import { useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { NewCustomer } from "@/components/specialOrders/NewCustomer";
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
import { customerLabel, money } from "@/lib/specialOrders";

export type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  /** Derived on the server from this customer's orders — never a column. */
  orderCount: number;
  lastOrder: string | null;
  outstanding: number;
};

const PATH = "/customers";

const SORT_KEYS = ["name", "company", "phone", "email", "city", "orders", "last", "owed"] as const;

/**
 * The customer book.
 *
 * FileMaker kept `Num_Orders_c`, `Spent_Total_c` and `BalanceDue_c` as calc
 * fields on the customer, and every one of them is DERIVED here instead
 * (decision 6's rule reaching the other table): a stored count goes wrong the
 * first time an order is deleted, and this list is where anybody would notice
 * last.
 *
 * THE THREE MENUS ARE ABOUT THE RELATIONSHIP, not about the fields. "Who owes
 * us money", "who is a wholesale account", "who we have never sold anything
 * to" are the questions this screen is opened with; a menu over `city` would
 * be a menu over a column.
 */
export function CustomersList({
  rows,
  initialFilters,
  initialSearch = "",
  canWrite,
  orgId,
}: {
  rows: CustomerRow[];
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  canWrite: boolean;
  orgId: string;
}) {
  const dimensions = useMemo<FilterDimension<CustomerRow>[]>(
    () => [
      {
        key: "owing",
        label: "Balance",
        options: [
          { value: "owing", label: "Owes money" },
          { value: "clear", label: "Settled" },
        ],
        matches: (r, v) => (v === "owing" ? r.outstanding > 0 : r.outstanding <= 0),
      },
      {
        key: "company",
        label: "Kind",
        options: [
          { value: "company", label: "Company" },
          { value: "person", label: "Person" },
        ],
        matches: (r, v) => (v === "company" ? Boolean(r.company) : !r.company),
      },
      {
        key: "activity",
        label: "Orders",
        options: [
          { value: "any", label: "Has ordered" },
          { value: "none", label: "Never ordered" },
        ],
        matches: (r, v) => (v === "any" ? r.orderCount > 0 : r.orderCount === 0),
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
      [r.first_name, r.last_name, r.company, r.email, r.phone, r.city].some((v) =>
        (v ?? "").toLowerCase().includes(q)
      )
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  const listHref = filterHref(PATH, dimensions, filters, search, sort);
  const detailHref = (id: string) =>
    withFrom(`/customers/${id}`, { href: listHref, label: "Customers" });

  const columns: DataColumn<CustomerRow>[] = [
    {
      key: "name",
      label: "Name",
      width: 240,
      pinned: true,
      wrap: true,
      sortValue: (r) => `${r.last_name ?? ""} ${r.first_name ?? ""}`.trim().toLowerCase(),
      sortTiebreaks: [(r) => r.company ?? ""],
      render: (r) => (
        <Link href={detailHref(r.id)} className="font-medium hover:underline">
          {customerLabel(r)}
        </Link>
      ),
    },
    {
      key: "phone",
      label: "Phone",
      width: 150,
      sortValue: (r) => r.phone ?? "",
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) => <span className="text-muted">{r.phone ?? "—"}</span>,
    },
    {
      key: "email",
      label: "Email",
      width: 260,
      wrap: true,
      sortValue: (r) => r.email ?? "",
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) => <span className="text-muted">{r.email ?? "—"}</span>,
    },
    {
      key: "city",
      label: "City",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => r.city ?? "",
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) => <span className="text-muted">{r.city ?? "—"}</span>,
    },
    {
      key: "orders",
      label: "Orders",
      width: 90,
      align: "right",
      sortValue: (r) => r.orderCount,
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) => <span className="tabular-nums text-muted">{r.orderCount}</span>,
    },
    {
      key: "last",
      label: "Last order",
      width: 130,
      sortValue: (r) => r.lastOrder ?? "",
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) => <span className="tabular-nums text-muted">{r.lastOrder ?? "—"}</span>,
    },
    {
      key: "owed",
      label: "Owed",
      width: 110,
      align: "right",
      sortValue: (r) => r.outstanding,
      sortTiebreaks: [(r) => r.last_name ?? ""],
      render: (r) =>
        r.outstanding > 0 ? (
          <span className="tabular-nums text-accent">{money(r.outstanding)}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  const sorted = sortRows(visible, columns, sort);
  usePublishRecordSet(PATH, sorted.map((r) => ({ id: r.id, href: detailHref(r.id) })));

  return (
    <div className="space-y-4">
      {/* This screen had no title at all, the same gap `/special-orders` had
          (Mark, 2026-09-03). Org-wide: decision 8 makes a customer the ORG's. */}
      <PageHeading
        title="Customers"
        visible={visible.length}
        total={rows.length}
        noun="customers"
      />

      <FilterMenus
        rows={searched}
        total={rows.length}
        noun="customers"
        dimensions={dimensions}
        values={filters}
        onChange={changeFilters}
        // `PageHeading` states the count now — see `showCount`.
        showCount={false}
        leading={
          <div className="space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Search
            </span>
            <TextInput
              value={search}
              onValueChange={changeSearch}
              placeholder="Name, company, email…"
              className="w-64"
              aria-label="Search customers"
              clearLabel="Clear the search"
            />
          </div>
        }
        rowAction={canWrite ? <NewCustomer orgId={orgId} roster={rows} /> : undefined}
      />

    <DataTable
      rows={sorted}
      sort={sort}
      onSortChange={changeSort}
      defaultSort={{ key: "name", dir: "asc" }}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="customers.v1"
      compactBelow={1280}
      columnChooser
      empty={<p className="text-sm text-muted">No customers match these filters.</p>}
    />
    </div>
  );
}
