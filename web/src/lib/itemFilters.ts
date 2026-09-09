// The /items list filters, in the URL rather than in component state, so they
// survive a trip into item detail and back (and are shareable/bookmarkable).
// Defaults are omitted from the query string to keep the bare /items URL clean.

import { withFrom } from "./breadcrumbs";
import { daysBefore } from "./today";
import { parseRangeParams, type DateRange, type RangePreset } from "./dateRange";

export type ActiveFilter = "active" | "inactive" | "all";

/**
 * The `ui/RangePicker`'s presets on this list (Mark, 2026-09-08, replacing the
 * Last-ordered tabs) — the same three age bands the tabs offered, as ranges
 * over the LAST ORDER DATE, plus All time. A year is 365 days here where the
 * tabs' `staleBucket` counted a calendar year — a day's drift at a boundary
 * nobody reads to the day.
 *
 * NEVER ORDERED HAS NO RANGE and so is not a preset: an item with no last
 * order date matches no range at all, so any range set here hides it, and only
 * All time shows it. The column still says "never" on the row, and sorting by
 * Last ordered sinks them last.
 */
export const LAST_ORDERED_PRESETS: RangePreset[] = [
  {
    key: "within1y",
    label: "Within a year",
    range: (today) => ({ from: daysBefore(today, 365), to: today }),
  },
  {
    key: "1to2y",
    label: "1–2 years ago",
    range: (today) => ({ from: daysBefore(today, 730), to: daysBefore(today, 366) }),
  },
  {
    key: "over2y",
    label: "Over 2 years ago",
    // A floor rather than an open end: a range is two dates, and nothing in
    // this catalog predates the shop.
    range: (today) => ({ from: "2000-01-01", to: daysBefore(today, 731) }),
  },
  { key: "all", label: "All time", range: () => null },
];

/**
 * Sortable columns on the items list, keyed by what they sort on.
 * "vendor" and "price" went with migration 012: both sorted on the item's
 * DEFAULT vendor item, and there is no longer a single vendor item per
 * item-location to speak for the row.
 */
export const SORT_KEYS = [
  "name",
  "category",
  "section",
  "par",
  "unit",
  "last",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export type ItemFilters = {
  q: string;
  category: string;
  active: ActiveFilter;
  /** Last ordered within these dates; null is any age. */
  last: DateRange | null;
  sort: SortKey;
  dir: SortDir;
};

export const DEFAULT_ITEM_FILTERS: ItemFilters = {
  q: "",
  category: "",
  active: "active",
  last: null,
  sort: "name",
  dir: "asc",
};

/**
 * Next passes searchParams as string | string[] | undefined per key.
 *
 * Defined once in `lib/filterMenus` (which owns the app's general URL-filter
 * contract) and re-exported here, so the pages that already import it from this
 * module keep working and there is still only one definition.
 */
export type { RawSearchParams } from "./filterMenus";
type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseItemFilters(params: RawSearchParams): ItemFilters {
  const active = one(params.active);
  const sort = one(params.sort);
  const dir = one(params.dir);
  return {
    q: one(params.q),
    category: one(params.cat),
    active:
      active === "inactive" || active === "all" || active === "active"
        ? active
        : DEFAULT_ITEM_FILTERS.active,
    // Half a pair is nothing (`parseRangeParams`' rule), so a hand-edited URL
    // cannot narrow the list to a window nobody chose.
    last: parseRangeParams(params.from, params.to),
    sort: (SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as SortKey)
      : DEFAULT_ITEM_FILTERS.sort,
    dir: dir === "desc" ? "desc" : DEFAULT_ITEM_FILTERS.dir,
  };
}

export function itemFiltersToQuery(filters: ItemFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.category) params.set("cat", filters.category);
  if (filters.active !== DEFAULT_ITEM_FILTERS.active) params.set("active", filters.active);
  if (filters.last) {
    params.set("from", filters.last.from);
    params.set("to", filters.last.to);
  }
  if (filters.sort !== DEFAULT_ITEM_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dir !== DEFAULT_ITEM_FILTERS.dir) params.set("dir", filters.dir);
  return params.toString();
}

/** `/items` with the non-default filters, e.g. `/items?cat=Dry%20Goods`. */
export function itemsHref(filters: ItemFilters): string {
  const query = itemFiltersToQuery(filters);
  return query ? `/items?${query}` : "/items";
}

/**
 * Item detail records the filtered list as its breadcrumb, so the trail leads
 * back to the exact view you left rather than to a reset list.
 */
export function itemDetailHref(id: string, filters: ItemFilters): string {
  return withFrom(`/items/${id}`, { href: itemsHref(filters), label: "Inventory" });
}
