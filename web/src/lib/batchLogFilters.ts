// How far back the batch-log list reaches. URL state, because it bounds the
// SERVER's query — a client store cannot reach a server component, so a range
// kept in localStorage would filter the rows after they had all been fetched,
// which is the one thing this exists to prevent.

import { daysBefore } from "./today";
import {
  matchingPreset,
  parseRangeParams,
  type DateRange,
  type RangePreset,
} from "./dateRange";

/**
 * THE WINDOW EXISTS BECAUSE THE LIST STOPPED BEING SMALL.
 *
 * 046 loads 609 kitchen-days of FileMaker history, so a screen that had one row
 * has six hundred and grows by one a day forever. A log is worked within a few
 * days of being generated, so the recent past is the working set and everything
 * older is an archive dig.
 *
 * DELIBERATELY NOT `lib/poFilters`' RANGES, though the shape is the same. That
 * list opens with Today and 7 days because a purchase order is generated and
 * sent on one morning and you want that morning back. A batch log is worked over
 * a couple of days and read for weeks afterwards — "how much did we make last
 * month" is a normal question of this table and never of that one — so the
 * useful windows start where the PO list's end. Sharing one list would mean one
 * of the two screens carrying four chips nobody presses.
 */
export const BATCH_LOG_RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

export type BatchLogRange = (typeof BATCH_LOG_RANGES)[number]["key"];

/**
 * 90 days: a full quarter, which covers "what did we make last month" without
 * reaching into 2019 every time somebody opens the screen. All time is
 * available and is the slow path, the same bargain the PO list strikes.
 */
export const DEFAULT_BATCH_LOG_RANGE: BatchLogRange = "90";

function isBatchLogRange(value: string): value is BatchLogRange {
  return BATCH_LOG_RANGES.some((r) => r.key === value);
}

/**
 * The `ui/RangePicker`'s presets on this screen (Mark, 2026-09-08, replacing
 * the Show tabs): the same four, every one THROUGH today, All time null.
 */
export const BATCH_LOG_PRESETS: RangePreset[] = BATCH_LOG_RANGES.map((r) => ({
  key: r.key,
  label: r.label,
  range: (today: string) =>
    r.days === null ? null : { from: daysBefore(today, r.days), to: today },
}));

/** A preset by key, or a pair somebody tapped on the calendar. */
export type BatchLogWindow = BatchLogRange | DateRange;

export function parseBatchLogWindow(
  params: Record<string, string | string[] | undefined>
): BatchLogWindow {
  const raw = params.range;
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  // A key wins over a pair; half a pair is nothing; anything unrecognised
  // falls back rather than erroring — a stale bookmark should show the list.
  if (isBatchLogRange(value)) return value;
  return parseRangeParams(params.from, params.to) ?? DEFAULT_BATCH_LOG_RANGE;
}

/**
 * Kept for callers that only ever handle a key — everything else reads
 * `parseBatchLogWindow`.
 */
export function parseBatchLogRange(raw: string | string[] | undefined): BatchLogRange {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return isBatchLogRange(value) ? value : DEFAULT_BATCH_LOG_RANGE;
}

/**
 * What the picker handed back, as a window: a pair that IS a preset on
 * `today` is stored by KEY so "90 days" stays 90 days tomorrow; a clear is
 * All time.
 */
export function batchLogWindowFromPicker(picked: DateRange | null, today: string): BatchLogWindow {
  const preset = matchingPreset(picked, BATCH_LOG_PRESETS, today);
  if (preset) return preset.key as BatchLogRange;
  return picked ?? "all";
}

/**
 * The dates a window resolves to on `today`, or null for all time. The
 * picker's face and the query both read this, so they cannot disagree.
 *
 * `today` is THE ORG'S CALENDAR DAY, passed in — a UTC server is already
 * tomorrow by late afternoon in California, so a window computed from the
 * host would drop today's log while somebody was still working it (`lib/today`).
 */
export function batchLogWindowBounds(window: BatchLogWindow, today: string): DateRange | null {
  if (typeof window !== "string") return window;
  return BATCH_LOG_PRESETS.find((p) => p.key === window)?.range(today) ?? null;
}

/** The list's own href for a range, keeping whatever else is in the URL. */
export function batchLogRangeHref(
  range: BatchLogWindow,
  current: URLSearchParams | Record<string, string | string[] | undefined>
): string {
  const params = new URLSearchParams();
  // `from`/`to` are this window's own keys as well as `range` — a custom pair
  // must not survive beside a preset, or the parser takes the key and the
  // stale pair rides every link for nothing. NB the breadcrumb's `from` is a
  // PATH (`/plans`), which `parseRangeParams` refuses, so the two never collide
  // on read; on write they are told apart by the dropped-with-range rule too,
  // which is why a breadcrumb `from` is re-added from `current` only when it
  // is not a date.
  const isWindowKey = (k: string, v: string) =>
    k === "range" || ((k === "from" || k === "to") && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (current instanceof URLSearchParams) {
    for (const [k, v] of current) if (!isWindowKey(k, v)) params.set(k, v);
  } else {
    for (const [k, v] of Object.entries(current)) {
      if (v === undefined) continue;
      const one = Array.isArray(v) ? v[0] : v;
      if (!isWindowKey(k, one)) params.set(k, one);
    }
  }
  // The DEFAULT writes no parameter, so the list keeps one canonical address
  // and every link already stored still points at it (the recipe tabs' rule).
  if (typeof range !== "string") {
    params.set("from", range.from);
    params.set("to", range.to);
  } else if (range !== DEFAULT_BATCH_LOG_RANGE) params.set("range", range);
  const query = params.toString();
  return query ? `/batch-logs?${query}` : "/batch-logs";
}
