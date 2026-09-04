"use client";

import { useMemo, useState, type ReactNode } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { withFrom } from "@/lib/breadcrumbs";
import { sortRows } from "@/lib/tableSort";
import {
  applyListFilters,
  filterCounts,
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
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";

export type RecipeRow = {
  id: string;
  name: string;
  recipe_type: string | null;
  is_active: boolean;
  elementId: string;
  elementName: string;
  versionCount: number;
  masterLabel: string | null;
  /**
   * What ONE of this recipe costs to make — `elementCost` itself, so it is the
   * same number the element screen and the Costs block's headline quote, at the
   * column the recipe is costed at and with its labour in it. Its `unit` is the
   * expected-yield row's, which is why the Yield column that used to sit beside
   * this one is gone: it read the retired `yield_amount` COLUMN, disagreed with
   * the row on 19 of the 128 masters, and had no editor anywhere in the app.
   */
  cost: Cost;
};

/** This list's own address — its URL, its record-set key, its crumb. */
const PATH = "/recipes";

/**
 * Every column you can sort by — `columns` below, minus the ones with no
 * `sortValue`. KEEP THE TWO IN STEP; see the production items list for why.
 */
const SORT_KEYS = ["active", "name", "element", "type", "versions", "master", "cost"] as const;

/**
 * The recipe families.
 *
 * A row is the FAMILY, not a version — decision 3's whole point. FileMaker had
 * no family row at all: it kept 493 version records and grouped them by name,
 * which is why four elements carry two spellings of one recipe across their
 * history and read as two recipes from the list.
 */
export function RecipesList({
  rows,
  editable,
  initialFilters,
  initialSearch = "",
  action,
}: {
  rows: RecipeRow[];
  editable: boolean;
  /** The URL's query, raw. */
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  /** The screen's create command, beside the title. */
  action?: ReactNode;
}) {
  /**
   * ONE DIMENSION, so it stays a `TabPicker` — the app's rule for a single
   * question, and `ui/FilterMenus` is for three or more. What it borrows from
   * `lib/filterMenus` is the URL contract, not the control: a dimension is just
   * a declared filter, and reusing it means this list's whole view rides in the
   * query the same way the menu-driven lists' do, rather than through a
   * bespoke module of its own (`lib/itemFilters` and three siblings are what
   * that costs).
   *
   * `defaultValue` is what makes that possible here: this list opens on ACTIVE,
   * so ACTIVE is the value that writes no parameter and a plain `/recipes` is
   * unchanged.
   */
  const dimensions = useMemo<FilterDimension<RecipeRow>[]>(
    () => [
      {
        key: "tier",
        label: "Which recipes",
        defaultValue: "active",
        options: [
          { value: "active", label: "Active" },
          { value: "all", label: "All" },
          { value: "no-master", label: "No master" },
        ],
        matches: (r, v) =>
          v === "active" ? r.is_active : v === "no-master" ? !r.masterLabel : true,
      },
    ],
    []
  );

  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
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

  // `history.replaceState`, never `router.replace`: the filtering is all
  // client-side over rows the server already sent, and a replace would re-run
  // the page and its whole cost graph on every keystroke.
  function writeUrl(
    nextFilters: FilterValues,
    nextSearch: string,
    nextSort: ListSort | null
  ) {
    window.history.replaceState(
      null,
      "",
      filterHref(PATH, dimensions, nextFilters, nextSearch, nextSort)
    );
  }

  function changeTier(next: string) {
    const nextFilters = { ...filters, tier: next };
    setFilters(nextFilters);
    writeUrl(nextFilters, search, sort);
  }

  function changeSearch(next: string) {
    setSearch(next);
    writeUrl(filters, next, sort);
  }

  function changeSort(next: ListSort) {
    setSort(next);
    writeUrl(filters, search, next);
  }

  // Search first, so the tab counts describe the list you are looking at
  // rather than the whole catalog — `FilterMenus`' rule, applied to a
  // TabPicker. Before this they were computed over every row, so searching
  // "glaze" left the tabs claiming 116.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.elementName.toLowerCase().includes(q) ||
        (r.recipe_type ?? "").toLowerCase().includes(q) ||
        // The Master column prints "v11", so "v11" should find it. The other
        // thing that column says — "none" — is deliberately NOT matched here:
        // the no-master tier beside the box already answers that, and a search
        // term that secretly means a filter is a worse way to ask.
        (r.masterLabel ? `v${r.masterLabel}`.toLowerCase().includes(q) : false)
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );
  const counts = filterCounts(searched, dimensions, filters).tier;

  /** This view's own address — where a link back from a recipe returns to. */
  const listHref = filterHref(PATH, dimensions, filters, search, sort);

  /**
   * Every recipe link carries the filtered view, so the breadcrumb lands you
   * back on it — and the record book keys off `crumbPath` of that crumb, which
   * drops the query, so the key stays a bare "/recipes" however it is filtered.
   */
  const detailHref = (id: string) =>
    withFrom(`/recipes/${id}`, { href: listHref, label: "Recipes" });

  const columns: DataColumn<RecipeRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_recipes" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "name",
      label: "Recipe",
      width: 300,
      pinned: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={detailHref(r.id)} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "element",
      label: "Makes",
      width: 240,
      sortValue: (r) => r.elementName,
      render: (r) => (
        <Link href={`/elements/${r.elementId}`} className="text-muted hover:underline">
          {r.elementName}
        </Link>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 140,
      sortValue: (r) => r.recipe_type ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.recipe_type ?? "—"}</span>,
    },
    {
      key: "versions",
      label: "Versions",
      width: 110,
      align: "right",
      sortValue: (r) => r.versionCount,
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="tabular-nums text-muted">{r.versionCount}</span>,
    },
    {
      key: "master",
      label: "Master",
      width: 110,
      sortValue: (r) => r.masterLabel ?? "",
      sortTiebreaks: [(r) => r.name],
      // A family with no master is the one state that breaks costing, so it is
      // marked rather than left blank — yellow, because it is worth an eye
      // rather than wrong (the receiving screen's rule).
      render: (r) =>
        r.masterLabel ? (
          <span className="text-muted">v{r.masterLabel}</span>
        ) : (
          <span className="text-mark">none</span>
        ),
    },
    {
      key: "cost",
      label: "Cost",
      width: 170,
      align: "right",
      sortValue: (r) => r.cost.cost,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums" title={unresolvedSummary(r.cost) ?? undefined}>
          {formatCost(r.cost)}
          {/* The unit is what makes the figure readable: half this catalog is
              priced per gram and the other half per each, and "$0.0024" beside
              "$0.53" says nothing without it. */}
          {r.cost.cost === null ? null : (
            <span className="ml-1 text-[12px] font-normal text-muted">
              / {r.cost.unit ?? "unit"}
            </span>
          )}
        </span>
      ),
    },
  ];

  // The rows in the order the table shows them — `DataTable` is told the sort
  // rather than finding one, so these two can never disagree. Not wrapped in
  // `useMemo`: `columns` is rebuilt every render (its cells close over
  // `detailHref`), so a manual memo would recompute anyway AND stop the React
  // Compiler optimising this component at all.
  const sorted = sortRows(visible, columns, sort);

  // The list publishes what it is showing, IN THAT ORDER, so a detail screen
  // walks the found set the way you are reading it.
  usePublishRecordSet(
    PATH,
    sorted.map((r) => ({ id: r.id, href: detailHref(r.id) }))
  );

  const group: DataGroup<RecipeRow> = {
    sortKey: "type",
    label: (r) => r.recipe_type ?? "No type",
  };

  return (
    <div className="space-y-4">
      <PageHeading
        title="Recipes"
        visible={visible.length}
        total={rows.length}
        noun="recipes"
        action={action}
      />
    <DataTable
      rows={sorted}
      sort={sort}
      onSortChange={changeSort}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-recipes"
      compactBelow={1280}
      columnChooser
      group={group}
      empty={<p className="text-sm text-muted">No recipes match these filters.</p>}
      leading={
        <div className="flex flex-wrap items-end gap-3">
          <TextInput
            value={search}
            onValueChange={changeSearch}
            placeholder="Search recipes"
            className="w-64"
            aria-label="Search recipes"
            clearLabel="Clear the search"
          />
          <TabPicker
            ariaLabel="Which recipes"
            value={filters.tier ?? "active"}
            onChange={changeTier}
            options={dimensions[0].options.map((o) => ({
              key: o.value,
              label: o.label,
              count: counts[o.value],
            }))}
          />
        </div>
      }
    />
    </div>
  );
}
