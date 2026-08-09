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
  parseFilterValues,
  type FilterDimension,
  type FilterValues,
  type RawSearchParams,
} from "@/lib/filterMenus";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";
import { formatMargin, type PriceSource } from "@/lib/productionPrice";

export type ProductionItemRow = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  baseName: string | null;
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
 * FIVE COMBINING MENUS (`ui/FilterMenus`), Mark's list: Active, Finish, Dough,
 * Costed, Priced. The tab row they replace held four cells answering three
 * different questions — one was activity, two were whether a figure resolves —
 * so "the unpriced raised donuts finished in BOH Glaze" could not be asked at
 * all. Labels follow the element list rather than the words Mark used, so the
 * two screens read alike: Status over Active/Inactive (a menu labelled "Active"
 * whose value reads "Inactive" is a sentence that argues with itself), and
 * Cost / Price over Costed / Priced.
 *
 * FINISH AND DOUGH ARE THE DATA'S OWN VOCABULARY, not a written-down list:
 * `finish` holds 13 values today (Plain 234, BOH Glaze 33, Granulated Sugar 14,
 * then a long tail of ones and twos) and the dough is whatever `base_element_id`
 * resolves to. Past eight options `PickList` grows a find box by itself, which
 * is what makes a menu of thirteen glazes usable.
 *
 * Both carry NONE — 5 items have no finish and 91 no dough, and those are
 * exactly the rows somebody has to fix. The old tab row could not express
 * either.
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
      {
        key: "finish",
        label: "Finish",
        options: vocabulary(rows, (r) => r.finish),
        matches: (r, v) => (v === NONE ? r.finish === null : r.finish === v),
      },
      {
        key: "dough",
        label: "Dough",
        options: vocabulary(rows, (r) => r.baseName),
        matches: (r, v) => (v === NONE ? r.baseName === null : r.baseName === v),
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

  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, initialFilters ?? {})
  );

  // `history.replaceState`, never `router.replace`: the filtering is all
  // client-side over rows the server already sent, and a replace would re-run
  // the page — both cost graphs and the price grid — on every keystroke.
  function writeUrl(nextFilters: FilterValues, nextSearch: string) {
    window.history.replaceState(
      null,
      "",
      filterHref("/production-items", dimensions, nextFilters, nextSearch)
    );
  }

  function changeFilters(next: FilterValues) {
    setFilters(next);
    writeUrl(next, search);
  }

  function changeSearch(next: string) {
    setSearch(next);
    writeUrl(filters, next);
  }

  // Search first, so the menus' counts describe the list you are looking at.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        [r.item_type, r.subtype, r.finish, r.size, r.baseName].some((v) =>
          (v ?? "").toLowerCase().includes(q)
        )
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  /** This view's own address — where a link back from an item returns to. */
  const listHref = filterHref("/production-items", dimensions, filters, search);

  /**
   * Every item link carries the FILTERED view, which lands you back where you
   * left and — the part that isn't cosmetic — switches the record book on:
   * item detail finds its found set by `crumbPath` of the crumb that led it
   * there, and with no crumb there was nothing to find. `crumbPath` drops the
   * query, so the key stays a bare "/production-items" however it is filtered.
   */
  const detailHref = (id: string) =>
    withFrom(`/production-items/${id}`, { href: listHref, label: "Items" });

  // The list publishes what it is showing, so a detail screen walks the found
  // set rather than sending you back here for the next one.
  usePublishRecordSet(
    "/production-items",
    visible.map((r) => ({ id: r.id, href: detailHref(r.id) }))
  );

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
    // DOUGH BEFORE FINISH (Mark, 2026-08-09) — the order a donut is made in,
    // which is also the order the two menus above sit in.
    {
      key: "dough",
      label: "Dough",
      width: 160,
      hideWhenCompact: true,
      sortValue: (r) => r.baseName ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.baseName ?? "—"}</span>,
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

  const group: DataGroup<ProductionItemRow> = {
    sortKey: "name",
    label: (r) => r.item_type ?? "No type",
  };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      // v2 because Dough and Finish swapped places. A STORED COLUMN ORDER
      // OUTRANKS THE DECLARED ONE, so without the bump anyone who had ever
      // dragged a column here would keep the old arrangement and the change
      // would look like it had not happened. Cost: dragged widths and hidden
      // columns on this one table go back to their defaults.
      storageKey="production-items.v2"
      compactBelow={1280}
      columnChooser
      group={group}
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
