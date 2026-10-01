/**
 * THE CUSTOMER INVOICE LIST'S DATE WINDOW (Mark, 2026-10-01: "add a
 * rangepicker to the customer invoices filter row with some sensible
 * options"), over the ISSUED date — the invoice's own date, the one a
 * statement and the books go by.
 *
 * `lib/specialOrderRange`'s shape, smaller: one token in the filters (a preset
 * KEY, or `from..to` for a picked pair), so "Last Month" stays last month
 * tomorrow. Unlike that list this one fetches every invoice, so the window is
 * a CLIENT filter and there is no server to keep in step with.
 *
 * THE PRESETS LOOK BACK, because an invoice list is read after the fact — what
 * did we bill this week, last month, this year. ALL TIME IS THE RESTING VIEW,
 * which is what the list showed before it had a window: an overdue invoice
 * from March must not vanish because someone opened the list in October.
 */

import {
  RANGE_PRESETS,
  inRange,
  matchingPreset,
  parseRangeToken,
  rangeToken,
  type DateRange,
  type RangePreset,
} from "./dateRange";

export const INVOICE_RANGE_PRESETS: RangePreset[] = [
  RANGE_PRESETS.this_week,
  RANGE_PRESETS.previous_week,
  RANGE_PRESETS.this_month,
  RANGE_PRESETS.last_month,
  RANGE_PRESETS.last_90_days,
  RANGE_PRESETS.this_year,
  RANGE_PRESETS.last_year,
  { key: "all", label: "All Time", range: () => null },
];

export const DEFAULT_INVOICE_RANGE = "all";

/** Is this a token this list understands? The filter dimension's `accepts`. */
export function isInvoiceRangeToken(value: string): boolean {
  return INVOICE_RANGE_PRESETS.some((p) => p.key === value) || parseRangeToken(value) !== null;
}

/** The dates a token means on `today`, or null for all time — which is also
 *  what an unreadable token means, the resting view. */
export function invoiceRangeBounds(token: string | null | undefined, today: string): DateRange | null {
  const raw = (token ?? "").trim();
  const custom = parseRangeToken(raw);
  if (custom) return custom;
  const preset = INVOICE_RANGE_PRESETS.find((p) => p.key === raw);
  return preset ? preset.range(today) : null;
}

/** What the picker handed back, as a token: by key where it is a preset on
 *  `today`, as itself where it is not, and a clear is all time. */
export function invoiceRangeToken(picked: DateRange | null, today: string): string {
  const preset = matchingPreset(picked, INVOICE_RANGE_PRESETS, today);
  if (preset) return preset.key;
  return picked ? rangeToken(picked) : DEFAULT_INVOICE_RANGE;
}

export function inInvoiceRange(issuedOn: string, bounds: DateRange | null): boolean {
  return bounds === null || inRange(issuedOn, bounds);
}
