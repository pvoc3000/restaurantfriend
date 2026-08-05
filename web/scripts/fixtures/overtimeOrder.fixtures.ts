// lib/overtime — WHICH shift on a multi-shift day carries the overtime.
//
// THE BUG THESE PIN. `pourOverShifts` fills regular hours first and then
// overtime, so the order it walks decides which shift ends up holding the
// premium hours. `proposeOvertime` sorted a workday's shifts by `id` — a uuid,
// so effectively at random — while its own comment said "chronologically".
//
// The day's TOTAL was never affected, which is why seven years of totals looked
// right and nothing caught it. What was wrong was the per-shift allocation, and
// it surfaced the first time a human read a single row: the app proposed
// overtime AND double-time on a seven-hour shift, and explained itself with
// "over 8 hours in the day; over 12 hours in the day" (Mark, 2026-08-05).
//
// The ids below are chosen so `id` order and CLOCK order disagree — that is the
// whole point, and a fixture whose ids happen to sort chronologically would
// pass against the bug.

import { test, eq } from "./harness";
import { proposeOvertime, type ShiftHours } from "../../src/lib/overtime";

function shift(id: string, hours: number, starts_at: string | null): ShiftHours {
  return {
    id,
    employee_id: "e1",
    workday: "2026-07-26",
    workweek_start: "2026-07-20",
    hours,
    starts_at,
  };
}

const split = (m: Map<string, { regular: number; overtime: number; double_ot: number }>, id: string) => {
  const p = m.get(id);
  return p ? { regular: p.regular, overtime: p.overtime, double_ot: p.double_ot } : null;
};

/* -- Eddy Salazar, workday 2026-07-26 -------------------------------------- */
//
// The real row that found this. A 7.20h shift beginning 12:18am and a 9.50h
// shift beginning 10:10pm the same workday — 16.70h, so the day owes 8 regular,
// 4 overtime and 4.70 double. FileMaker stored 7.20/0/0 and 0.80/4/4.70, and
// that is the answer chronological pouring gives.
//
// Note the ids: "869…" sorts BEFORE "a92…", so the uuid order is the reverse of
// the clock order. These are the first eight characters of the real rows.

const EARLY = () => shift("a92c4ff5", 7.2, "2026-07-26T07:18:00Z");  // 12:18am
const LATE = () => shift("869ff8c6", 9.5, "2026-07-27T05:10:00Z");   // 10:10pm

test("the early shift keeps its regular hours; the late one carries the overtime", () => {
  const m = proposeOvertime([EARLY(), LATE()]);
  eq(split(m, "a92c4ff5"), { regular: 7.2, overtime: 0, double_ot: 0 });
  eq(split(m, "869ff8c6"), { regular: 0.8, overtime: 4, double_ot: 4.7 });
});

test("and the answer does not depend on the order the rows arrived in", () => {
  const m = proposeOvertime([LATE(), EARLY()]);
  eq(split(m, "a92c4ff5"), { regular: 7.2, overtime: 0, double_ot: 0 });
  eq(split(m, "869ff8c6"), { regular: 0.8, overtime: 4, double_ot: 4.7 });
});

test("a shift under 8 hours is never told it is over 8 or over 12", () => {
  const m = proposeOvertime([EARLY(), LATE()]);
  // The reason only ever rides a shift that actually carries the hours it
  // explains. The 7.20h shift carries none, so it claims nothing.
  eq(m.get("a92c4ff5")!.reasons, []);
  eq(m.get("869ff8c6")!.reasons, ["daily_over_8", "daily_over_12"]);
});

test("the day's totals are the same either way — only the allocation moved", () => {
  for (const order of [[EARLY(), LATE()], [LATE(), EARLY()]]) {
    const m = proposeOvertime(order);
    let regular = 0, overtime = 0, double_ot = 0;
    for (const s of order) {
      const p = m.get(s.id)!;
      regular += p.regular; overtime += p.overtime; double_ot += p.double_ot;
    }
    eq({ regular: Math.round(regular * 100) / 100, overtime, double_ot },
       { regular: 8, overtime: 4, double_ot: 4.7 });
  }
});

/* -- the ordering rule in general ------------------------------------------ */

test("three shifts fill regular in clock order, not id order", () => {
  // ids descend as the clock ascends, so any id-based sort gets this backwards.
  const a = shift("zzz", 5, "2026-07-26T08:00:00Z");
  const b = shift("mmm", 5, "2026-07-26T15:00:00Z");
  const c = shift("aaa", 5, "2026-07-26T22:00:00Z");
  const m = proposeOvertime([a, b, c]); // 15h → 8 reg, 4 OT, 3 dbl
  eq(split(m, "zzz"), { regular: 5, overtime: 0, double_ot: 0 });
  eq(split(m, "mmm"), { regular: 3, overtime: 2, double_ot: 0 });
  eq(split(m, "aaa"), { regular: 0, overtime: 2, double_ot: 3 });
});

test("a shift with no start time sinks to the end", () => {
  // An adjustment row has no punch. It must not steal the regular hours from a
  // real shift merely by sorting first.
  const punched = shift("zzz", 9, "2026-07-26T08:00:00Z");
  const adjustment = shift("aaa", 4, null);
  const m = proposeOvertime([adjustment, punched]); // 13h → 8 reg, 4 OT, 1 dbl
  eq(split(m, "zzz"), { regular: 8, overtime: 1, double_ot: 0 });
  eq(split(m, "aaa"), { regular: 0, overtime: 3, double_ot: 1 });
});

test("two shifts with no start time at all still answer deterministically", () => {
  const a = shift("bbb", 5, null);
  const b = shift("aaa", 5, null);
  // Nothing can order these by time, so `id` decides — and it must decide the
  // same way whichever order they arrive in.
  eq(split(proposeOvertime([a, b]), "aaa"), split(proposeOvertime([b, a]), "aaa"));
  eq(split(proposeOvertime([a, b]), "aaa"), { regular: 5, overtime: 0, double_ot: 0 });
});

test("a single-shift day is unaffected by any of this", () => {
  const m = proposeOvertime([shift("only", 10, "2026-07-26T08:00:00Z")]);
  eq(split(m, "only"), { regular: 8, overtime: 2, double_ot: 0 });
});
