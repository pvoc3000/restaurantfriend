import {
  RANGE_PRESETS,
  matchingPreset,
  parseRangeToken,
  rangeToken,
  type DateRange,
  type RangePreset,
} from "./dateRange";
import { daysBefore } from "./today";

/**
 * The shift report list's date window (Mark, 2026-10-04) — `lib/invoiceRange`'s
 * shape: a preset KEY or a picked `from..to`, one token in `?range=`.
 *
 * THE ROLLING PRESETS RUN THROUGH TODAY, the purchase order list's reading and
 * not `RANGE_PRESETS.last_30_days`, which ends YESTERDAY. This list's default
 * view is Drafts, and the draft somebody came to finish is today's.
 */
export const SHIFT_REPORT_RANGE_PRESETS: RangePreset[] = [
  RANGE_PRESETS.today,
  RANGE_PRESETS.yesterday,
  { key: "7", label: "Last 7 Days", range: (t) => ({ from: daysBefore(t, 7), to: t }) },
  { key: "30", label: "Last 30 Days", range: (t) => ({ from: daysBefore(t, 30), to: t }) },
  { key: "90", label: "Last 90 Days", range: (t) => ({ from: daysBefore(t, 90), to: t }) },
  RANGE_PRESETS.this_month,
  RANGE_PRESETS.last_month,
  RANGE_PRESETS.this_year,
  { key: "all", label: "All Time", range: () => null },
];

export const DEFAULT_SHIFT_REPORT_RANGE = "30";

/** The token's dates on `today`, or null for all time. Anything unreadable is
 *  the default, never all time — a mistyped URL should not load every report. */
export function shiftReportRangeBounds(
  token: string | null | undefined,
  today: string
): DateRange | null {
  const raw = (token ?? "").trim();
  const custom = parseRangeToken(raw);
  if (custom) return custom;
  const preset =
    SHIFT_REPORT_RANGE_PRESETS.find((p) => p.key === raw) ??
    SHIFT_REPORT_RANGE_PRESETS.find((p) => p.key === DEFAULT_SHIFT_REPORT_RANGE)!;
  return preset.range(today);
}

/** What the picker handed back, as a token: a preset by KEY so "Last 30 Days"
 *  is still thirty days tomorrow; a clear is the default. */
export function shiftReportRangeToken(picked: DateRange | null, today: string): string {
  const preset = matchingPreset(picked, SHIFT_REPORT_RANGE_PRESETS, today);
  if (preset) return preset.key;
  return picked ? rangeToken(picked) : DEFAULT_SHIFT_REPORT_RANGE;
}
