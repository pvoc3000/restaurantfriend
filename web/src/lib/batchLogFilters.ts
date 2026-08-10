// How far back the batch-log list reaches. URL state, because it bounds the
// SERVER's query — a client store cannot reach a server component, so a range
// kept in localStorage would filter the rows after they had all been fetched,
// which is the one thing this exists to prevent.

import { daysBefore, todayInTimeZone } from "./today";

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

export function parseBatchLogRange(raw: string | string[] | undefined): BatchLogRange {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const found = BATCH_LOG_RANGES.find((r) => r.key === value);
  // Anything unrecognised falls back rather than erroring: a stale bookmark
  // should show you the list, not a failure.
  return found ? found.key : DEFAULT_BATCH_LOG_RANGE;
}

/**
 * The earliest `log_date` to fetch, or null for all time.
 *
 * THE ORG'S CALENDAR DAY, not the host's. A UTC server is already tomorrow by
 * late afternoon in California, so a window computed from the host would start
 * dropping today's log while somebody was still working it — the same trap
 * `lib/today` exists for and the PO list documents.
 */
export function batchLogRangeStart(range: BatchLogRange, timeZone: string): string | null {
  const days = BATCH_LOG_RANGES.find((r) => r.key === range)?.days ?? null;
  if (days === null) return null;
  return daysBefore(todayInTimeZone(timeZone), days);
}

/** The list's own href for a range, keeping whatever else is in the URL. */
export function batchLogRangeHref(
  range: BatchLogRange,
  current: URLSearchParams | Record<string, string | string[] | undefined>
): string {
  const params = new URLSearchParams();
  if (current instanceof URLSearchParams) {
    for (const [k, v] of current) if (k !== "range") params.set(k, v);
  } else {
    for (const [k, v] of Object.entries(current)) {
      if (k === "range" || v === undefined) continue;
      params.set(k, Array.isArray(v) ? v[0] : v);
    }
  }
  // The DEFAULT writes no parameter, so the list keeps one canonical address
  // and every link already stored still points at it (the recipe tabs' rule).
  if (range !== DEFAULT_BATCH_LOG_RANGE) params.set("range", range);
  const query = params.toString();
  return query ? `/batch-logs?${query}` : "/batch-logs";
}
