// lib/breakRules — California meal breaks, assessed over a WORKDAY.
//
// The waiver boundary and the one-premium-per-day cap are the two cases that
// decide whether somebody is paid an hour they aren't owed, or not paid one
// they are.

import { test, eq, ok, no } from "./harness";
import { assessWorkday, owesMealPremium, type BreakShift } from "../../src/lib/breakRules";

let seq = 0;
function shift(hours: number, meal?: { after: number; minutes: number }): BreakShift {
  seq += 1;
  return {
    id: `b${String(seq).padStart(3, "0")}`,
    hours,
    mealStartAfterMinutes: meal ? meal.after : null,
    mealMinutes: meal ? meal.minutes : null,
  };
}

const NO_WAIVER = { hasMealWaiver: false };
const WAIVER = { hasMealWaiver: true };

/* -- when a meal is required at all ---------------------------------------- */

test("five hours or less needs no meal", () => {
  eq(assessWorkday([shift(5)], NO_WAIVER), []);
  eq(assessWorkday([shift(4.5)], NO_WAIVER), []);
});

test("over five hours with no meal owes a premium", () => {
  const f = assessWorkday([shift(7)], NO_WAIVER);
  eq(f.length, 1);
  eq(f[0].code, "no_meal");
});

/* -- the waiver boundary --------------------------------------------------- */

test("6h00m with a waiver is NOT owed; 6h01m with the same waiver IS", () => {
  // The waiver reaches a day of six hours or less and no further. One minute
  // past it, the same signed document stops covering the same missed meal.
  eq(assessWorkday([shift(6)], WAIVER), [], "exactly six hours");
  const over = assessWorkday([shift(6.0167)], WAIVER); // 6h01m
  eq(over.length, 1, "six hours and one minute");
  eq(over[0].code, "no_meal");
});

test("without a waiver, six hours is owed just the same", () => {
  const f = assessWorkday([shift(6)], NO_WAIVER);
  eq(f.length, 1);
  ok(f[0].waivable, "and it is marked as the kind a waiver would cover");
});

test("a waiver does not cover a SHORT meal, only a missing one", () => {
  // The waiver waives TAKING a meal, not taking a truncated one.
  const f = assessWorkday([shift(6, { after: 120, minutes: 20 })], WAIVER);
  eq(f.length, 1);
  eq(f[0].code, "short_meal");
  no(f[0].waivable, "not waivable");
});

/* -- the shape of the meal ------------------------------------------------- */

test("a proper meal, taken in time, owes nothing", () => {
  eq(assessWorkday([shift(8, { after: 240, minutes: 30 })], NO_WAIVER), []);
});

test("29 minutes is a short meal", () => {
  const f = assessWorkday([shift(8, { after: 120, minutes: 29 })], NO_WAIVER);
  eq(f[0].code, "short_meal");
});

test("a meal beginning after the fifth hour is late", () => {
  // 5h00m in is fine; 5h01m is not.
  eq(assessWorkday([shift(9, { after: 300, minutes: 30 })], NO_WAIVER), [], "exactly five hours in");
  const late = assessWorkday([shift(9, { after: 301, minutes: 30 })], NO_WAIVER);
  eq(late[0].code, "late_meal");
});

test("the LONGEST recorded meal is the day's meal, not the first", () => {
  // Ten minutes at 11am and a proper half hour at 1pm. Taking the first would
  // report a short-meal violation that did not happen.
  const f = assessWorkday(
    [shift(4, { after: 60, minutes: 10 }), shift(4, { after: 240, minutes: 30 })],
    NO_WAIVER
  );
  eq(f, []);
});

/* -- THE CAP --------------------------------------------------------------- */

test("two SHORT shifts add up to a day that needs a meal", () => {
  // Neither shift breaks five hours; the DAY does. Assessing the longest shift
  // instead of the day's total would find nothing here — and that mistake
  // survived an earlier version of this file, which only ever checked that the
  // function returns at most one finding (which its shape guarantees anyway).
  const f = assessWorkday([shift(3), shift(3)], NO_WAIVER);
  eq(f.length, 1, "six hours across two shifts still needs a meal");
  eq(f[0].code, "no_meal");
  // And a day that genuinely stays under five owes nothing.
  eq(assessWorkday([shift(2), shift(2.5)], NO_WAIVER), []);
});

test("two shifts on one workday both over 5h owe exactly ONE premium", () => {
  // The rule the function's SHAPE enforces. A per-shift assessment would return
  // two and the day would be paid twice.
  const f = assessWorkday([shift(6), shift(6)], NO_WAIVER);
  eq(f.length, 1, "one premium, not two");
  eq(f[0].code, "no_meal");
});

test("a day that already owes for a missed FIRST meal owes nothing more", () => {
  // 11 hours, no meal at all. That is one premium, not one for each of the two
  // meals the day required.
  const f = assessWorkday([shift(11)], NO_WAIVER);
  eq(f.length, 1);
  eq(f[0].code, "no_meal");
});

test("owesMealPremium is the same question, asked once", () => {
  ok(owesMealPremium([shift(7)], NO_WAIVER));
  no(owesMealPremium([shift(4)], NO_WAIVER));
  no(owesMealPremium([shift(6)], WAIVER));
});

/* -- the second meal ------------------------------------------------------- */

test("over ten hours needs a SECOND meal", () => {
  // First meal taken properly, day runs to 11 hours, only one meal recorded.
  const f = assessWorkday([shift(11, { after: 240, minutes: 30 })], NO_WAIVER);
  eq(f.length, 1);
  eq(f[0].code, "no_second_meal");
  ok(f[0].waivable, "waivable up to twelve hours");
});

test("exactly ten hours does not need a second meal", () => {
  eq(assessWorkday([shift(10, { after: 240, minutes: 30 })], NO_WAIVER), []);
});

test("two recorded meals on a long day satisfy it", () => {
  const f = assessWorkday(
    [shift(6, { after: 240, minutes: 30 }), shift(5, { after: 60, minutes: 30 })],
    NO_WAIVER
  );
  eq(f, []);
});

test("past twelve hours the second-meal waiver stops covering it", () => {
  const under = assessWorkday([shift(12, { after: 240, minutes: 30 })], WAIVER);
  eq(under, [], "twelve hours, waived");
  const over = assessWorkday([shift(12.5, { after: 240, minutes: 30 })], WAIVER);
  eq(over.length, 1, "twelve and a half");
  eq(over[0].code, "no_second_meal");
});

/* -- what it deliberately never returns ------------------------------------ */

test("no finding is ever a REST break", () => {
  // A rest break is paid and produces no punch, so there is nothing to derive
  // from but shift length — which would flag nearly every shift and teach
  // everyone to ignore the flag. Rest premiums are entered by hand.
  const all = [
    ...assessWorkday([shift(12)], NO_WAIVER),
    ...assessWorkday([shift(3)], NO_WAIVER),
    ...assessWorkday([shift(8, { after: 400, minutes: 15 })], NO_WAIVER),
  ];
  ok(all.every((f) => f.kind === "meal"), "every finding is a meal finding");
});
