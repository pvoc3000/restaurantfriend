// lib/timesheets — the pure half of a shift.
//
// Two cases here pin decisions that are easy to "simplify" into bugs: the
// tri-state exclusion (a boolean cannot say the third thing) and the fact that
// source and decided hours are stored separately on purpose.

import { test, eq, ok, no } from "./harness";
import {
  workedHours,
  decidedHours,
  sourceHours,
  otDisagreements,
  effectiveExclusion,
  excludedFromTips,
  formatHours,
  formatDecimalHours,
  type Timesheet,
} from "../../src/lib/timesheets";

function sheet(over: Partial<Timesheet> = {}): Timesheet {
  return {
    id: "t1",
    employee_id: "e1",
    location_id: null,
    pay_period_id: "p1",
    clock_in: null,
    clock_out: null,
    workday: "2026-07-24",
    business_date: "2026-07-24",
    workweek_start: "2026-07-20",
    source_hours_regular: null,
    source_hours_overtime: null,
    source_hours_double_ot: null,
    source_hours_paid: null,
    source_break_minutes: null,
    hours_regular: null,
    hours_overtime: null,
    hours_double_ot: null,
    ot_decision: "source",
    ot_reason: null,
    unpaid_break_minutes: null,
    sick_hours: null,
    exclude_tips: null,
    tip_hours: null,
    tip_allocation: null,
    source: "filemaker",
    source_row_key: null,
    source_payload: null,
    stitched: false,
    kind: "shift",
    employee_note: null,
    manager_note: null,
    scheduled_hours: null,
    position: null,
    ...over,
  };
}

/* -- worked hours ---------------------------------------------------------- */

test("worked hours subtract the unpaid meal", () => {
  const t = sheet({
    clock_in: "2026-07-24T15:00:00Z", // 8am PDT
    clock_out: "2026-07-24T23:30:00Z", // 4:30pm PDT
    unpaid_break_minutes: 30,
  });
  eq(workedHours(t), 8);
});

test("an overnight shift across fall-back is NINE hours, not eight", () => {
  // 2026-11-01: 10pm PDT the night before to 6am PST. The instants are 9 hours
  // apart and the wall clock says 8 — this is the module's reason to exist, and
  // it costs an hour of daily overtime.
  const t = sheet({
    clock_in: "2026-11-01T05:00:00Z", // 2026-10-31 22:00 PDT
    clock_out: "2026-11-01T14:00:00Z", // 2026-11-01 06:00 PST
    unpaid_break_minutes: 0,
  });
  eq(workedHours(t), 9);
  // And the CA daily-overtime consequence: 9 worked is 8 regular + 1 OT.
  ok((workedHours(t) as number) > 8, "owes daily overtime");
});

test("an unfinished shift is null, never zero", () => {
  // 184 rows in the real history have no clock-out. Zero would say "they worked
  // nothing", which is a claim; null says "we don't know", which is the truth.
  eq(workedHours(sheet({ clock_in: "2026-07-24T15:00:00Z", clock_out: null })), null);
  eq(workedHours(sheet({ clock_in: null, clock_out: "2026-07-24T23:00:00Z" })), null);
});

/* -- source vs decided ----------------------------------------------------- */

test("nothing disagrees when the decision matches the source", () => {
  const t = sheet({
    source_hours_regular: 8, source_hours_overtime: 1.5, source_hours_double_ot: 0,
    hours_regular: 8, hours_overtime: 1.5, hours_double_ot: 0,
  });
  eq(otDisagreements(t).length, 0);
  eq(sourceHours(t), 9.5);
  eq(decidedHours(t), 9.5);
});

test("a disagreement names the field, both numbers, and only that field", () => {
  // The stitched-overnight case: Homebase split the shift and paid no OT; we
  // reassembled it and it owes two hours.
  const t = sheet({
    source_hours_regular: 10, source_hours_overtime: 0, source_hours_double_ot: 0,
    hours_regular: 8, hours_overtime: 2, hours_double_ot: 0,
    ot_decision: "recomputed",
  });
  const d = otDisagreements(t);
  eq(d.length, 2);
  eq(d.map((x) => x.field), ["regular", "overtime"]);
  eq(d[0], { field: "regular", label: "Regular", source: 10, decided: 8 });
  eq(d[1], { field: "overtime", label: "Overtime", source: 0, decided: 2 });
  // Total hours are unchanged — only the SPLIT moved, which is exactly what
  // makes this worth surfacing rather than silently taking either side.
  eq(sourceHours(t), decidedHours(t));
});

test("null and 0.00 are the same CLAIM about overtime", () => {
  // A source that sent no overtime figure and one that sent 0.00 agree, so a
  // row like this must not be flagged as needing adjudication.
  const t = sheet({ source_hours_overtime: null, hours_overtime: 0 });
  eq(otDisagreements(t).length, 0);
});

test("a difference below a cent is float noise, not a disagreement", () => {
  eq(otDisagreements(sheet({ source_hours_regular: 8, hours_regular: 8.001 })).length, 0);
  eq(otDisagreements(sheet({ source_hours_regular: 8, hours_regular: 8.01 })).length, 1);
});

/* -- the tri-state --------------------------------------------------------- */

test("effectiveExclusion: null inherits the person's flag", () => {
  ok(effectiveExclusion(null, true), "inherits an excluded person");
  no(effectiveExclusion(null, false), "inherits an included person");
});

test("effectiveExclusion(false, true) === false — the THIRD state", () => {
  // The manager actually worked the floor on Saturday. A boolean column could
  // not express this: it would have to be null (inherit, wrong) or true
  // (excluded, also wrong). This is why exclude_tips is nullable.
  no(effectiveExclusion(false, true), "included despite the person-level default");
  // And the ordinary override in the other direction.
  ok(effectiveExclusion(true, false), "excluded for this shift only");
});

/* -- an adjustment is never in the pool ------------------------------------ */

test("excludedFromTips: an adjustment is excluded whatever the flags say", () => {
  // The reason it is derived rather than stored: seven real sick days were
  // already on file carrying exclude_tips = null, and read "—" in the Tips
  // column, which means "nobody has divided this day yet".
  ok(excludedFromTips(sheet({ kind: "adjustment" }), false), "null flag, included person");
  ok(excludedFromTips(sheet({ kind: "adjustment", exclude_tips: false }), false), "explicitly included");
  ok(excludedFromTips(sheet({ kind: "adjustment", exclude_tips: true }), true), "belt and braces");
});

test("excludedFromTips: a worked shift still answers through the tri-state", () => {
  no(excludedFromTips(sheet(), false), "ordinary shift, ordinary person");
  ok(excludedFromTips(sheet(), true), "inherits an excluded person");
  no(excludedFromTips(sheet({ exclude_tips: false }), true), "the THIRD state survives");
  ok(excludedFromTips(sheet({ exclude_tips: true }), false), "excluded for this shift only");
});

test("excludedFromTips: an UNFINISHED shift is not excluded — it is unfinished", () => {
  // Keying on "no hours" instead of on the kind would conflate the two, and
  // report a punch nobody closed as a deliberate exclusion from the pool. 184
  // rows in the FileMaker history have a clock-in and no clock-out.
  const open = sheet({ clock_in: "2026-07-24T14:00:00Z", clock_out: null });
  eq(workedHours(open), null, "no hours to divide");
  no(excludedFromTips(open, false), "still in the pool once somebody closes it");
});

/* -- display --------------------------------------------------------------- */

test("hours read as a clock, and round to the minute", () => {
  eq(formatHours(8), "8:00");
  eq(formatHours(1.5), "1:30");
  eq(formatHours(7.75), "7:45");
  eq(formatHours(0), "0:00");
  eq(formatHours(null), "—");
  // 0.52 hours is what FileMaker stored for a 31-minute break, and it should
  // read as 31 minutes rather than pretend to be 30.
  eq(formatHours(0.52), "0:31");
});

test("the decimal form matches numeric(8,2), which is what a payroll file wants", () => {
  eq(formatDecimalHours(8), "8.00");
  eq(formatDecimalHours(7.456), "7.46");
  eq(formatDecimalHours(null), "—");
});

test("toFixed does NOT round a half-cent up, and that is fine HERE", () => {
  // 1.005 is really 1.00499999999999989… in binary, so toFixed gives "1.00".
  // Pinned rather than fixed: these values arrive from numeric(8,2) columns and
  // are already at two places, so this is a display function that never sees a
  // half-way value in practice.
  //
  // It would NOT be fine in lib/gustoExport, where the same trick decides what
  // is written to a payroll file, or in the tip allocator, whose whole job is
  // making the cents sum exactly. Both must do integer-cent arithmetic instead.
  eq(formatDecimalHours(1.005), "1.00");
});
