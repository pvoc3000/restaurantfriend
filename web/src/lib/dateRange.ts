// A RANGE of calendar dates, and the presets a `ui/RangePicker` offers.
//
// Pure, so it runs in the fixture harness. Every date is an ISO `YYYY-MM-DD`
// string — what a Postgres `date` column and `lib/today` both speak — and all
// the arithmetic is UTC midnight over that string, the same discipline as
// `daysBefore`: a `new Date("2026-09-01")` is UTC midnight, so any local-time
// arithmetic on it moves the day for everyone west of Greenwich.
//
// Weeks start on MONDAY. ISO 1 = Monday is the whole schema's convention
// (`order_days`, `par_by_weekday`, the plan matrix), and a calendar that put
// Sunday first beside a plan grid that puts it last would be two pictures of
// one week.

import { daysAfter, daysBefore } from "./today";

/** Inclusive on both ends. `from <= to` always — see `normalizeRange`. */
export type DateRange = { from: string; to: string };

/**
 * One button on the picker's right-hand side. A preset is a FUNCTION of
 * today, never a stored pair of dates: "Last week" means something different
 * tomorrow, and the org's day is passed in by the caller (`lib/today`'s rule).
 */
export type RangePreset = {
  key: string;
  label: string;
  /** Null means NO range — "All time" — which the picker applies as a clear. */
  range: (today: string) => DateRange | null;
};

/* -- calendar arithmetic ------------------------------------------------- */

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function isoWeekdayOf(iso: string): number {
  const js = utc(iso).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/** The Monday on or before `iso`. */
export function weekStart(iso: string): string {
  return daysBefore(iso, isoWeekdayOf(iso) - 1);
}

/** The first of `iso`'s month. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The last day of `iso`'s month. */
export function monthEnd(iso: string): string {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toIso(d);
}

/**
 * The first of the month `months` away from `iso`'s month. Always the FIRST —
 * "the 31st plus one month" is a question with no good answer, and nothing
 * here needs to ask it.
 */
export function addMonths(iso: string, months: number): string {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d);
}

/** A range from two taps in either order. */
export function normalizeRange(a: string, b: string): DateRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** Is `iso` inside the range, inclusive? */
export function inRange(iso: string, range: DateRange): boolean {
  return iso >= range.from && iso <= range.to;
}

/* -- the month grid ------------------------------------------------------ */

export type GridDay = { iso: string; inMonth: boolean };

/**
 * Six weeks of seven days, Monday first, covering `monthIso`'s month.
 *
 * ALWAYS six rows, so the panel is the same height whichever month is showing
 * — a calendar that grows a row when you press › moves the preset buttons
 * beside it, and a control that jumps under the pointer is one people learn
 * to press slowly.
 */
export function monthGrid(monthIso: string): GridDay[][] {
  const first = monthStart(monthIso);
  const month = first.slice(0, 7);
  let cursor = weekStart(first);
  const weeks: GridDay[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week: GridDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({ iso: cursor, inMonth: cursor.slice(0, 7) === month });
      cursor = daysAfter(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "September 2026" for the grid's heading. */
export function monthLabel(iso: string): string {
  return `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/* -- presets ------------------------------------------------------------- */

/**
 * The built-in vocabulary. A caller names the ones its screen wants, in the
 * order it wants them; nothing shows every one of these.
 *
 * Two readings that are easy to get backwards:
 *
 * "LAST WEEK" IS THE SEVEN DAYS UP TO YESTERDAY, not the previous Mon–Sun
 * (Mark, 2026-09-08: "the start date is 7 days ago and the end date is
 * yesterday"). The calendar week is `previous_week`. Both exist because they
 * answer different questions — "what came in recently" against "the week we
 * just closed".
 *
 * "LAST MONTH" IS THE CALENDAR MONTH. A bill is due "by the end of the month"
 * and a statement covers one, so the month is the unit; a rolling thirty days
 * is `last_30_days`.
 */
export const RANGE_PRESETS = {
  today: {
    key: "today",
    label: "Today",
    range: (t: string) => ({ from: t, to: t }),
  },
  yesterday: {
    key: "yesterday",
    label: "Yesterday",
    range: (t: string) => ({ from: daysBefore(t, 1), to: daysBefore(t, 1) }),
  },
  tomorrow: {
    key: "tomorrow",
    label: "Tomorrow",
    range: (t: string) => ({ from: daysAfter(t, 1), to: daysAfter(t, 1) }),
  },
  last_week: {
    key: "last_week",
    label: "Last week",
    range: (t: string) => ({ from: daysBefore(t, 7), to: daysBefore(t, 1) }),
  },
  next_week: {
    key: "next_week",
    label: "Next week",
    range: (t: string) => ({ from: daysAfter(t, 1), to: daysAfter(t, 7) }),
  },
  this_week: {
    key: "this_week",
    label: "This week",
    range: (t: string) => {
      const from = weekStart(t);
      return { from, to: daysAfter(from, 6) };
    },
  },
  previous_week: {
    key: "previous_week",
    label: "Previous week",
    range: (t: string) => {
      const from = daysBefore(weekStart(t), 7);
      return { from, to: daysAfter(from, 6) };
    },
  },
  last_30_days: {
    key: "last_30_days",
    label: "Last 30 days",
    range: (t: string) => ({ from: daysBefore(t, 30), to: daysBefore(t, 1) }),
  },
  last_90_days: {
    key: "last_90_days",
    label: "Last 90 days",
    range: (t: string) => ({ from: daysBefore(t, 90), to: daysBefore(t, 1) }),
  },
  this_month: {
    key: "this_month",
    label: "This month",
    range: (t: string) => ({ from: monthStart(t), to: monthEnd(t) }),
  },
  last_month: {
    key: "last_month",
    label: "Last month",
    range: (t: string) => {
      const from = addMonths(t, -1);
      return { from, to: monthEnd(from) };
    },
  },
  next_month: {
    key: "next_month",
    label: "Next month",
    range: (t: string) => {
      const from = addMonths(t, 1);
      return { from, to: monthEnd(from) };
    },
  },
  this_year: {
    key: "this_year",
    label: "This year",
    range: (t: string) => ({ from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` }),
  },
  last_year: {
    key: "last_year",
    label: "Last year",
    range: (t: string) => {
      const y = Number(t.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
  year_to_date: {
    key: "year_to_date",
    label: "Year to date",
    range: (t: string) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }),
  },
} as const satisfies Record<string, RangePreset>;

export type RangePresetKey = keyof typeof RANGE_PRESETS;

/**
 * What a caller passes: a built-in by name, or its own `RangePreset` for a
 * range this vocabulary has no word for ("This pay period", say).
 */
export type RangePresetSpec = RangePresetKey | RangePreset;

export function resolvePreset(spec: RangePresetSpec): RangePreset {
  return typeof spec === "string" ? RANGE_PRESETS[spec] : spec;
}

/**
 * The preset whose range this IS, given today — so a picker can show "Last
 * week" on its face rather than two dates, and mark the matching button.
 * The FIRST match wins where two presets coincide (Today and Yesterday never
 * do; This week and Last week can on a Monday).
 */
export function matchingPreset(
  range: DateRange | null,
  presets: readonly RangePresetSpec[],
  today: string
): RangePreset | null {
  for (const spec of presets) {
    const p = resolvePreset(spec);
    const r = p.range(today);
    if (r === null ? range === null : range !== null && r.from === range.from && r.to === range.to) {
      return p;
    }
  }
  return null;
}

/* -- display -------------------------------------------------------------- */

/**
 * A TWO-DIGIT YEAR, which is a width decision (Mark, 2026-09-10: "make the
 * range picker display dates with only two decimals for the year so it doesn't
 * need to be so wide"). A picked range is the widest thing this control ever
 * says, so its face sets the field's width, and two dates at four digits each
 * spend 30-odd pixels on the century twice over.
 *
 * Safe here in a way it is not on a document: this is a FILTER's face, read
 * beside a list whose own date column carries the full year, and never a date
 * anybody transcribes. `lib/specialOrderDocs`' own `usDate` — the one a quote
 * and an invoice print — keeps four digits and no leading zeros, and the two
 * must not be merged.
 */
function usDate(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`;
}

/** "09/01/26 – 09/08/26", or one date when the range is a single day. */
export function formatRange(range: DateRange): string {
  return range.from === range.to
    ? usDate(range.from)
    : `${usDate(range.from)} – ${usDate(range.to)}`;
}

/* -- URL ----------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  // A ROUND TRIP, not a regex — `new Date("2026-02-31")` does not fail, it
  // rolls over to March 2nd (`invoiceDeliveryDate`'s lesson).
  return ISO_DATE.test(iso) && toIso(utc(iso)) === iso;
}

/**
 * Read a range off two query params (`?from=…&to=…`). Anything that is not
 * two real dates in order is NO range, never a partial one — a filter that
 * honoured half a pair would show a window nobody chose.
 */
export function parseRangeParams(
  from: string | string[] | undefined,
  to: string | string[] | undefined
): DateRange | null {
  const f = Array.isArray(from) ? from[0] : from;
  const t = Array.isArray(to) ? to[0] : to;
  if (!f || !t || !isRealDate(f) || !isRealDate(t) || f > t) return null;
  return { from: f, to: t };
}
