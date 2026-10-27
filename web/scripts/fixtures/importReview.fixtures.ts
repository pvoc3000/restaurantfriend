// lib/importReview — what re-importing a Homebase shift would do to the row
// already there.
//
// The case that matters is an EDIT: it must never read as Unchanged or
// Changed, because those start ticked and the write would overwrite it.

import { test, eq } from "./harness";
import {
  reviewShift,
  selectedByDefault,
  type IncomingShift,
  type StoredShift,
} from "../../src/lib/importReview";

function incoming(over: Partial<IncomingShift> = {}): IncomingShift {
  return {
    regular: 5.2,
    overtime: 0,
    double_ot: 0,
    paid: 5.2,
    breakMinutes: 30,
    clockOut: "2026-10-23T20:10:00.000Z",
    position: "Sr. Donut Friend",
    wageRate: 21,
    employeeNote: null,
    managerNote: null,
    ...over,
  };
}

/** As PostgREST hands it back: numerics as strings, the raw row in the payload. */
function stored(over: Partial<StoredShift> = {}, payload: Record<string, unknown> = {}): StoredShift {
  return {
    source_hours_regular: "5.20",
    source_hours_overtime: "0.00",
    source_hours_double_ot: "0.00",
    source_hours_paid: "5.20",
    source_break_minutes: 30,
    hours_regular: "5.20",
    hours_overtime: "0.00",
    hours_double_ot: "0.00",
    ot_decision: "source",
    unpaid_break_minutes: 30,
    clock_out: "2026-10-23T20:10:00+00:00",
    position: "Sr. Donut Friend",
    employee_note: null,
    manager_note: null,
    source_payload: { wage_rate: 21, employeeNote: null, managerNote: null, ...payload },
    ...over,
  };
}

test("a shift with no row is new, and ticked", () => {
  const r = reviewShift(incoming(), null);
  eq(r.status, "new");
  eq(selectedByDefault(r.status), true);
});

test("the same figures, spelled as strings and another time format, are unchanged", () => {
  eq(reviewShift(incoming(), stored()).status, "unchanged");
});

test("a new pay rate from Homebase is changed, and ticked — the Baiza case", () => {
  const r = reviewShift(incoming({ wageRate: 21 }), stored({}, { wage_rate: 19 }));
  eq(r.status, "changed");
  eq(r.changed, ["pay rate"]);
  eq(selectedByDefault(r.status), true);
});

test("Homebase's hours, break, clock-out, role and notes each read as changed", () => {
  eq(reviewShift(incoming({ overtime: 0.5 }), stored()).changed, ["hours"]);
  eq(reviewShift(incoming({ breakMinutes: 31 }), stored()).changed, ["break"]);
  eq(reviewShift(incoming({ clockOut: "2026-10-23T20:11:00.000Z" }), stored()).changed, ["clock-out"]);
  eq(reviewShift(incoming({ position: "Supervisor" }), stored()).changed, ["role"]);
  eq(reviewShift(incoming({ managerNote: "left early" }), stored()).changed, ["notes"]);
});

test("an hours split changed here is edited, and NOT ticked", () => {
  const r = reviewShift(incoming(), stored({ hours_regular: "4.20", hours_overtime: "1.00" }));
  eq(r.status, "edited");
  eq(r.edited, ["hours"]);
  eq(selectedByDefault(r.status), false);
});

test("an overtime decision that landed back on the source's figures is still an edit", () => {
  // Someone looked and decided; a re-import would erase the decision.
  eq(reviewShift(incoming(), stored({ ot_decision: "recomputed" })).status, "edited");
});

test("a break or a note changed here is edited", () => {
  eq(reviewShift(incoming(), stored({ unpaid_break_minutes: 0 })).edited, ["break"]);
  eq(reviewShift(incoming(), stored({ manager_note: "approved by Mark" })).edited, ["notes"]);
});

test("edited wins over changed, and says Homebase moved too", () => {
  const r = reviewShift(
    incoming({ wageRate: 21 }),
    stored({ hours_overtime: "0.50", hours_regular: "4.70" }, { wage_rate: 19 })
  );
  eq(r.status, "edited");
  eq(r.alsoChanged, true);
  eq(r.changed, ["pay rate"]);
});

test("a blank note and a missing one are the same note", () => {
  eq(reviewShift(incoming({ employeeNote: "  " }), stored()).status, "unchanged");
  eq(reviewShift(incoming(), stored({ manager_note: "" })).status, "unchanged");
});

test("a cent of rounding is not a change", () => {
  eq(reviewShift(incoming({ regular: 5.2 }), stored({ source_hours_regular: "5.200" })).status, "unchanged");
  eq(reviewShift(incoming({ regular: 5.21 }), stored()).status, "changed");
});
