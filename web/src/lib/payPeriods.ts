/**
 * Pay periods — the status ladder, and the calendar arithmetic.
 *
 * Migration 027's table. Everything here is PURE: plain data in, plain data
 * out, no Supabase client and no React, so `npm run fixtures` can pin the
 * arithmetic that decides which fortnight owns a shift.
 *
 * All dates are ISO date STRINGS (`2026-08-03`) and all arithmetic happens in
 * UTC. That is not laziness about time zones — it is the correct choice for a
 * date-only value. UTC has no DST, so "add 14 days" is always 14 × 86,400,000
 * ms and can never land on 23 or 25 hours and roll a day. A shift's INSTANTS
 * are a different problem entirely and live in `lib/timeZone.ts`.
 */

/* -------------------------------------------------------------------------- */
/* The ladder                                                                  */
/* -------------------------------------------------------------------------- */

export type PayPeriodStatus = "open" | "review" | "exported" | "closed";

export const PAY_PERIOD_STATUS: PayPeriodStatus[] = ["open", "review", "exported", "closed"];

export const PAY_PERIOD_STATUS_LABEL: Record<PayPeriodStatus, string> = {
  open: "Open",
  review: "In review",
  exported: "Exported",
  closed: "Closed",
};

/**
 * What each status means, in the words the confirm dialogs use. The two end
 * states are the ones worth being precise about, because the difference between
 * them is the difference between "reversible" and "not".
 */
export const PAY_PERIOD_STATUS_HINT: Record<PayPeriodStatus, string> = {
  open: "Punches are still arriving. Timesheets can be edited.",
  review: "The fortnight has ended and is being adjudicated. Timesheets can still be edited.",
  exported: "The payroll file has been produced. Reopening discards it.",
  closed: "Payroll ran. This period is final.",
};

/**
 * The chip, in the same class vocabulary `PO_STATUS_CLASS` established — one
 * dress for a status chip across the app rather than a second one invented
 * here. Colour only ever means record STATE, and these are states; nothing is
 * red, because none of these is a problem.
 *
 * `review` is yellow, the app's "worth your eye": it is the only status that
 * is waiting on a person. `closed` is the inert one and recedes.
 */
export const PAY_PERIOD_STATUS_CLASS: Record<PayPeriodStatus, string> = {
  open: "border border-ink bg-white text-ink",
  review: "border border-ink bg-[var(--rf-yellow-200)] text-ink",
  exported: "border border-ink bg-[var(--rf-green-200)] text-ink",
  closed: "border border-neutral-300 bg-neutral-100 text-muted",
};

/**
 * THE rule the module turns on (decision 8): a timesheet is editable iff its
 * pay period is editable. No `locked` column, no archive table, no "is
 * historical" flag — one rule, the way `closed` came to mean something on
 * purchase orders.
 *
 * Note this covers `review` as well as `open`, and that reading is deliberate.
 * Review is the step where a human adjudicates break violations and overtime
 * disagreements — correcting things is what the status is FOR, and a review
 * that couldn't write would force you to step backwards to `open` to fix
 * anything you found. What must not be editable is a period whose FILE already
 * exists, which is `exported` and `closed`.
 *
 * Migration 028's insert/update/delete policies enforce exactly this same pair,
 * so the screen and the database agree. They must be changed together.
 */
export function isPayPeriodEditable(status: PayPeriodStatus): boolean {
  return status === "open" || status === "review";
}

/** The allowed forward moves, plus the one backward move that isn't a reopen. */
export function nextStatuses(status: PayPeriodStatus): PayPeriodStatus[] {
  switch (status) {
    case "open":
      return ["review"];
    // Back to `open` is not a reopen — nothing has been produced yet, so there
    // is nothing to discard and no reason to demand.
    case "review":
      return ["open", "exported"];
    case "exported":
      return ["closed"];
    case "closed":
      return [];
  }
}

/**
 * Reopening (decision 11) is only ever from `exported`, and it always costs a
 * reason: the file that period produced is being discarded, and a year later
 * the only question anyone asks is why.
 *
 * `closed` is never reopened. A correction to a fortnight Gusto has already
 * paid becomes an adjustment row in the current open period — 028's `kind`
 * column — which exports as its own line. That is what makes the two end states
 * mean different things: exported = the file exists, closed = payroll ran.
 */
export function canReopen(status: PayPeriodStatus): boolean {
  return status === "exported";
}

/** A reason that is only whitespace is not a reason. Mirrors 027's check. */
export function isValidReopenReason(reason: string): boolean {
  return reason.trim().length > 0;
}

/* -------------------------------------------------------------------------- */
/* Date arithmetic                                                             */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** ISO date string → epoch ms at UTC midnight. Throws on a malformed value. */
export function parseISODate(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  const [, y, mo, d] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // A round trip, never the regex alone: `new Date("2026-02-31")` does not
  // fail, it rolls over to March 2nd. The same check `invoiceDeliveryDate`
  // makes before a reading goes near a `date` column.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Not a real date: ${iso}`);
  }
  return ms;
}

/** epoch ms → ISO date string. */
export function formatISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return formatISODate(parseISODate(iso) + days * DAY_MS);
}

/** Inclusive day count: 2026-07-20 → 2026-08-02 is 14, not 13. */
export function daysBetween(startISO: string, endISO: string): number {
  return (parseISODate(endISO) - parseISODate(startISO)) / DAY_MS + 1;
}

/** ISO weekday, 1 = Monday … 7 = Sunday — the convention used schema-wide. */
export function isoWeekday(iso: string): number {
  const d = new Date(parseISODate(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The most recent `weekday` on or before `iso`. */
export function startOfWeekOnOrBefore(iso: string, weekday: number): string {
  const back = (isoWeekday(iso) - weekday + 7) % 7;
  return addDays(iso, -back);
}

/* -------------------------------------------------------------------------- */
/* The calendar                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `orgs.settings.payroll`, written by migration 027. Zero business hardcoding
 * (design rule 2): the fortnight is Donut Friend's, not the platform's, and an
 * org paying weekly from a Sunday changes this object and nothing else.
 *
 * `workweek_starts_on` is a SEPARATE question from the pay period and must not
 * be derived from it — California weekly overtime and the seventh-day rule are
 * per workweek, which is not a pay period. FMP knew, and carried `cWeekNum`
 * beside a separate over-forty bucket on every row.
 */
export type PayrollSettings = {
  period_days: number;
  period_starts_on: number;
  workweek_starts_on: number;
};

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  period_days: 14,
  period_starts_on: 1,
  workweek_starts_on: 1,
};

export function payrollSettings(raw: unknown): PayrollSettings {
  const s = (raw ?? {}) as Partial<PayrollSettings>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  const weekday = (v: unknown, fallback: number) => {
    const n = num(v, fallback);
    return n >= 1 && n <= 7 ? n : fallback;
  };
  return {
    period_days: num(s.period_days, DEFAULT_PAYROLL_SETTINGS.period_days),
    period_starts_on: weekday(s.period_starts_on, DEFAULT_PAYROLL_SETTINGS.period_starts_on),
    workweek_starts_on: weekday(s.workweek_starts_on, DEFAULT_PAYROLL_SETTINGS.workweek_starts_on),
  };
}

export type PeriodRange = { start_date: string; end_date: string };

/**
 * The next fortnight after `lastEndISO` — the day after it ends, running for
 * `period_days`.
 *
 * This is the ONLY implementation of "when does the next period start", which
 * is why `load-payperiods.mjs` deliberately doesn't open one: a second copy of
 * this arithmetic in a migration script is migration 016's `nextDeliveryDate`
 * trap, where the same rule lives in a SQL function and a TS module and drifts
 * the moment either is touched.
 */
export function nextPeriodAfter(lastEndISO: string, settings: PayrollSettings): PeriodRange {
  const start = addDays(lastEndISO, 1);
  return { start_date: start, end_date: addDays(start, settings.period_days - 1) };
}

/**
 * The period containing `dateISO` when no calendar exists yet — snap back to
 * the most recent `period_starts_on`. Used only to seed the very first period;
 * once one exists, `nextPeriodAfter` continues the cadence, which is what keeps
 * the sequence unbroken even if someone's idea of the anchor day changes.
 */
export function periodContaining(dateISO: string, settings: PayrollSettings): PeriodRange {
  const start = startOfWeekOnOrBefore(dateISO, settings.period_starts_on);
  return { start_date: start, end_date: addDays(start, settings.period_days - 1) };
}

/**
 * Does this proposed range collide with an existing one?
 *
 * 027's `pay_periods_no_overlap` refuses an overlap outright, so this exists to
 * say so BEFORE the insert rather than handing someone a raw Postgres
 * exclusion-constraint error. Inclusive at both ends, matching the `'[]'`
 * bounds the constraint uses — with the default `'[)'` a period starting on the
 * previous one's end date would look fine here and be rejected there, which is
 * the off-by-one the constraint is written to catch.
 */
export function overlapsAny(range: PeriodRange, existing: readonly PeriodRange[]): boolean {
  const s = parseISODate(range.start_date);
  const e = parseISODate(range.end_date);
  return existing.some(
    (p) => s <= parseISODate(p.end_date) && e >= parseISODate(p.start_date)
  );
}

/** Which period owns this date? At most one, because 027 forbids overlap. */
export function periodForDate<T extends PeriodRange>(
  dateISO: string,
  periods: readonly T[]
): T | null {
  const d = parseISODate(dateISO);
  return (
    periods.find((p) => d >= parseISODate(p.start_date) && d <= parseISODate(p.end_date)) ?? null
  );
}

/**
 * The workweek a date falls in — the Monday (or whichever anchor) on or before
 * it. Filled onto every timesheet by 028's trigger, and NOT derivable from the
 * pay period: a fortnight holds two workweeks, and the seventh-day rule needs
 * to know which.
 */
export function workweekStart(dateISO: string, settings: PayrollSettings): string {
  return startOfWeekOnOrBefore(dateISO, settings.workweek_starts_on);
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * "Jul 20 – Aug 2, 2026", collapsing the year when both ends share one and the
 * month when both ends share that too. Built from UTC parts rather than
 * `toLocaleDateString` on a bare `Date`, which would apply the VIEWER's zone to
 * a date-only value and can show the day before.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPeriodRange(range: PeriodRange): string {
  const s = new Date(parseISODate(range.start_date));
  const e = new Date(parseISODate(range.end_date));
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  const left = `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}`;
  const right = sameMonth ? `${e.getUTCDate()}` : `${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`;
  const leftYear = sameYear ? "" : `, ${s.getUTCFullYear()}`;
  return `${left}${leftYear} – ${right}, ${e.getUTCFullYear()}`;
}
