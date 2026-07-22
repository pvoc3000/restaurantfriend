// URL-persisted filter + sort state for the PO list, same reasoning as
// lib/itemFilters.ts: it describes the view, so it belongs in the URL.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";
import { PO_STATUS_ORDER, type PoStatus } from "./purchaseOrders";

export type StatusFilter = PoStatus | "all";

/**
 * The list is bounded by a date window rather than paged: 16.8k POs exist, but
 * the working set is "this Monday and the recent past". `all` is available for
 * archive digs and is deliberately the slow path.
 */
export const RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export const PO_SORT_KEYS = [
  "po_number",
  "order_date",
  "vendor",
  "status",
  "lines",
  "total",
] as const;
export type PoSortKey = (typeof PO_SORT_KEYS)[number];

export type PoFilters = {
  q: string;
  status: StatusFilter;
  range: RangeKey;
  sort: PoSortKey;
  dir: SortDir;
};

export const DEFAULT_PO_FILTERS: PoFilters = {
  q: "",
  status: "all",
  range: "90",
  sort: "order_date",
  dir: "desc",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parsePoFilters(params: RawSearchParams): PoFilters {
  const status = one(params.status);
  const range = one(params.range);
  const sort = one(params.sort);
  const dir = one(params.dir);
  return {
    q: one(params.q),
    status: (PO_STATUS_ORDER as string[]).includes(status)
      ? (status as PoStatus)
      : DEFAULT_PO_FILTERS.status,
    range: RANGES.some((r) => r.key === range)
      ? (range as RangeKey)
      : DEFAULT_PO_FILTERS.range,
    sort: (PO_SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as PoSortKey)
      : DEFAULT_PO_FILTERS.sort,
    dir: dir === "asc" ? "asc" : DEFAULT_PO_FILTERS.dir,
  };
}

export function poFiltersToQuery(filters: PoFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== DEFAULT_PO_FILTERS.status) params.set("status", filters.status);
  if (filters.range !== DEFAULT_PO_FILTERS.range) params.set("range", filters.range);
  if (filters.sort !== DEFAULT_PO_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dir !== DEFAULT_PO_FILTERS.dir) params.set("dir", filters.dir);
  return params.toString();
}

export function poListHref(filters: PoFilters): string {
  const query = poFiltersToQuery(filters);
  return query ? `/purchase-orders?${query}` : "/purchase-orders";
}

export function poDetailHref(id: string, filters: PoFilters): string {
  return withFrom(`/purchase-orders/${id}`, {
    href: poListHref(filters),
    label: "Orders",
  });
}

/** The earliest order_date the window includes, or null for all time. */
export function rangeStart(range: RangeKey, today: Date): string | null {
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  if (days === null) return null;
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}
