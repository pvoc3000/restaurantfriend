// timesheetIssues — the Issues filter on /timesheets.

import { timesheetIssues, type IssueFacts } from "../../src/lib/timesheetIssues";
import { eq, test } from "./harness";

const clean: IssueFacts = {
  mealCode: null,
  mealDecided: false,
  title: "Donut Fryer",
  kind: "shift",
  clockIn: "2026-09-01T08:00:00Z",
  clockOut: "2026-09-01T14:00:00Z",
  gustoId: "n4smoy",
  locationId: "loc-1",
  workedHours: 6,
  excludedFromTips: false,
  poolHasFigure: true,
  poolUnallocatedCents: 0,
  ambiguousTime: false,
};

const issues = (over: Partial<IssueFacts>) => [...timesheetIssues({ ...clean, ...over })].sort();

test("issues: a clean shift carries none", () => {
  eq(issues({}), []);
});

test("issues: a late meal is Late meal and not No meal", () => {
  eq(issues({ mealCode: "late_meal" }), ["late_meal"]);
});

test("issues: short and second meals file under No meal", () => {
  eq(issues({ mealCode: "no_meal" }), ["no_meal"]);
  eq(issues({ mealCode: "short_meal" }), ["no_meal"]);
  eq(issues({ mealCode: "no_second_meal" }), ["no_meal"]);
});

test("issues: a decided meal finding is no longer an issue", () => {
  eq(issues({ mealCode: "late_meal", mealDecided: true }), []);
  eq(issues({ mealCode: "no_meal", mealDecided: true }), []);
});

test("issues: a blank title is No title", () => {
  eq(issues({ title: null }), ["no_title"]);
  eq(issues({ title: "  " }), ["no_title"]);
});

test("issues: a shop-day with no tip figure is a tip issue", () => {
  eq(issues({ poolHasFigure: false }), ["tips"]);
});

test("issues: money nobody could receive is a tip issue", () => {
  eq(issues({ poolUnallocatedCents: 1200 }), ["tips"]);
});

test("issues: an excluded or hourless shift has no tip issue", () => {
  eq(issues({ poolHasFigure: false, excludedFromTips: true }), []);
  eq(issues({ poolHasFigure: false, workedHours: 0 }), []);
});

test("issues: no shop is its own issue, not a tip one", () => {
  eq(issues({ locationId: null, poolHasFigure: false }), ["no_shop"]);
});

test("issues: an open shift is No clock-out, an adjustment is not", () => {
  eq(issues({ clockOut: null }), ["no_clock_out"]);
  eq(issues({ kind: "adjustment", clockIn: null, clockOut: null }), []);
});

test("issues: no payroll id and an ambiguous time are flagged", () => {
  eq(issues({ gustoId: null, ambiguousTime: true }), ["ambiguous_time", "no_payroll_id"]);
});
