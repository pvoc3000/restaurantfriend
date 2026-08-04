// URL-persisted filter + sort state for the invoice list — the same design as
// lib/poFilters.ts, including the session-cookie exception, because the nav
// link is a bare `/invoices` with no query to carry.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";
import { RANGES, rangeStart, type RangeKey } from "./poFilters";
import { AGING_ORDER, INVOICE_STATUS_ORDER, type AgingBucket, type InvoiceStatus } from "./invoices";

/**
 * The status chips: the three real statuses plus `all`.
 *
 * There is no `open` ROLL-UP here, unlike the PO list — `open` is already one
 * of the three, and a roll-up over "not void" would be a fourth chip that
 * almost always equals `all`.
 */
export type InvoiceStatusFilter = InvoiceStatus | "all";

function isStatusFilter(value: string): value is InvoiceStatusFilter {
  return value === "all" || (INVOICE_STATUS_ORDER as string[]).includes(value);
}

/** The aging tiers, plus `all`. */
export type AgingFilter = AgingBucket | "all";

function isAgingFilter(value: string): value is AgingFilter {
  return value === "all" || (AGING_ORDER as string[]).includes(value);
}

export const INVOICE_SORT_KEYS = [
  "invoice_number",
  "invoice_date",
  "due_date",
  "vendor",
  "status",
  "po",
  "total",
  "lines",
] as const;
export type InvoiceSortKey = (typeof INVOICE_SORT_KEYS)[number];

export type InvoiceFilters = {
  q: string;
  status: InvoiceStatusFilter;
  aging: AgingFilter;
  range: RangeKey;
  sort: InvoiceSortKey;
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
export const DEFAULT_INVOICE_FILTERS: InvoiceFilters = {
  q: "",
  status: "open",
  aging: "all",
  range: "90",
  sort: "due_date",
  dir: "asc",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** URL first, then how you left the list last time, then the defaults. */
export function parseInvoiceFilters(
  params: RawSearchParams,
  remembered: Partial<InvoiceFilters> = {}
): InvoiceFilters {
  const status = one(params.status);
  const aging = one(params.aging);
  const range = one(params.range);
  const sort = one(params.sort);
  const dir = one(params.dir);
  const fallback = { ...DEFAULT_INVOICE_FILTERS, ...remembered };
  return {
    // Not remembered, matching the PO list: coming back to a list silently
    // narrowed by a term you've forgotten typing is its own trap.
    q: one(params.q),
    status: isStatusFilter(status) ? status : fallback.status,
    aging: isAgingFilter(aging) ? aging : fallback.aging,
    range: RANGES.some((r) => r.key === range) ? (range as RangeKey) : fallback.range,
    sort: (INVOICE_SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as InvoiceSortKey)
      : fallback.sort,
    dir: dir === "asc" || dir === "desc" ? dir : fallback.dir,
  };
}

/** Session cookie, deleted by signOut — see PO_VIEW_COOKIE for the argument. */
export const INVOICE_VIEW_COOKIE = "rf.invoice.view";

export function serializeInvoiceView(filters: InvoiceFilters): string {
  return new URLSearchParams({
    status: filters.status,
    aging: filters.aging,
    range: filters.range,
    sort: filters.sort,
    dir: filters.dir,
  }).toString();
}

export function parseInvoiceView(
  raw: string | undefined | null
): Partial<InvoiceFilters> {
  if (!raw) return {};
  const q = new URLSearchParams(raw);
  const status = q.get("status") ?? "";
  const aging = q.get("aging") ?? "";
  const range = q.get("range") ?? "";
  const sort = q.get("sort") ?? "";
  const dir = q.get("dir");

  const view: Partial<InvoiceFilters> = {};
  if (isStatusFilter(status)) view.status = status;
  if (isAgingFilter(aging)) view.aging = aging;
  if (RANGES.some((r) => r.key === range)) view.range = range as RangeKey;
  if ((INVOICE_SORT_KEYS as readonly string[]).includes(sort)) {
    view.sort = sort as InvoiceSortKey;
  }
  if (dir === "asc" || dir === "desc") view.dir = dir;
  return view;
}

export function invoiceFiltersToQuery(filters: InvoiceFilters): string {
  const params = new URLSearchParams();
  const d = DEFAULT_INVOICE_FILTERS;
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status !== d.status) params.set("status", filters.status);
  if (filters.aging !== d.aging) params.set("aging", filters.aging);
  if (filters.range !== d.range) params.set("range", filters.range);
  if (filters.sort !== d.sort) params.set("sort", filters.sort);
  if (filters.dir !== d.dir) params.set("dir", filters.dir);
  return params.toString();
}

export function invoiceListHref(filters: InvoiceFilters): string {
  const query = invoiceFiltersToQuery(filters);
  return query ? `/invoices?${query}` : "/invoices";
}

export function invoiceDetailHref(id: string, filters: InvoiceFilters): string {
  return withFrom(`/invoices/${id}`, {
    href: invoiceListHref(filters),
    label: "Invoices",
  });
}

/**
 * The earliest invoice_date the window includes. Same function the PO list
 * uses, re-exported so the two lists cannot drift apart on what "90 days"
 * means — and it takes the ORG's timezone for the reason written there.
 */
export { rangeStart, RANGES };
export type { RangeKey };
