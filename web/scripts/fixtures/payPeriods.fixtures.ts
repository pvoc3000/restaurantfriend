// lib/payPeriods — the status ladder and the calendar arithmetic.
//
// The cases that matter are the ones pinning a bug the code would otherwise
// have: the inclusive-bounds off-by-one that 027's exclusion constraint exists
// to catch, and the fact that a fortnight holds TWO workweeks.

import { test, eq, ok, no } from "./harness";
import {
  isPayPeriodEditable,
  nextStatuses,
  canReopen,
  isValidReopenReason,
  addDays,
  daysBetween,
  isoWeekday,
  nextPeriodAfter,
  periodContaining,
  overlapsAny,
  periodForDate,
  workweekStart,
  formatPeriodRange,
  payrollSettings,
  parseISODate,
  DEFAULT_PAYROLL_SETTINGS,
  type PayPeriodStatus,
} from "../../src/lib/payPeriods";

const DF = DEFAULT_PAYROLL_SETTINGS;

/* -- the ladder ----------------------------------------------------------- */

test("editable in open and review, never once a file exists", () => {
  ok(isPayPeriodEditable("open"), "open");
  // Review is where corrections are MADE — a review that couldn't write would
  // force you to step backwards to fix anything you found.
  ok(isPayPeriodEditable("review"), "review");
  no(isPayPeriodEditable("exported"), "exported");
  no(isPayPeriodEditable("closed"), "closed");
});

test("closed is terminal and never reopens", () => {
  eq(nextStatuses("closed"), [] as PayPeriodStatus[]);
  no(canReopen("closed"), "closed cannot reopen");
  // Only the state that produced a file can discard it.
  ok(canReopen("exported"), "exported can reopen");
  no(canReopen("open"), "open has nothing to reopen");
  no(canReopen("review"), "review has nothing to reopen");
});

test("review steps back to open without a reason; that is not a reopen", () => {
  eq(nextStatuses("review"), ["open", "exported"] as PayPeriodStatus[]);
  no(canReopen("review"), "stepping back from review is not a reopen");
});

test("a whitespace reason is not a reason", () => {
  no(isValidReopenReason("   "), "spaces");
  no(isValidReopenReason(""), "empty");
  ok(isValidReopenReason("Homebase re-sent the fortnight"), "real reason");
});

/* -- date arithmetic ------------------------------------------------------ */

test("day counts are INCLUSIVE — a fortnight is 14, not 13", () => {
  eq(daysBetween("2026-07-20", "2026-08-02"), 14);
  eq(daysBetween("2026-07-20", "2026-07-20"), 1);
});

test("ISO weekday is 1=Monday .. 7=Sunday, matching the schema", () => {
  eq(isoWeekday("2026-08-03"), 1, "Monday");
  eq(isoWeekday("2026-08-02"), 7, "Sunday");
});

test("addDays crosses a month, a year and a leap day without a library", () => {
  eq(addDays("2026-08-02", 1), "2026-08-03");
  eq(addDays("2026-12-31", 1), "2027-01-01");
  eq(addDays("2024-02-28", 1), "2024-02-29", "2024 is a leap year");
  eq(addDays("2026-02-28", 1), "2026-03-01", "2026 is not");
});

test("addDays crosses a DST boundary without drifting", () => {
  // The reason this module works in UTC. In America/Los_Angeles, 2026-03-08 is
  // 23 hours long; naive local-midnight arithmetic lands on the 14th at 23:00
  // and formats as the 14th only by luck of rounding.
  eq(addDays("2026-03-01", 14), "2026-03-15");
  eq(addDays("2026-11-01", 14), "2026-11-15");
});

test("a malformed or unreal date is refused, not rolled over", () => {
  // `new Date("2026-02-31")` does NOT throw — it silently becomes March 2nd.
  let threw = false;
  try { parseISODate("2026-02-31"); } catch { threw = true; }
  ok(threw, "2026-02-31 must be refused");
  threw = false;
  try { parseISODate("8/3/2026"); } catch { threw = true; }
  ok(threw, "a US-format date must be refused");
});

/* -- the calendar --------------------------------------------------------- */

test("the next period starts the day after the last one ends", () => {
  // The real handoff: the export ends 2026-08-02, so the app opens 08-03.
  eq(nextPeriodAfter("2026-08-02", DF), { start_date: "2026-08-03", end_date: "2026-08-16" });
  eq(isoWeekday("2026-08-03"), 1, "and it lands on a Monday");
});

test("continuing the cadence reproduces Donut Friend's real calendar", () => {
  // Walk forward from the first real period and check we land on the last one.
  let range = { start_date: "2019-10-07", end_date: "2019-10-20" };
  for (let i = 1; i < 178; i++) range = nextPeriodAfter(range.end_date, DF);
  eq(range, { start_date: "2026-07-20", end_date: "2026-08-02" });
});

test("periodContaining snaps back to the anchor weekday", () => {
  // A Thursday resolves to the Monday of its fortnight.
  eq(periodContaining("2026-08-06", DF), { start_date: "2026-08-03", end_date: "2026-08-16" });
  // The anchor day itself resolves to itself.
  eq(periodContaining("2026-08-03", DF), { start_date: "2026-08-03", end_date: "2026-08-16" });
});

test("overlap is INCLUSIVE at both ends — the off-by-one 027 catches", () => {
  const existing = [{ start_date: "2026-07-20", end_date: "2026-08-02" }];
  // Adjacent: starts the day after. Must NOT collide.
  no(overlapsAny({ start_date: "2026-08-03", end_date: "2026-08-16" }, existing), "adjacent");
  // Shares ONLY the end day. Must collide — with '[)' bounds it would not, and
  // the database would then reject a row this said was fine.
  ok(overlapsAny({ start_date: "2026-08-02", end_date: "2026-08-15" }, existing), "shares end day");
  // Fully contained.
  ok(overlapsAny({ start_date: "2026-07-25", end_date: "2026-07-26" }, existing), "contained");
  // Fully containing.
  ok(overlapsAny({ start_date: "2026-01-01", end_date: "2026-12-31" }, existing), "containing");
  // Clear of it entirely.
  no(overlapsAny({ start_date: "2026-09-01", end_date: "2026-09-14" }, existing), "disjoint");
});

test("periodForDate finds the owner, and both boundary days are inside it", () => {
  const periods = [
    { start_date: "2026-07-20", end_date: "2026-08-02", legacy_id: "1300" },
    { start_date: "2026-08-03", end_date: "2026-08-16", legacy_id: "1301" },
  ];
  eq(periodForDate("2026-07-20", periods)?.legacy_id, "1300", "first day");
  eq(periodForDate("2026-08-02", periods)?.legacy_id, "1300", "last day");
  eq(periodForDate("2026-08-03", periods)?.legacy_id, "1301", "next period's first day");
  eq(periodForDate("2019-01-01", periods), null, "before the calendar starts");
});

test("a fortnight holds TWO workweeks — the reason workweek_start is its own column", () => {
  // Both dates are inside the same pay period, and they owe their weekly
  // overtime to different weeks. Deriving the workweek from the period would
  // merge them and under-count >40h.
  const a = workweekStart("2026-07-24", DF); // Friday of week 1
  const b = workweekStart("2026-07-31", DF); // Friday of week 2
  eq(a, "2026-07-20");
  eq(b, "2026-07-27");
  ok(a !== b, "two distinct workweeks inside one pay period");
});

test("the workweek anchor is independent of the pay-period anchor", () => {
  // An org paying fortnightly from a Monday but running a Sunday workweek.
  const settings = { period_days: 14, period_starts_on: 1, workweek_starts_on: 7 };
  eq(workweekStart("2026-07-24", settings), "2026-07-19", "the Sunday before");
  eq(nextPeriodAfter("2026-08-02", settings).start_date, "2026-08-03", "period unaffected");
});

test("payrollSettings falls back rather than trusting jsonb", () => {
  eq(payrollSettings(null), DF, "null");
  eq(payrollSettings({}), DF, "empty");
  eq(payrollSettings({ period_days: 7, period_starts_on: 7, workweek_starts_on: 7 }), {
    period_days: 7, period_starts_on: 7, workweek_starts_on: 7,
  });
  // Out-of-range and wrong-typed values fall back instead of producing a
  // calendar nobody can explain.
  eq(payrollSettings({ period_starts_on: 9 }).period_starts_on, 1, "weekday 9");
  eq(payrollSettings({ period_days: 0 }).period_days, 14, "zero-length period");
  eq(payrollSettings({ period_days: "14" }).period_days, 14, "a string");
});

/* -- display -------------------------------------------------------------- */

test("a range collapses the year, and the month when it can", () => {
  eq(formatPeriodRange({ start_date: "2026-07-20", end_date: "2026-08-02" }), "Jul 20 – Aug 2, 2026");
  eq(formatPeriodRange({ start_date: "2026-08-03", end_date: "2026-08-16" }), "Aug 3 – 16, 2026");
  eq(formatPeriodRange({ start_date: "2025-12-29", end_date: "2026-01-11" }), "Dec 29, 2025 – Jan 11, 2026");
});
