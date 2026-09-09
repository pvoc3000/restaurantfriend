// `lib/dateRange` — the range picker's arithmetic and presets.
//
// Checked by BREAKING each rule: a Sunday-first week turns the grid and the
// week presets red, a `slice(0,10)` on a local Date turns the month ends red
// west of Greenwich, and dropping the round trip in `parseRangeParams` lets
// February 31st through as a March window.

import { test, eq } from "./harness";
import {
  addMonths,
  formatRange,
  inRange,
  isoWeekdayOf,
  matchingPreset,
  monthEnd,
  monthGrid,
  monthLabel,
  monthStart,
  normalizeRange,
  parseRangeParams,
  RANGE_PRESETS,
  weekStart,
} from "../../src/lib/dateRange";

// 2026-09-08 is a Tuesday.
const TUE = "2026-09-08";

/* -- calendar arithmetic ------------------------------------------------- */

test("ISO weekday: Monday is 1, Sunday is 7", () => {
  eq(isoWeekdayOf("2026-09-07"), 1);
  eq(isoWeekdayOf(TUE), 2);
  eq(isoWeekdayOf("2026-09-13"), 7);
});

test("weekStart is the Monday on or before", () => {
  eq(weekStart(TUE), "2026-09-07");
  eq(weekStart("2026-09-07"), "2026-09-07");
  eq(weekStart("2026-09-13"), "2026-09-07");
});

test("month start and end, including leap February and a 31-day month", () => {
  eq(monthStart(TUE), "2026-09-01");
  eq(monthEnd(TUE), "2026-09-30");
  eq(monthEnd("2028-02-10"), "2028-02-29");
  eq(monthEnd("2026-12-31"), "2026-12-31");
});

test("addMonths lands on the FIRST and crosses a year", () => {
  eq(addMonths("2026-01-31", 1), "2026-02-01");
  eq(addMonths("2026-12-15", 1), "2027-01-01");
  eq(addMonths("2026-01-15", -1), "2025-12-01");
});

test("normalizeRange takes two taps in either order", () => {
  eq(normalizeRange("2026-09-01", "2026-09-08"), { from: "2026-09-01", to: "2026-09-08" });
  eq(normalizeRange("2026-09-08", "2026-09-01"), { from: "2026-09-01", to: "2026-09-08" });
  eq(normalizeRange(TUE, TUE), { from: TUE, to: TUE });
});

test("inRange is inclusive at both ends", () => {
  const r = { from: "2026-09-01", to: "2026-09-08" };
  eq(inRange("2026-09-01", r), true);
  eq(inRange("2026-09-08", r), true);
  eq(inRange("2026-08-31", r), false);
  eq(inRange("2026-09-09", r), false);
});

/* -- the grid ------------------------------------------------------------ */

test("monthGrid is six Monday-first weeks covering the month", () => {
  const grid = monthGrid(TUE);
  eq(grid.length, 6);
  eq(grid[0].length, 7);
  // September 2026 begins on a Tuesday, so the grid opens on Monday the 31st.
  eq(grid[0][0], { iso: "2026-08-31", inMonth: false });
  eq(grid[0][1], { iso: "2026-09-01", inMonth: true });
  eq(grid[4][2], { iso: "2026-09-30", inMonth: true });
  eq(grid[4][3], { iso: "2026-10-01", inMonth: false });
  eq(grid[5][6], { iso: "2026-10-11", inMonth: false });
});

test("a month that starts on a Monday still gets six rows", () => {
  // June 2026 starts on a Monday.
  const grid = monthGrid("2026-06-15");
  eq(grid[0][0], { iso: "2026-06-01", inMonth: true });
  eq(grid.length, 6);
});

test("monthLabel", () => {
  eq(monthLabel(TUE), "September 2026");
  eq(monthLabel("2027-01-04"), "January 2027");
});

/* -- presets ------------------------------------------------------------- */

const P = RANGE_PRESETS;

test("today, yesterday, tomorrow are single days", () => {
  eq(P.today.range(TUE), { from: TUE, to: TUE });
  eq(P.yesterday.range(TUE), { from: "2026-09-07", to: "2026-09-07" });
  eq(P.tomorrow.range(TUE), { from: "2026-09-09", to: "2026-09-09" });
});

test("Last week is seven days ago through yesterday — Mark's definition", () => {
  eq(P.last_week.range(TUE), { from: "2026-09-01", to: "2026-09-07" });
});

test("Next week is tomorrow through seven days out", () => {
  eq(P.next_week.range(TUE), { from: "2026-09-09", to: "2026-09-15" });
});

test("This week and Previous week are calendar Mon–Sun weeks", () => {
  eq(P.this_week.range(TUE), { from: "2026-09-07", to: "2026-09-13" });
  eq(P.previous_week.range(TUE), { from: "2026-08-31", to: "2026-09-06" });
  // On a Sunday the week is still the one that started six days earlier.
  eq(P.this_week.range("2026-09-13"), { from: "2026-09-07", to: "2026-09-13" });
});

test("rolling 30 and 90 end yesterday", () => {
  eq(P.last_30_days.range(TUE), { from: "2026-08-09", to: "2026-09-07" });
  eq(P.last_90_days.range(TUE), { from: "2026-06-10", to: "2026-09-07" });
});

test("This, last and next month are calendar months", () => {
  eq(P.this_month.range(TUE), { from: "2026-09-01", to: "2026-09-30" });
  eq(P.last_month.range(TUE), { from: "2026-08-01", to: "2026-08-31" });
  eq(P.next_month.range(TUE), { from: "2026-10-01", to: "2026-10-31" });
  // Across the year boundary, both ways.
  eq(P.last_month.range("2026-01-20"), { from: "2025-12-01", to: "2025-12-31" });
  eq(P.next_month.range("2026-12-20"), { from: "2027-01-01", to: "2027-01-31" });
});

test("year presets", () => {
  eq(P.this_year.range(TUE), { from: "2026-01-01", to: "2026-12-31" });
  eq(P.last_year.range(TUE), { from: "2025-01-01", to: "2025-12-31" });
  eq(P.year_to_date.range(TUE), { from: "2026-01-01", to: TUE });
});

test("matchingPreset names the preset a range IS, first match winning", () => {
  eq(matchingPreset({ from: TUE, to: TUE }, ["today", "last_week"], TUE)?.key, "today");
  eq(matchingPreset({ from: "2026-09-01", to: "2026-09-07" }, ["today", "last_week"], TUE)?.key, "last_week");
  eq(matchingPreset({ from: "2026-09-02", to: "2026-09-07" }, ["today", "last_week"], TUE), null);
  eq(matchingPreset(null, ["today"], TUE), null);
  // A preset that means "no range" matches a null value, and nothing else.
  const all = { key: "all", label: "All time", range: () => null };
  eq(matchingPreset(null, ["today", all], TUE)?.key, "all");
  eq(matchingPreset({ from: TUE, to: TUE }, [all, "today"], TUE)?.key, "today");
  // A caller's own preset is matched like a built-in one.
  const custom = { key: "pp", label: "This pay period", range: () => ({ from: "2026-08-31", to: "2026-09-13" }) };
  eq(matchingPreset({ from: "2026-08-31", to: "2026-09-13" }, [custom, "this_week"], TUE)?.label, "This pay period");
});

/* -- display and URL ----------------------------------------------------- */

test("formatRange collapses a single day", () => {
  eq(formatRange({ from: "2026-09-01", to: "2026-09-08" }), "09/01/2026 – 09/08/2026");
  eq(formatRange({ from: TUE, to: TUE }), "09/08/2026");
});

test("parseRangeParams takes two real dates in order and nothing else", () => {
  eq(parseRangeParams("2026-09-01", "2026-09-08"), { from: "2026-09-01", to: "2026-09-08" });
  eq(parseRangeParams(["2026-09-01"], ["2026-09-08"]), { from: "2026-09-01", to: "2026-09-08" });
  eq(parseRangeParams("2026-09-08", "2026-09-01"), null, "reversed");
  eq(parseRangeParams("2026-09-01", undefined), null, "half a pair");
  eq(parseRangeParams("2026-02-31", "2026-03-05"), null, "a date that rolls over");
  eq(parseRangeParams("9/1/2026", "9/8/2026"), null, "not ISO");
});
