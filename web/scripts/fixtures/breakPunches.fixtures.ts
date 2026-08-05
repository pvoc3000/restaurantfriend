// lib/payrollWorksheet.toBreakShift — reading a meal punch out of whatever the
// source happened to store.
//
// THE BUG THESE PIN. Two importers write the same punch under different names:
// `transform-timesheets.mjs` uses FileMaker's `break_start` / `break_end` /
// `time_in`, while the Homebase importer spread its own row shape and got
// `breakStart` / `breakEnd` / `clockInTime`. The reader knew only the first set,
// so on every IMPORTED shift the punches read as null — which meant `late_meal`
// could not fire at all and a missed meal was inferred from the deduction alone
// (Mark, 2026-08-05: "missed break not flagged by app… what about late
// breaks?").
//
// So the cases below run the SAME shift through both spellings and require the
// same answer. Checked by breaking it: dropping the camelCase names from
// `firstWallMinutes` turns the four camelCase cases red and leaves the
// snake_case ones green, which is exactly the shape the live bug had.

import { test, eq, ok } from "./harness";
import { toBreakShift, type BreakShiftFacts } from "../../src/lib/payrollWorksheet";
import { assessWorkday } from "../../src/lib/breakRules";

const NO_WAIVER = { hasMealWaiver: false };

/** A nine-hour shift, 6am → 3pm, with whatever payload is handed in. */
function shift(payload: Record<string, unknown>, breakMinutes: number | null = null): BreakShiftFacts {
  return {
    id: "t1",
    clock_in: "2026-07-21T13:00:00.000Z", // 6:00am America/Los_Angeles
    clock_out: "2026-07-21T22:00:00.000Z", // 3:00pm — nine hours clock to clock
    unpaid_break_minutes: breakMinutes,
    source_payload: payload,
  };
}

/* -- the two spellings agree ----------------------------------------------- */

const FMP = { time_in: "6:00am", break_start: "10:00am", break_end: "10:30am" };
const HOMEBASE = { clockInTime: "6:00am", breakStart: "10:00am", breakEnd: "10:30am" };

test("a meal read from FileMaker's spelling", () => {
  const b = toBreakShift(shift(FMP));
  eq(b.mealMinutes, 30, "meal minutes");
  eq(b.mealStartAfterMinutes, 240, "minutes into the shift");
});

test("the same meal read from Homebase's spelling", () => {
  const b = toBreakShift(shift(HOMEBASE));
  eq(b.mealMinutes, 30, "meal minutes");
  eq(b.mealStartAfterMinutes, 240, "minutes into the shift");
});

test("both spellings produce the same assessment — a proper meal owes nothing", () => {
  eq(assessWorkday([toBreakShift(shift(FMP))], NO_WAIVER), []);
  eq(assessWorkday([toBreakShift(shift(HOMEBASE))], NO_WAIVER), []);
});

/* -- the case that could never fire before --------------------------------- */

// The meal begins 5h30m in, past the end of the fifth hour. This is the finding
// that is UNREACHABLE without a start time: with no punches the reader has only
// a duration, and a duration cannot be late.
const LATE_FMP = { time_in: "6:00am", break_start: "11:30am", break_end: "12:00pm" };
const LATE_HOMEBASE = { clockInTime: "6:00am", breakStart: "11:30am", breakEnd: "12:00pm" };

test("a late meal is found in FileMaker's spelling", () => {
  const found = assessWorkday([toBreakShift(shift(LATE_FMP))], NO_WAIVER);
  eq(found.length, 1, "findings");
  eq(found[0].code, "late_meal");
});

test("a late meal is found in Homebase's spelling too", () => {
  const found = assessWorkday([toBreakShift(shift(LATE_HOMEBASE))], NO_WAIVER);
  eq(found.length, 1, "findings");
  eq(found[0].code, "late_meal");
});

test("a late meal is NOT waivable — the waiver waives taking one, not taking it late", () => {
  const found = assessWorkday([toBreakShift(shift(LATE_HOMEBASE))], { hasMealWaiver: true });
  eq(found.length, 1, "findings");
  eq(found[0].code, "late_meal");
});

/* -- the deduction-only fallback still works ------------------------------- */

test("a deduction with no punches gives minutes but no start time", () => {
  const b = toBreakShift(shift({}, 30));
  eq(b.mealMinutes, 30, "meal minutes");
  // Null rather than 0: zero would assert the meal began the moment they
  // clocked in, which is a claim nobody made.
  eq(b.mealStartAfterMinutes, null, "minutes into the shift");
});

test("a deduction-only meal cannot be judged late, and isn't", () => {
  eq(assessWorkday([toBreakShift(shift({}, 30))], NO_WAIVER), []);
});

test("no punches and no deduction on a nine-hour day is a missed meal", () => {
  const found = assessWorkday([toBreakShift(shift({}))], NO_WAIVER);
  eq(found.length, 1, "findings");
  eq(found[0].code, "no_meal");
  // Nine hours is well past the six a waiver can reach.
  eq(found[0].waivable, false, "waivable");
});

/* -- the edges of reading a time ------------------------------------------- */

test("the snake_case name wins when a row somehow carries both", () => {
  const b = toBreakShift(
    shift({ time_in: "6:00am", break_start: "10:00am", break_end: "10:30am", breakStart: "1:00pm" })
  );
  eq(b.mealStartAfterMinutes, 240, "minutes into the shift");
});

test("an empty or unreadable time falls through to the other spelling", () => {
  const b = toBreakShift(
    shift({ break_start: "", breakStart: "10:00am", break_end: null, breakEnd: "10:30am", clockInTime: "6:00am" })
  );
  eq(b.mealMinutes, 30, "meal minutes");
  eq(b.mealStartAfterMinutes, 240, "minutes into the shift");
});

test("24-hour times read as well as 12-hour ones", () => {
  const b = toBreakShift(shift({ clockInTime: "06:00", breakStart: "10:00", breakEnd: "10:30" }));
  eq(b.mealMinutes, 30, "meal minutes");
  eq(b.mealStartAfterMinutes, 240, "minutes into the shift");
});

test("a meal taken across midnight has a positive length", () => {
  const b = toBreakShift(shift({ clockInTime: "9:00pm", breakStart: "11:45pm", breakEnd: "12:15am" }));
  eq(b.mealMinutes, 30, "meal minutes");
  eq(b.mealStartAfterMinutes, 165, "minutes into the shift");
});

test("a short meal is reported whichever spelling carried it", () => {
  for (const p of [
    { time_in: "6:00am", break_start: "10:00am", break_end: "10:15am" },
    { clockInTime: "6:00am", breakStart: "10:00am", breakEnd: "10:15am" },
  ]) {
    const found = assessWorkday([toBreakShift(shift(p))], NO_WAIVER);
    eq(found.length, 1, "findings");
    eq(found[0].code, "short_meal");
    ok(found[0].detail.includes("15"), "the detail names the length");
  }
});
