"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
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
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";
import { formatMargin, type PriceSource } from "@/lib/productionPrice";

export type ProductionItemRow = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  price_class: string | null;
  price_tier: string | null;
  is_active: boolean;
  componentCount: number;
  cost: Cost;
  price: number | null;
  priceSource: PriceSource;
  margin: number | null;
};

/** No option's value may be "", which is what FILTER_ALL already means. */
const NONE = "none";

/** This list's own address — its URL, its record-set key, its crumb. */
const PATH = "/production-items";

/**
 * Every column you can sort by — the `columns` array below, minus the ones with
 * no `sortValue`. KEEP THE TWO IN STEP: a key missing here is a column whose
 * sort still works and is silently forgotten on the way back, which is the
 * whole complaint this list is answering. It exists as a constant because the
 * URL has to be parsed before `columns` can be built (a cell links to this
 * view, so the columns depend on the state seeded from it).
 */
const SORT_KEYS = [
  "active",
  "name",
  "type",
  "size",
  "cut",
  "finish",
  "components",
  "cost",
  "price",
  "margin",
] as const;

/** Whatever a column actually holds, A–Z, with a "None" option after it. */
function vocabulary(
  rows: ProductionItemRow[],
  read: (r: ProductionItemRow) => string | null
): { value: string; label: string }[] {
  const found = [...new Set(rows.map(read).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b)
  );
  return [...found.map((v) => ({ value: v, label: v })), { value: NONE, label: "None" }];
}

/**
 * The menu — what you assemble and sell, against what it costs to make.
 *
 * FileMaker computed cost, profit and a cost-to-price ratio on every item and
 * FROZE all three; rows still carry figures derived from 2022 prices. These are
 * derived on every load instead, which is decision 11 reaching the layer where
 * it is most visible: a flour price that moved this morning moves the margin on
 * 244 raised donuts this afternoon.
 *
 * Grouped by TYPE — few values, many rows each (Raised 244, Cake 32 of 307),
 * which is the test a column has to pass to earn a band.
 *
 * FIVE COMBINING MENUS (`ui/FilterMenus`) — Mark's list, in the columns' own
 * order: Status · Dough · Finish · Cost · Price. He named Finish before Dough
 * and then asked for them swapped, which is the right instinct: the bar is read
 * against the table directly beneath it, so a menu row that disagrees with the
 * column order makes you check the label every time.
 * The tab row they replace held four cells answering three
 * different questions — one was activity, two were whether a figure resolves —
 * so "the unpriced raised donuts finished in BOH Glaze" could not be asked at
 * all. Labels follow the element list rather than the words Mark used, so the
 * two screens read alike: Status over Active/Inactive (a menu labelled "Active"
 * whose value reads "Inactive" is a sentence that argues with itself), and
 * Cost / Price over Costed / Priced.
 *
 * THE TAXONOMY IS THE DATA'S OWN VOCABULARY, not a written-down list: `finish`
 * holds 13 values today (Plain 234, BOH Glaze 33, Granulated Sugar 14, then a
 * long tail of ones and twos), and Type, Size and Cut the same. Past eight
 * options `PickList` grows a find box by itself, which is what makes a menu of
 * thirteen glazes usable.
 *
 * Each carries NONE — 5 items have no finish — and those are exactly the rows
 * somebody has to fix. The old tab row could not express it.
 *
 * Status is latent today: all 307 items are active. It is here because Mark
 * asked for it and because the column is real; note the tab row DEFAULTED to
 * Active, and these menus default to All, which changes what the screen shows
 * by nothing at all until the first item is switched off.
 */
export function ProductionItemsList({
  rows,
  editable,
  initialFilters,
  initialSearch = "",
}: {
  rows: ProductionItemRow[];
  editable: boolean;
  /** The URL's query, raw — validated below against the real vocabulary. */
  initialFilters?: RawSearchParams;
  initialSearch?: string;
}) {
  // Before the state that is validated against it — `parseFilterValues` needs
  // the options to know which of the URL's values are real.
  const dimensions = useMemo<FilterDimension<ProductionItemRow>[]>(
    () => [
      {
        key: "active",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
        matches: (r, v) => (v === "active" ? r.is_active : !r.is_active),
      },
      // DOUGH BEFORE FINISH, matching the columns (Mark, 2026-08-09). The menus
      // are read against the table directly under them, so a bar whose order
      // disagrees with the columns makes you check the label every time. This
      // is also the order a donut is made in.
      {
        key: "type",
        label: "Type",
        options: vocabulary(rows, (r) => r.item_type),
        matches: (r, v) => (v === NONE ? r.item_type === null : r.item_type === v),
      },
      {
        key: "size",
        label: "Size",
        options: vocabulary(rows, (r) => r.size),
        matches: (r, v) => (v === NONE ? r.size === null : r.size === v),
      },
      {
        key: "cut",
        label: "Cut",
        options: vocabulary(rows, (r) => r.subtype),
        matches: (r, v) => (v === NONE ? r.subtype === null : r.subtype === v),
      },
      {
        key: "finish",
        label: "Finish",
        options: vocabulary(rows, (r) => r.finish),
        matches: (r, v) => (v === NONE ? r.finish === null : r.finish === v),
      },
      {
        key: "cost",
        label: "Cost",
        options: [
          { value: "costed", label: "Costed" },
          { value: "uncosted", label: "Uncosted" },
        ],
        matches: (r, v) => (v === "uncosted" ? r.cost.cost === null : r.cost.cost !== null),
      },
      {
        key: "price",
        label: "Price",
        options: [
          { value: "priced", label: "Priced" },
          { value: "unpriced", label: "Unpriced" },
        ],
        matches: (r, v) => (v === "unpriced" ? r.price === null : r.price !== null),
      },
    ],
    [rows]
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
  // THE SORT IS THIS LIST'S, not `DataTable`'s. Two things follow: it survives
  // the trip to an item and back like every other part of the view, and the
  // found set below can be published IN THE ORDER THE TABLE SHOWS, which is
  // what `lib/recordSet` has always claimed and this screen could not deliver.
  // Null is the natural order the server sent, and writes no parameter.
  const [sort, setSort] = useState<ListSort | null>(() =>
    parseListSort(urlFilterParams(PATH) ?? initialFilters ?? {}, SORT_KEYS)
  );

  // `history.replaceState`, never `router.replace`: the filtering is all
  // client-side over rows the server already sent, and a replace would re-run
  // the page — both cost graphs and the price grid — on every keystroke.
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

  function changeFilters(next: FilterValues) {
    setFilters(next);
    writeUrl(next, search, sort);
  }

  function changeSearch(next: string) {
    setSearch(next);
    writeUrl(filters, next, sort);
  }

  function changeSort(next: ListSort) {
    setSort(next);
    writeUrl(filters, search, next);
  }

  // Search first, so the menus' counts describe the list you are looking at.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        [r.item_type, r.subtype, r.finish, r.size].some((v) =>
          (v ?? "").toLowerCase().includes(q)
        )
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  /** This view's own address — where a link back from an item returns to. */
  const listHref = filterHref(PATH, dimensions, filters, search, sort);

  /**
   * Every item link carries the FILTERED view, which lands you back where you
   * left and — the part that isn't cosmetic — switches the record book on:
   * item detail finds its found set by `crumbPath` of the crumb that led it
   * there, and with no crumb there was nothing to find. `crumbPath` drops the
   * query, so the key stays a bare "/production-items" however it is filtered.
   */
  const detailHref = (id: string) =>
    withFrom(`/production-items/${id}`, { href: listHref, label: "Items" });

  const columns: DataColumn<ProductionItemRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_items" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "name",
      label: "Item",
      width: 300,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.name,
      sortTiebreaks: [(r) => r.size ?? "", (r) => r.subtype ?? ""],
      // The name alone is ambiguous — "Angry Samoa" is four donuts (038) — so
      // the row carries the taxonomy that distinguishes them underneath it.
      render: (r) => (
        <span className="block">
          <Link href={detailHref(r.id)} className="font-medium hover:underline">
            {r.name}
          </Link>
          <span className="block text-[12px] text-subtle">
            {[r.size, r.item_type, r.subtype].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    // TYPE · SIZE · CUT · FINISH, in that order, which is the order the premade
    // schedule sorts and groups by (Mark, 2026-08-13: "Angry samoa type: Cake /
    // cut: Vanilla / finish: Plain / size: regular … THAT'S ALL YOU NEED").
    // They replace a Dough column, which named a field that no longer exists —
    // an item is a list of components, and none of them is special.
    {
      key: "type",
      label: "Type",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.item_type ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.item_type ?? "—"}</span>,
    },
    {
      key: "size",
      label: "Size",
      width: 100,
      hideWhenCompact: true,
      sortValue: (r) => r.size ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.size ?? "—"}</span>,
    },
    {
      key: "cut",
      label: "Cut",
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => r.subtype ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.subtype ?? "—"}</span>,
    },
    {
      key: "finish",
      label: "Finish",
      // 150, not 130: "Granulated Sugar" is 14 rows and truncated to
      // "Granulated Su…" at a 1280 window. Free to change here because the
      // widths key was bumped for the reorder anyway.
      width: 150,
      hideWhenCompact: true,
      sortValue: (r) => r.finish ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.finish ?? "—"}</span>,
    },
    {
      key: "components",
      label: "On it",
      width: 90,
      align: "right",
      sortValue: (r) => r.componentCount,
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="tabular-nums text-muted">{r.componentCount}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      width: 130,
      align: "right",
      sortValue: (r) => r.cost.cost,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums" title={unresolvedSummary(r.cost) ?? undefined}>
          {formatCost(r.cost)}
        </span>
      ),
    },
    {
      key: "price",
      label: "Price",
      width: 130,
      align: "right",
      sortValue: (r) => r.price,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums">
          {r.price === null ? "—" : `$${r.price.toFixed(2)}`}
          {/* Yellow, not red: an override is worth an eye, never an error. */}
          {r.priceSource === "item" || r.priceSource === "location" ? (
            <span className="ml-1 text-mark" title={`Overridden at this ${r.priceSource === "item" ? "item" : "location"}`}>
              *
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "margin",
      label: "Margin",
      width: 110,
      align: "right",
      sortValue: (r) => r.margin,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span
          className="tabular-nums"
          // A margin computed from an incomplete cost is an UPPER bound, so it
          // is marked rather than shown as if it were the answer.
          title={r.cost.unresolved.length ? "At most — some components are unpriced" : undefined}
        >
          {r.cost.unresolved.length && r.margin !== null ? "≤ " : ""}
          {formatMargin(r.margin)}
        </span>
      ),
    },
  ];

  /**
   * ONE GROUPING PER SORT COLUMN — band by whatever you are sorting by.
   *
   * This used to be a single `{ sortKey: "name", label: item_type }`, which
   * banded by TYPE while you were sorting by NAME: a heading every few rows
   * cutting across an A-Z list, naming a field the order had nothing to do with
   * (Mark, 2026-08-13: "when sorting by item name there's no need to group the
   * list by type. When sorting by size, type, cut, or finish, you can group by
   * those fields"). It was also backwards from the rule the rest of the app
   * follows — a band can only band what the ORDER already groups, so it belongs
   * on the column being sorted.
   *
   * Name is deliberately ABSENT: 307 distinct names is 307 bands of one row.
   * So are Cost, Price, Margin and On it — a number bands nothing, and the
   * count beside each label would read as a tally of a value nobody grouped by.
   */
  // The rows in the order the table shows them — `DataTable` is told the sort
  // rather than finding one, so these two can never disagree.
  // Not wrapped in `useMemo`: `columns` is rebuilt every render (its cells close
  // over `detailHref`), so a manual memo would recompute anyway AND stop the
  // React Compiler optimising this component at all. Sorting a few hundred rows
  // is nothing; `sortRows` returns the array untouched when there is no sort.
  const sorted = sortRows(visible, columns, sort);

  // The list publishes what it is showing, IN THAT ORDER, so a detail screen
  // walks the found set rather than sending you back here for the next one.
  usePublishRecordSet(
    PATH,
    sorted.map((r) => ({ id: r.id, href: detailHref(r.id) }))
  );

  const groups: DataGroup<ProductionItemRow>[] = [
    { sortKey: "type", label: (r) => r.item_type ?? "No type" },
    { sortKey: "size", label: (r) => r.size ?? "No size" },
    { sortKey: "cut", label: (r) => r.subtype ?? "No cut" },
    { sortKey: "finish", label: (r) => r.finish ?? "No finish" },
  ];

  return (
    <DataTable
      rows={sorted}
      sort={sort}
      onSortChange={changeSort}
      columns={columns}
      rowKey={(r) => r.id}
      // v2 because Dough and Finish swapped places. A STORED COLUMN ORDER
      // OUTRANKS THE DECLARED ONE, so without the bump anyone who had ever
      // dragged a column here would keep the old arrangement and the change
      // would look like it had not happened. Cost: dragged widths and hidden
      // columns on this one table go back to their defaults.
      storageKey="production-items.v3"
      compactBelow={1280}
      columnChooser
      group={groups}
      empty={<p className="text-sm text-muted">No items match these filters.</p>}
      leading={
        <div className="space-y-3">
          <FilterMenus
            rows={searched}
            total={rows.length}
            noun="items"
            dimensions={dimensions}
            values={filters}
            onChange={changeFilters}
            leading={
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Search
                </span>
                <TextInput
                  value={search}
                  onValueChange={changeSearch}
                  placeholder="Name, dough, finish…"
                  // w-56 rather than w-64 for the same measurement as the
                  // menus beside it: the bar has to hold on one line.
                  className="w-56"
                  aria-label="Search items"
                  clearLabel="Clear the search"
                />
              </div>
            }
          />
          {filters.price === "unpriced" ? (
            <p className="max-w-[80ch] text-[13px] text-muted">
              These carry no price class or tier, so the grid has no cell for
              them. Setting both gives them a price without touching a number.
            </p>
          ) : null}
        </div>
      }
    />
  );
}
