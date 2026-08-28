/**
 * DAILY NET SALES AND TIPS — the arithmetic behind /sales.
 *
 * Pure, so it is fixture-tested and compiled into the Node fixture run. Imports
 * nothing but `payPeriods` (date arithmetic) and `tipPool` (money formatting),
 * both of which are pure too — no Supabase client, or the fixture build breaks.
 *
 * Money is INTEGER CENTS throughout, for migration 029's reason: a year of days
 * has to sum to the figure printed on Square's dashboard, and floating point
 * cannot promise that.
 */

import { addDays, daysBetween, isoWeekday } from "./payPeriods";

export type SalesDay = {
  location_id: string;
  locationCode: string;
  /** Square's REPORTING day — see the column comment on daily_sales. */
  business_date: string;
  netSalesCents: number;
  tipsCents: number;
  syncedAt: string | null;
  /** `daily_sales.source` — 'square', or 'manual' once somebody corrected it.
   *  A manual row is skipped by the sync (migration 065). */
  source?: string;
};

export type DateRange = { from: string; to: string };

export type SalesTotals = {
  netSalesCents: number;
  tipsCents: number;
  /** Shop-days summed — two shops on one date is 2, which is what makes an
   *  average-per-day figure honest when one shop is closed. */
  days: number;
};

export const ZERO_TOTALS: SalesTotals = { netSalesCents: 0, tipsCents: 0, days: 0 };

export function sumSales(days: readonly SalesDay[]): SalesTotals {
  let netSalesCents = 0;
  let tipsCents = 0;
  for (const d of days) {
    netSalesCents += d.netSalesCents;
    tipsCents += d.tipsCents;
  }
  return { netSalesCents, tipsCents, days: days.length };
}

export function inRange(day: SalesDay, range: DateRange): boolean {
  return day.business_date >= range.from && day.business_date <= range.to;
}

export function daysIn(days: readonly SalesDay[], range: DateRange): SalesDay[] {
  return days.filter((d) => inRange(d, range));
}

/**
 * Tips as a FRACTION of net sales — 017's `tax_rate` convention, where 0.0975
 * is 9.75%. The screen multiplies; this never does.
 *
 * NULL when net sales is zero or negative, and that is the whole care here:
 * both 0% and Infinity are answers nobody asked for, and a day of pure refunds
 * would otherwise print a confident percentage with no meaning. The screen
 * renders "—".
 */
export function tipFraction(t: SalesTotals): number | null {
  if (t.netSalesCents <= 0) return null;
  return t.tipsCents / t.netSalesCents;
}

/**
 * The window of the same length immediately before `range`, touching it but not
 * overlapping.
 *
 * NB `daysBetween` is INCLUSIVE — 2026-07-20 → 2026-08-02 is 14, not 13 — so
 * the shift is the span itself and not the span plus one. A pay period compared
 * against fifteen days would understate every rise by a day's takings.
 */
export function previousRange(range: DateRange): DateRange {
  const span = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -span), to: addDays(range.from, -1) };
}

/**
 * A YEAR AGO — and by default that is **364 days back, not one calendar year**.
 *
 * This is a real decision, not a rounding convenience. Comparing Saturday
 * 2026-08-22 against Friday 2025-08-22 compares two different businesses: a
 * bakery's Saturday and its Friday are not the same shop, and over a pay period
 * the calendar answer silently shifts every weekend by a day. 364 is 52 whole
 * weeks, so every date lands on the same weekday it started on.
 *
 * `sameDates` is available for whoever wants the calendar answer, and the
 * screen says which one it used — a comparison that will not say what it
 * compared is worth nothing.
 */
export function lastYearRange(
  range: DateRange,
  mode: "weekAligned" | "sameDates" = "weekAligned"
): DateRange {
  if (mode === "weekAligned") {
    return { from: addDays(range.from, -364), to: addDays(range.to, -364) };
  }
  return { from: shiftYear(range.from), to: shiftYear(range.to) };
}

/** One calendar year back, clamping 29 February to the 28th. */
function shiftYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y - 1;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The part of `range` that has actually HAPPENED.
 *
 * A pay period is fourteen days long from the moment it opens, so on day seven
 * the naive sum is seven days of takings sitting in a fourteen-day box. That is
 * fine as a total and ruinous as a COMPARISON: measured on the real 2026-08-17
 * period, seven days against a complete pay period reads −58.6%, which looks
 * like the business falling over and is only the calendar.
 */
export function elapsedRange(range: DateRange, today: string): DateRange {
  return { from: range.from, to: today < range.to ? today : range.to };
}

/** Is this range still running? */
export function isPartial(range: DateRange, today: string): boolean {
  return today < range.to;
}

/**
 * The first `days` of a range — the like-for-like basis for a period still
 * running. Seven days in, we compare against the previous period's FIRST seven
 * days, not all fourteen of them.
 *
 * Clamped, so asking for more days than the range holds returns the range.
 */
export function openingSlice(range: DateRange, days: number): DateRange {
  const to = addDays(range.from, Math.max(0, days - 1));
  return { from: range.from, to: to > range.to ? range.to : to };
}

export type Comparison = {
  current: SalesTotals;
  basis: SalesTotals;
  basisRange: DateRange;
  netDeltaCents: number;
  /** Null when the basis took nothing — growth from zero has no percentage. */
  netDeltaFraction: number | null;
  tipsDeltaCents: number;
  tipsDeltaFraction: number | null;
  /** Change in tips-as-a-share-of-sales, in fraction points. */
  tipFractionDelta: number | null;
};

export function compareTotals(
  current: SalesTotals,
  basis: SalesTotals,
  basisRange: DateRange
): Comparison {
  const curTip = tipFraction(current);
  const basTip = tipFraction(basis);
  return {
    current,
    basis,
    basisRange,
    netDeltaCents: current.netSalesCents - basis.netSalesCents,
    netDeltaFraction: fractionChange(basis.netSalesCents, current.netSalesCents),
    tipsDeltaCents: current.tipsCents - basis.tipsCents,
    tipsDeltaFraction: fractionChange(basis.tipsCents, current.tipsCents),
    tipFractionDelta: curTip === null || basTip === null ? null : curTip - basTip,
  };
}

function fractionChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return (to - from) / from;
}

/**
 * Shop-days in the window that have NO row — the screen's "3 days have not been
 * pulled" line.
 *
 * It matters more than it looks: every comparison above is a sum, and a sum
 * over a window with holes in it is smaller than the truth while looking
 * exactly as authoritative. A period missing two Saturdays reads as a bad
 * pay period. So the screen states the holes beside the figures rather than
 * leaving the reader to trust them.
 *
 * `through` exists because today is always missing — the shop has not finished
 * trading — and a screen that reports today as a gap every single day teaches
 * you to ignore the line.
 */
export function missingDays(
  days: readonly SalesDay[],
  locations: readonly SalesLocation[],
  range: DateRange,
  through?: string
): { location_id: string; locationCode: string; business_date: string }[] {
  const have = new Set(days.map((d) => `${d.location_id}|${d.business_date}`));
  const last = through && through < range.to ? through : range.to;

  const out: { location_id: string; locationCode: string; business_date: string }[] = [];
  for (let date = range.from; date <= last; date = addDays(date, 1)) {
    for (const loc of locations) {
      // A DAY THE PLACE DOES NOT TRADE IS NOT A GAP. `locations.open_days` is
      // 017's ISO weekday set, already filled in — [1..7] for both shops.
      //
      // Without this the online channel alone would report ~230 gaps a year,
      // because it sells on about five days and the loop expects a row from
      // every location on every date. A banner that always reads "230 shop-days
      // have not been pulled" is precisely the failure this line exists to
      // prevent: an always-on warning is one nobody reads, and then the real
      // gap goes past unnoticed.
      //
      // An EMPTY open_days means "no fixed trading days" — an online channel, an
      // events location — and expects nothing. Null or absent means we were
      // never told, and then the old behaviour stands: expect a row every day,
      // because silence about a shop's hours must not silence a real gap.
      if (!expectsSalesOn(loc, date)) continue;
      if (!have.has(`${loc.id}|${date}`)) {
        out.push({ location_id: loc.id, locationCode: loc.code, business_date: date });
      }
    }
  }
  return out;
}

/** A location as this screen needs it: enough to know when it trades. */
export type SalesLocation = {
  id: string;
  code: string;
  /** `locations.open_days` — ISO weekdays, 1 = Monday. See `expectsSalesOn`. */
  openDays?: readonly number[] | null;
  /** `locations.is_active`. False means a shop that has CLOSED, or a channel
   *  kept for its history — either way, no new sales are expected. */
  isActive?: boolean | null;
};

/**
 * Would we expect this location to have taken money on this date?
 *
 * Three states, and the middle one is the reason this exists:
 *   * a weekday set — trades on those days only;
 *   * an EMPTY set — no fixed trading days, so never a gap;
 *   * null/absent — unknown, so assume every day, which keeps a real gap loud.
 */
export function expectsSalesOn(loc: SalesLocation, dateISO: string): boolean {
  // A CLOSED SHOP IS NOT A GAP. DF03 traded until November 2025 and its history
  // is worth keeping, but expecting a row from it every day since would report
  // ~250 phantom gaps a year — the same failure the open_days rule prevents,
  // in the time dimension rather than the weekday one.
  //
  // The honest limitation, stated rather than discovered: what we actually want
  // is "was this place trading ON THIS DATE", and a CLOSING DATE is not
  // modelled anywhere. `is_active` is the proxy, and it is a blunt one — it
  // means no gap is ever reported for a closed shop, including inside the years
  // it really was trading. That is the right trade while the alternative is a
  // permanent false alarm, but if a closed shop's history ever needs auditing,
  // this is the line that will not help.
  if (loc.isActive === false) return false;

  const open = loc.openDays;
  if (open === null || open === undefined) return true;
  if (open.length === 0) return false;
  return open.includes(isoWeekday(dateISO));
}

/** Both shops' figures folded into one row per date. */
export function rollUpByDate(days: readonly SalesDay[]): Map<string, SalesTotals> {
  return rollUp(days, (d) => d.business_date);
}

/** Every date folded into one row per shop. */
export function rollUpByLocation(days: readonly SalesDay[]): Map<string, SalesTotals> {
  return rollUp(days, (d) => d.locationCode);
}

function rollUp(
  days: readonly SalesDay[],
  key: (d: SalesDay) => string
): Map<string, SalesTotals> {
  const out = new Map<string, SalesTotals>();
  for (const d of days) {
    const k = key(d);
    const cur = out.get(k) ?? { netSalesCents: 0, tipsCents: 0, days: 0 };
    out.set(k, {
      netSalesCents: cur.netSalesCents + d.netSalesCents,
      tipsCents: cur.tipsCents + d.tipsCents,
      days: cur.days + 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which window the screen is looking at
// ---------------------------------------------------------------------------

/**
 * The named windows, in the order the picker offers them.
 *
 * `period` leads and is the default because the PAY PERIOD is the unit Mark
 * already thinks in — it is what payroll, tips and the Gusto export are all
 * scoped to, so "how did this period do" is the question the screen opens on.
 */
export const SALES_RANGES = [
  "period",
  "last-period",
  "mtd",
  "last-30",
  "ytd",
  "custom",
] as const;

export type SalesRangeKey = (typeof SALES_RANGES)[number];

export const SALES_RANGE_LABEL: Record<SalesRangeKey, string> = {
  period: "This pay period",
  "last-period": "Last pay period",
  mtd: "Month to date",
  "last-30": "Last 30 days",
  ytd: "Year to date",
  custom: "Custom",
};

/**
 * WHAT THE PREVIOUS-PERIOD COMPARISON IS CALLED (Mark, 2026-08-28).
 *
 * "vs last period" is right for the pay-period views and says nothing for the
 * three calendar ones — under Month to date it is the month before, under Last
 * 30 days the thirty before that, under Year to date the year before. A label
 * that is the same on every view distinguishes none of them.
 *
 * READ IT WITH THE DATE LINE UNDER THE GRID, which is not decoration here.
 * These name the SHAPE of the comparison, while `previousRange` computes the
 * window of the SAME LENGTH immediately before this one — so on 28 August the
 * "last month" basis is 4–31 July rather than the whole of July, and the "last
 * year to date" basis is 6 May – 31 December 2025 rather than January to August.
 * The summary prints both bases in dates directly beneath, which is the
 * standing rule: a comparison that will not say what it compared is worth
 * nothing.
 *
 * Making those two labels literally true means changing the BASIS, not the
 * word — and for Year to date that basis is the one "a year ago" already
 * reports beside it, so the two comparisons would say the same thing twice.
 * Worth a decision; it is not this one.
 */
export const SALES_PREVIOUS_LABEL: Record<SalesRangeKey, string> = {
  period: "last period",
  "last-period": "last period",
  mtd: "last month",
  "last-30": "last thirty days",
  ytd: "last year to date",
  custom: "last period",
};

export function parseSalesRange(raw: string | undefined | null): SalesRangeKey {
  // Anything unrecognised falls back to the default rather than erroring: a
  // stale bookmark should show you the screen, not a stack trace.
  return SALES_RANGES.includes(raw as SalesRangeKey) ? (raw as SalesRangeKey) : "period";
}

/**
 * Turn the picker's choice into real dates.
 *
 * `periods` is whatever `pay_periods` rows the page loaded, newest first; the
 * pay-period windows fall back to the last 14 days when the calendar cannot
 * answer — after the FileMaker load there were spells with no open period at
 * all, and a screen that renders nothing because a period is missing is worse
 * than one that shows a pay period and says which.
 */
export function resolveSalesRange(
  key: SalesRangeKey,
  today: string,
  periods: readonly { start_date: string; end_date: string }[],
  custom?: { from?: string | null; to?: string | null }
): { range: DateRange; label: string; fellBack: boolean } {
  const sorted = [...periods].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const containing = sorted.find((p) => p.start_date <= today && today <= p.end_date);

  const twoWeeks = (): DateRange => ({ from: addDays(today, -13), to: today });

  switch (key) {
    case "period": {
      if (containing) {
        return {
          range: { from: containing.start_date, to: containing.end_date },
          label: `${containing.start_date} – ${containing.end_date}`,
          fellBack: false,
        };
      }
      return { range: twoWeeks(), label: "the last 14 days", fellBack: true };
    }
    case "last-period": {
      const idx = containing ? sorted.indexOf(containing) : -1;
      const prev = idx >= 0 ? sorted[idx + 1] : sorted.find((p) => p.end_date < today);
      if (prev) {
        return {
          range: { from: prev.start_date, to: prev.end_date },
          label: `${prev.start_date} – ${prev.end_date}`,
          fellBack: false,
        };
      }
      const back = previousRange(twoWeeks());
      return { range: back, label: "the pay period before last", fellBack: true };
    }
    case "mtd":
      return {
        range: { from: `${today.slice(0, 7)}-01`, to: today },
        label: `${today.slice(0, 7)}`,
        fellBack: false,
      };
    case "last-30":
      return { range: { from: addDays(today, -29), to: today }, label: "last 30 days", fellBack: false };
    case "ytd":
      return {
        range: { from: `${today.slice(0, 4)}-01-01`, to: today },
        label: today.slice(0, 4),
        fellBack: false,
      };
    case "custom": {
      // A half-filled custom range is the normal state while somebody is still
      // typing one, so each end falls back independently rather than the whole
      // thing collapsing to a default.
      const from = isISODate(custom?.from) ? (custom!.from as string) : addDays(today, -29);
      const to = isISODate(custom?.to) ? (custom!.to as string) : today;
      const range = from <= to ? { from, to } : { from: to, to: from };
      return { range, label: `${range.from} – ${range.to}`, fellBack: false };
    }
  }
}

function isISODate(v: string | null | undefined): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // A round trip, never the regex alone: `new Date("2026-02-31")` does not
  // fail, it rolls over to March 2nd — `parseISODate`'s own lesson.
  const [y, m, d] = v.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  return (
    back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
  );
}

/**
 * The widest window the page must fetch to answer everything on screen: the
 * chosen range, the one before it, and the same range a year ago.
 *
 * One query rather than three. At two shops a year is ~730 rows, so the whole
 * comparison is cheaper to slice in TypeScript than to ask for three times.
 */
export function fetchWindow(range: DateRange): DateRange {
  const prev = previousRange(range);
  const year = lastYearRange(range);
  const from = [range.from, prev.from, year.from].sort()[0];
  const to = [range.to, prev.to, year.to].sort().slice(-1)[0];
  return { from, to };
}

/**
 * A fraction as a percentage string. One decimal, because a tip rate moves
 * within a point and "12%" hides the movement this screen exists to show.
 */
export function formatFraction(f: number | null, opts: { sign?: boolean } = {}): string {
  if (f === null || !Number.isFinite(f)) return "—";
  const pct = f * 100;
  const body = `${Math.abs(pct).toFixed(1)}%`;
  if (!opts.sign) return pct < 0 ? `-${body}` : body;
  return pct < 0 ? `-${body}` : pct > 0 ? `+${body}` : body;
}
