// URL-persisted filter + sort state for the bill list — the same design as
// lib/poFilters.ts, including the session-cookie exception, because the nav
// link is a bare `/bills` with no query to carry.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";
import { appendRange, isRangeKey, type PoRange } from "./poFilters";
import { parseRangeParams } from "./dateRange";
import {
  appendVendorFilter,
  parseVendorFilter,
  VENDOR_FILTER_PARAM,
} from "./vendorFilter";
import { AGING_ORDER, BILL_STAGE_ORDER,
  type BillStage, type AgingBucket } from "./bills";

/**
 * The status chips: the three real statuses plus `all`.
 *
 * There is no `open` ROLL-UP here, unlike the PO list — `open` is already one
 * of the three, and a roll-up over "not void" would be a fourth chip that
 * almost always equals `all`.
 */
/**
 * IT FILTERS ON THE LADDER, NOT ON `bills.status` (2026-09-02). The chip in
 * the row says Open · Approved · Submitted · Paid · Void, and a filter offering
 * only the three stored values would be a second vocabulary for one column —
 * "Approved" would then include every bill already on the books and paid.
 *
 * Submitted and Paid are derived (`billStage`), so this filter is applied in
 * the browser over rows the server already sent, which it was anyway.
 */
export type BillStatusFilter = BillStage | "all";

function isStatusFilter(value: string): value is BillStatusFilter {
  return value === "all" || (BILL_STAGE_ORDER as string[]).includes(value);
}

/**
 * Bill or credit memo (Mark, 2026-09-19: "add a 'type' picklist to the bills
 * filter row with 'Bill' and 'Credit Memo' options"). `is_credit` underneath;
 * `all` is the default, so the list reads as it did before anyone touches it.
 */
export type BillKindFilter = "all" | "bill" | "credit";

export const BILL_KIND_LABEL: Record<BillKindFilter, string> = {
  all: "Any type",
  bill: "Bill",
  credit: "Credit Memo",
};

function isKindFilter(value: string): value is BillKindFilter {
  return value === "all" || value === "bill" || value === "credit";
}

/** The aging tiers, plus `all`. */
export type AgingFilter = AgingBucket | "all";

function isAgingFilter(value: string): value is AgingFilter {
  return value === "all" || (AGING_ORDER as string[]).includes(value);
}

export const BILL_SORT_KEYS = [
  "invoice_number",
  "invoice_date",
  "due_date",
  "vendor",
  "status",
  "po",
  "po_date",
  "total",
  "lines",
] as const;
export type BillSortKey = (typeof BILL_SORT_KEYS)[number];

export type BillFilters = {
  q: string;
  status: BillStatusFilter;
  /** Vendor NAMES; empty means every vendor. See lib/vendorFilter. */
  vendors: string[];
  aging: AgingFilter;
  kind: BillKindFilter;
  /**
   * The PO list's window, key or custom pair — `lib/poFilters` owns the
   * presets so the two lists cannot drift on what "90 days" means, and the
   * `ui/RangePicker` on this screen offers the same six.
   */
  range: PoRange;
  sort: BillSortKey;
  dir: SortDir;
};

/**
 * Two defaults differ from the PO list's, both deliberately.
 *
 * `status: "open"` — where the PO list opens on `all`, this list exists to
 * answer "what do I owe a decision on", and a bill you have already approved is
 * not that.
 *
 * `sort: due_date` ascending — the working order for bills is soonest-first.
 * `lib/tableSort` sinks empty cells last in BOTH directions, so the rent bill
 * with no printed due date lands at the bottom rather than at the top pretending
 * to be urgent.
 */
export const DEFAULT_BILL_FILTERS: BillFilters = {
  q: "",
  status: "open",
  vendors: [],
  aging: "all",
  kind: "all",
  range: "90",
  sort: "due_date",
  dir: "asc",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** URL first, then how you left the list last time, then the defaults. */
export function parseBillFilters(
  params: RawSearchParams,
  remembered: Partial<BillFilters> = {}
): BillFilters {
  const status = one(params.status);
  const aging = one(params.aging);
  const kind = one(params.kind);
  const range = one(params.range);
  const custom = parseRangeParams(params.from, params.to);
  const sort = one(params.sort);
  const dir = one(params.dir);
  const fallback = { ...DEFAULT_BILL_FILTERS, ...remembered };
  return {
    // Not remembered, matching the PO list: coming back to a list silently
    // narrowed by a term you've forgotten typing is its own trap.
    q: one(params.q),
    status: isStatusFilter(status) ? status : fallback.status,
    // Remembered, for the reason written in lib/poFilters.
    vendors: params[VENDOR_FILTER_PARAM]
      ? parseVendorFilter(params[VENDOR_FILTER_PARAM])
      : fallback.vendors ?? [],
    aging: isAgingFilter(aging) ? aging : fallback.aging,
    kind: isKindFilter(kind) ? kind : fallback.kind,
    range: isRangeKey(range) ? range : (custom ?? fallback.range),
    sort: (BILL_SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as BillSortKey)
      : fallback.sort,
    dir: dir === "asc" || dir === "desc" ? dir : fallback.dir,
  };
}

/** Session cookie, deleted by signOut — see PO_VIEW_COOKIE for the argument. */
export const BILL_VIEW_COOKIE = "rf.bill.view";

export function serializeBillView(filters: BillFilters): string {
  const params = new URLSearchParams({
    status: filters.status,
    aging: filters.aging,
    kind: filters.kind,
    sort: filters.sort,
    dir: filters.dir,
  });
  appendRange(params, filters.range);
  appendVendorFilter(params, filters.vendors);
  return params.toString();
}

export function parseBillView(
  raw: string | undefined | null
): Partial<BillFilters> {
  if (!raw) return {};
  const q = new URLSearchParams(raw);
  const status = q.get("status") ?? "";
  const aging = q.get("aging") ?? "";
  const kind = q.get("kind") ?? "";
  const range = q.get("range") ?? "";
  const custom = parseRangeParams(q.get("from") ?? undefined, q.get("to") ?? undefined);
  const sort = q.get("sort") ?? "";
  const dir = q.get("dir");

  const view: Partial<BillFilters> = {};
  if (isStatusFilter(status)) view.status = status;
  const vendors = parseVendorFilter(q.getAll(VENDOR_FILTER_PARAM));
  if (vendors.length > 0) view.vendors = vendors;
  if (isAgingFilter(aging)) view.aging = aging;
  if (isKindFilter(kind)) view.kind = kind;
  if (isRangeKey(range)) view.range = range;
  else if (custom) view.range = custom;
  if ((BILL_SORT_KEYS as readonly string[]).includes(sort)) {
    view.sort = sort as BillSortKey;
  }
  if (dir === "asc" || dir === "desc") view.dir = dir;
  return view;
}

export function billFiltersToQuery(filters: BillFilters): string {
  const params = new URLSearchParams();
  const d = DEFAULT_BILL_FILTERS;
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== d.status) params.set("status", filters.status);
  appendVendorFilter(params, filters.vendors);
  if (filters.aging !== d.aging) params.set("aging", filters.aging);
  if (filters.kind !== d.kind) params.set("kind", filters.kind);
  if (filters.range !== d.range) appendRange(params, filters.range);
  if (filters.sort !== d.sort) params.set("sort", filters.sort);
  if (filters.dir !== d.dir) params.set("dir", filters.dir);
  return params.toString();
}

export function billListHref(filters: BillFilters): string {
  const query = billFiltersToQuery(filters);
  return query ? `/bills?${query}` : "/bills";
}

export function billDetailHref(id: string, filters: BillFilters): string {
  return withFrom(`/bills/${id}`, {
    href: billListHref(filters),
    label: "Bills",
  });
}
