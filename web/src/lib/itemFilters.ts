// The /items list filters, in the URL rather than in component state, so they
// survive a trip into item detail and back (and are shareable/bookmarkable).
// Defaults are omitted from the query string to keep the bare /items URL clean.

import { STALE_ORDER, type StaleBucket } from "./lastOrdered";

export type ActiveFilter = "active" | "inactive" | "all";
export type StaleFilter = StaleBucket | "any";

/** Sortable columns on the items list, keyed by what they sort on. */
export const SORT_KEYS = [
  "name",
  "category",
  "section",
  "par",
  "unit",
  "vendor",
  "price",
  "last",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export type ItemFilters = {
  q: string;
  category: string;
  active: ActiveFilter;
  stale: StaleFilter;
  sort: SortKey;
  dir: SortDir;
};

export const DEFAULT_ITEM_FILTERS: ItemFilters = {
  q: "",
  category: "",
  active: "active",
  stale: "any",
  sort: "name",
  dir: "asc",
};

/** Next passes searchParams as string | string[] | undefined per key. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseItemFilters(params: RawSearchParams): ItemFilters {
  const active = one(params.active);
  const stale = one(params.stale);
  const sort = one(params.sort);
  const dir = one(params.dir);
  return {
    q: one(params.q),
    category: one(params.cat),
    active:
      active === "inactive" || active === "all" || active === "active"
        ? active
        : DEFAULT_ITEM_FILTERS.active,
    stale: (STALE_ORDER as string[]).includes(stale)
      ? (stale as StaleBucket)
      : DEFAULT_ITEM_FILTERS.stale,
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
  if (filters.stale !== DEFAULT_ITEM_FILTERS.stale) params.set("stale", filters.stale);
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
 * Item detail carries the list's filters through so its back link can restore
 * them — the browser Back button works either way, but the in-page link is the
 * one people actually click.
 */
export function itemDetailHref(id: string, filters: ItemFilters): string {
  const query = itemFiltersToQuery(filters);
  return query ? `/items/${id}?${query}` : `/items/${id}`;
}
