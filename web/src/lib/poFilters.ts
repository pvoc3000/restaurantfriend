// URL-persisted filter + sort state for the PO list, same reasoning as
// lib/itemFilters.ts: it describes the view, so it belongs in the URL.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";
import { PO_STATUS_ORDER, type PoStatus } from "./purchaseOrders";
import { daysBefore, todayInTimeZone } from "./today";
import {
  matchingPreset,
  parseRangeParams,
  type DateRange,
  type RangePreset,
} from "./dateRange";
import {
  appendVendorFilter,
  parseVendorFilter,
  VENDOR_FILTER_PARAM,
} from "./vendorFilter";

/**
 * The chip row is the five statuses plus two roll-ups: `all`, and `open` —
 * everything not yet closed (see isPoOpen), which is the list you work from.
 */
export type StatusFilter = PoStatus | "all" | "open";

/** The roll-ups, told apart from the raw statuses wherever both are parsed. */
const STATUS_ROLLUPS = ["all", "open"] as const;

function isStatusFilter(value: string): value is StatusFilter {
  return (
    (STATUS_ROLLUPS as readonly string[]).includes(value) ||
    (PO_STATUS_ORDER as string[]).includes(value)
  );
}

/**
 * The list is bounded by a date window rather than paged: 16.8k POs exist, but
 * the working set is "this Monday and the recent past". `all` is available for
 * archive digs and is deliberately the slow path.
 *
 * These are the `ui/RangePicker`'s PRESETS on this screen (Mark, 2026-09-08:
 * "use the options from the window tabpicker as presets") — the same six the
 * tabs offered, and their keys are still what the URL and the session cookie
 * carry, so a remembered `range=90` from before the picker still means what
 * it meant. Every one runs THROUGH TODAY, unlike `lib/dateRange`'s rolling
 * presets, which end yesterday: on an ordering day the orders you just
 * generated are the ones you came for.
 */
export const RANGES = [
  // `days: 0` means "on or after today", so Today is a single day.
  { key: "0", label: "Today", days: 0 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

function isRangeKey(value: string): value is RangeKey {
  return RANGES.some((r) => r.key === value);
}

/** A preset by key, or a pair of dates somebody tapped on the calendar. */
export type PoRange = RangeKey | DateRange;

export const PO_RANGE_PRESETS: RangePreset[] = RANGES.map((r) => ({
  key: r.key,
  label: r.label,
  range: (today: string) =>
    r.days === null ? null : { from: daysBefore(today, r.days), to: today },
}));

/**
 * The dates a range resolves to on `today`, or null for all time. This is
 * what the query and the picker both read, so they cannot disagree.
 */
export function poRangeBounds(range: PoRange, today: string): DateRange | null {
  if (typeof range !== "string") return range;
  return PO_RANGE_PRESETS.find((p) => p.key === range)?.range(today) ?? null;
}

/**
 * What the picker handed back, as a filter value: a pair that IS one of the
 * presets on `today` is stored by KEY, so "90 days" stays 90 days tomorrow
 * rather than freezing into the dates it happened to be today; a pair that
 * is none of them is stored as itself; a clear is all time.
 */
export function poRangeFromPicker(picked: DateRange | null, today: string): PoRange {
  const preset = matchingPreset(picked, PO_RANGE_PRESETS, today);
  if (preset) return preset.key as RangeKey;
  return picked ?? "all";
}

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
  /** Vendor NAMES; empty means every vendor. See lib/vendorFilter. */
  vendors: string[];
  range: PoRange;
  sort: PoSortKey;
  dir: SortDir;
};

export const DEFAULT_PO_FILTERS: PoFilters = {
  q: "",
  status: "all",
  vendors: [],
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
  const custom = parseRangeParams(params.from, params.to);
  const sort = one(params.sort);
  const dir = one(params.dir);
  const fallback = { ...DEFAULT_PO_FILTERS, ...remembered };
  return {
    // The search box is deliberately NOT remembered, same as the guide's:
    // coming back to a list silently narrowed by a term you've forgotten
    // typing is its own trap.
    q: one(params.q),
    status: isStatusFilter(status) ? status : fallback.status,
    // REMEMBERED, unlike the search box: a vendor is a standing way of working
    // ("I only order from BakeMark on Tuesdays"), where a typed term is
    // usually one lookup you have already finished with. The picker also says
    // which vendors are in force at a glance, where a search box that had
    // silently survived would not.
    vendors: params[VENDOR_FILTER_PARAM]
      ? parseVendorFilter(params[VENDOR_FILTER_PARAM])
      : fallback.vendors ?? [],
    // A key wins over a pair; a pair wins over the fallback; half a pair is
    // nothing (`parseRangeParams`' rule).
    range: isRangeKey(range) ? range : (custom ?? fallback.range),
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
  const params = new URLSearchParams({
    status: filters.status,
    sort: filters.sort,
    dir: filters.dir,
  });
  appendRange(params, filters.range);
  appendVendorFilter(params, filters.vendors);
  return params.toString();
}

export function parsePoView(raw: string | undefined | null): Partial<PoFilters> {
  if (!raw) return {};
  const q = new URLSearchParams(raw);
  const status = q.get("status") ?? "";
  const range = q.get("range") ?? "";
  const custom = parseRangeParams(q.get("from") ?? undefined, q.get("to") ?? undefined);
  const sort = q.get("sort") ?? "";
  const dir = q.get("dir");

  const view: Partial<PoFilters> = {};
  if (isStatusFilter(status)) view.status = status;
  const vendors = parseVendorFilter(q.getAll(VENDOR_FILTER_PARAM));
  if (vendors.length > 0) view.vendors = vendors;
  if (isRangeKey(range)) view.range = range;
  else if (custom) view.range = custom;
  if ((PO_SORT_KEYS as readonly string[]).includes(sort)) view.sort = sort as PoSortKey;
  if (dir === "asc" || dir === "desc") view.dir = dir;
  return view;
}

export function poFiltersToQuery(filters: PoFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== DEFAULT_PO_FILTERS.status) params.set("status", filters.status);
  appendVendorFilter(params, filters.vendors);
  if (filters.range !== DEFAULT_PO_FILTERS.range) appendRange(params, filters.range);
  if (filters.sort !== DEFAULT_PO_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dir !== DEFAULT_PO_FILTERS.dir) params.set("dir", filters.dir);
  return params.toString();
}

/** `range=<key>` for a preset, `from=&to=` for a custom pair. */
function appendRange(params: URLSearchParams, range: PoRange): void {
  if (typeof range === "string") params.set("range", range);
  else {
    params.set("from", range.from);
    params.set("to", range.to);
  }
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
 * The earliest order_date a PRESET window includes, or null for all time.
 * Kept for `/invoices`, which still filters by these keys as a row of tabs;
 * the PO list reads `poRangeBounds` instead.
 */
export function rangeStart(range: RangeKey, timeZone: string): string | null {
  return poRangeBounds(range, todayInTimeZone(timeZone))?.from ?? null;
}
