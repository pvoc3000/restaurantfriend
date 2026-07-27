// URL-persisted filter + sort state for the PO list, same reasoning as
// lib/itemFilters.ts: it describes the view, so it belongs in the URL.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";
import { PO_STATUS_ORDER, type PoStatus } from "./purchaseOrders";
import { daysBefore, todayInTimeZone } from "./today";

export type StatusFilter = PoStatus | "all";

/**
 * The list is bounded by a date window rather than paged: 16.8k POs exist, but
 * the working set is "this Monday and the recent past". `all` is available for
 * archive digs and is deliberately the slow path.
 */
export const RANGES = [
  // Today and the rolling week are the ordering-day windows: on a Monday you
  // want the POs you just generated, not a quarter of history (Mark,
  // 2026-07-27). `days: 0` means "on or after today", so Today is a single day.
  { key: "0", label: "Today", days: 0 },
  { key: "7", label: "7 days", days: 7 },
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

/**
 * URL first, then how you left the list last time, then the defaults.
 *
 * Per FIELD, not per object: a shared link that pins only `?status=draft`
 * should still land on your remembered sort rather than resetting it.
 */
export function parsePoFilters(
  params: RawSearchParams,
  remembered: Partial<PoFilters> = {}
): PoFilters {
  const status = one(params.status);
  const range = one(params.range);
  const sort = one(params.sort);
  const dir = one(params.dir);
  const fallback = { ...DEFAULT_PO_FILTERS, ...remembered };
  return {
    // The search box is deliberately NOT remembered, same as the guide's:
    // coming back to a list silently narrowed by a term you've forgotten
    // typing is its own trap.
    q: one(params.q),
    status: (PO_STATUS_ORDER as string[]).includes(status)
      ? (status as PoStatus)
      : fallback.status,
    range: RANGES.some((r) => r.key === range)
      ? (range as RangeKey)
      : fallback.range,
    sort: (PO_SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as PoSortKey)
      : fallback.sort,
    dir: dir === "asc" || dir === "desc" ? dir : fallback.dir,
  };
}

/**
 * The list's remembered view, in a SESSION cookie — the same exception the
 * order guide makes and for the same reason: the nav link is a bare
 * `/purchase-orders` with no query to carry, so URL state alone resets every
 * time you come back through the menu (Mark, 2026-07-27). Lasts until you log
 * out; signOut deletes it.
 */
export const PO_VIEW_COOKIE = "rf.po.view";

export function serializePoView(filters: PoFilters): string {
  return new URLSearchParams({
    status: filters.status,
    range: filters.range,
    sort: filters.sort,
    dir: filters.dir,
  }).toString();
}

export function parsePoView(raw: string | undefined | null): Partial<PoFilters> {
  if (!raw) return {};
  const q = new URLSearchParams(raw);
  const status = q.get("status") ?? "";
  const range = q.get("range") ?? "";
  const sort = q.get("sort") ?? "";
  const dir = q.get("dir");

  const view: Partial<PoFilters> = {};
  if (status === "all" || (PO_STATUS_ORDER as string[]).includes(status))
    view.status = status as StatusFilter;
  if (RANGES.some((r) => r.key === range)) view.range = range as RangeKey;
  if ((PO_SORT_KEYS as readonly string[]).includes(sort)) view.sort = sort as PoSortKey;
  if (dir === "asc" || dir === "desc") view.dir = dir;
  return view;
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
    label: "POs",
  });
}

/**
 * The earliest order_date the window includes, or null for all time.
 *
 * Takes the ORG's timezone, not a Date: "today" has to be the org's calendar
 * day or a Today window computed on a UTC host starts hiding the afternoon's
 * orders (the same trap migration 007 exists to close for the guide — see
 * lib/today). The coarse windows barely noticed; a one-day window would.
 */
export function rangeStart(range: RangeKey, timeZone: string): string | null {
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  if (days === null) return null;
  const today = todayInTimeZone(timeZone);
  return days === 0 ? today : daysBefore(today, days);
}
