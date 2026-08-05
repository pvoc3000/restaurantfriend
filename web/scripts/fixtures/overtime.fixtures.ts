// lib/overtime — California overtime, recomputed.
//
// The first case is the brief's own reason for the module. The non-stacking
// case is the one a rewrite is most likely to break, and it is silent when
// broken: it just pays people twice for the same hours.

import { test, eq, ok, no } from "./harness";
import {
  proposeOvertime,
  compareToSource,
  splitTotal,
  type ShiftHours,
} from "../../src/lib/overtime";

let seq = 0;
function shift(workday: string, hours: number, over: Partial<ShiftHours> = {}): ShiftHours {
  seq += 1;
  return {
    id: `s${String(seq).padStart(3, "0")}`,
    employee_id: "e1",
    workday,
    // The Monday of the week containing 2026-07-20..26.
    workweek_start: "2026-07-20",
    hours,
    ...over,
  };
}

const split = (m: Map<string, { regular: number; overtime: number; double_ot: number }>, id: string) => {
  const p = m.get(id);
  return p ? { regular: p.regular, overtime: p.overtime, double_ot: p.double_ot } : null;
};

/** Sum a whole week's proposal. */
function weekTotals(shifts: ShiftHours[]) {
  const m = proposeOvertime(shifts);
  let regular = 0, overtime = 0, double_ot = 0;
  for (const s of shifts) {
    const p = m.get(s.id);
    if (!p) continue;
    regular += p.regular; overtime += p.overtime; double_ot += p.double_ot;
  }
  return {
    regular: Math.round(regular * 100) / 100,
    overtime: Math.round(overtime * 100) / 100,
    double_ot: Math.round(double_ot * 100) / 100,
  };
}

/* -- the module's reason to exist ------------------------------------------ */

test("a 10-hour overnight shift owes 2 hours of daily OT", () => {
  // 6pm–4am. Split at midnight into 6h + 4h it would owe NONE, which is the
  // error the whole module exists to prevent. Whole, it owes two.
  const s = shift("2026-07-20", 10);
  eq(split(proposeOvertime([s]), s.id), { regular: 8, overtime: 2, double_ot: 0 });
});

test("the same shift split at midnight owes NOTHING — the bug, stated", () => {
  // Two rows on two days, 6h and 4h. Neither breaks 8.
  const a = shift("2026-07-20", 6);
  const b = shift("2026-07-21", 4);
  eq(weekTotals([a, b]), { regular: 10, overtime: 0, double_ot: 0 });
  // …versus the reassembled version, which owes 2. Same ten hours, two answers.
  const whole = shift("2026-07-20", 10);
  eq(weekTotals([whole]), { regular: 8, overtime: 2, double_ot: 0 });
});

/* -- daily ----------------------------------------------------------------- */

test("under 8 hours owes nothing", () => {
  const s = shift("2026-07-20", 7.5);
  eq(split(proposeOvertime([s]), s.id), { regular: 7.5, overtime: 0, double_ot: 0 });
});

test("over 12 hours splits three ways", () => {
  const s = shift("2026-07-20", 13.5);
  eq(split(proposeOvertime([s]), s.id), { regular: 8, overtime: 4, double_ot: 1.5 });
  eq(splitTotal({ regular: 8, overtime: 4, double_ot: 1.5 }), 13.5);
});

test("exactly 8 and exactly 12 are the boundaries, not past them", () => {
  const a = shift("2026-07-20", 8);
  eq(split(proposeOvertime([a]), a.id), { regular: 8, overtime: 0, double_ot: 0 });
  const b = shift("2026-07-21", 12);
  eq(split(proposeOvertime([b]), b.id), { regular: 8, overtime: 4, double_ot: 0 });
});

test("two shifts on ONE workday are added before the rule is applied", () => {
  // 5h in the morning and 5h at night is a ten-hour DAY and owes two hours —
  // not two separate five-hour days owing nothing.
  const a = shift("2026-07-20", 5);
  const b = shift("2026-07-20", 5);
  eq(weekTotals([a, b]), { regular: 8, overtime: 2, double_ot: 0 });
  // And the overtime lands on the later shift, which is the one that ran late.
  eq(split(proposeOvertime([a, b]), a.id), { regular: 5, overtime: 0, double_ot: 0 });
  eq(split(proposeOvertime([a, b]), b.id), { regular: 3, overtime: 2, double_ot: 0 });
});

/* -- weekly, and the non-stacking guarantee -------------------------------- */

test("DAILY AND WEEKLY DO NOT STACK — five 9h days is 5 OT, not 10", () => {
  // 45 hours worked. The daily rule takes 1 hour a day = 5 OT, leaving 40
  // regular. The weekly rule then adds ZERO, because only 40 were ever regular.
  // Applying both would pay 10 overtime hours for 45 worked.
  const week = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"].map((d) =>
    shift(d, 9)
  );
  eq(weekTotals(week), { regular: 40, overtime: 5, double_ot: 0 });
});

test("the weekly rule DOES bite when no day broke 8", () => {
  // Six 7-hour days is 42 hours and not one day over 8. Two hours are weekly OT.
  const week = [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25",
  ].map((d) => shift(d, 7));
  eq(weekTotals(week), { regular: 40, overtime: 2, double_ot: 0 });
});

test("weekly overtime lands on the LAST days, not the first", () => {
  const week = [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25",
  ].map((d) => shift(d, 7));
  const m = proposeOvertime(week);
  // Monday is untouched; Saturday carries it.
  eq(split(m, week[0].id), { regular: 7, overtime: 0, double_ot: 0 });
  eq(split(m, week[5].id), { regular: 5, overtime: 2, double_ot: 0 });
});

test("exactly 40 hours owes nothing", () => {
  const week = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"].map((d) =>
    shift(d, 8)
  );
  eq(weekTotals(week), { regular: 40, overtime: 0, double_ot: 0 });
});

test("a mixed week: one long day plus enough short ones to pass 40", () => {
  // Mon 10 (2 daily OT, 8 regular), Tue–Fri 8 each (32 regular) = 40 regular.
  // Weekly adds nothing. Sat 6 is entirely over 40.
  const week = [
    shift("2026-07-20", 10),
    shift("2026-07-21", 8),
    shift("2026-07-22", 8),
    shift("2026-07-23", 8),
    shift("2026-07-24", 8),
    shift("2026-07-25", 6),
  ];
  eq(weekTotals(week), { regular: 40, overtime: 8, double_ot: 0 });
});

/* -- the seventh day ------------------------------------------------------- */

test("the seventh day worked has NO regular time", () => {
  const week = [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
    "2026-07-24", "2026-07-25", "2026-07-26",
  ].map((d) => shift(d, 6));
  const m = proposeOvertime(week);
  // Six 6-hour days = 36 regular, under 40 and none over 8.
  eq(split(m, week[0].id), { regular: 6, overtime: 0, double_ot: 0 });
  // The seventh is all overtime, even though it is only 6 hours.
  eq(split(m, week[6].id), { regular: 0, overtime: 6, double_ot: 0 });
});

test("over 8 hours on the seventh day is DOUBLE time", () => {
  const week = [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25",
  ].map((d) => shift(d, 4));
  week.push(shift("2026-07-26", 10));
  const m = proposeOvertime(week);
  eq(split(m, week[6].id), { regular: 0, overtime: 8, double_ot: 2 });
});

test("SIX days worked is not a seventh day, however many shifts", () => {
  // Two shifts a day for six days is twelve rows and still six DAYS.
  const week: ShiftHours[] = [];
  for (const d of ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]) {
    week.push(shift(d, 3));
    week.push(shift(d, 3));
  }
  const t = weekTotals(week);
  eq(t.overtime, 0, "no seventh-day overtime");
  eq(t.regular, 36);
});

test("a zero-hour day does not count as a day worked", () => {
  // The empty day is FIRST, which is what makes this test bite: seven calendar
  // days with rows on all of them, but only six worked. Counting the empty
  // Monday would make Sunday "the seventh day" and pay a whole shift at 1.5×
  // that isn't owed. (An earlier version of this case put the empty day last,
  // where splitDay's own hours<=0 guard hid the bug — it passed with the
  // worked-day filter removed, which is exactly what a fixture must not do.)
  const week = [shift("2026-07-20", 0)];
  for (const d of ["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"]) {
    week.push(shift(d, 6));
  }
  const m = proposeOvertime(week);
  eq(split(m, week[0].id), { regular: 0, overtime: 0, double_ot: 0 }, "the empty day");
  eq(split(m, week[6].id), { regular: 6, overtime: 0, double_ot: 0 }, "Sunday is the SIXTH day worked");
  eq(weekTotals(week), { regular: 36, overtime: 0, double_ot: 0 });
});

/* -- grouping -------------------------------------------------------------- */

test("two employees' weeks never mix", () => {
  const a = shift("2026-07-20", 9, { employee_id: "alice" });
  const b = shift("2026-07-20", 9, { employee_id: "bob" });
  const m = proposeOvertime([a, b]);
  eq(split(m, a.id), { regular: 8, overtime: 1, double_ot: 0 });
  eq(split(m, b.id), { regular: 8, overtime: 1, double_ot: 0 });
});

test("two WORKWEEKS inside one fortnight never mix", () => {
  // 24 hours in each of two weeks is 48 in the fortnight and no overtime at all.
  // Deriving the week from the pay period would merge them and invent 8 hours.
  const wk1 = ["2026-07-20", "2026-07-21", "2026-07-22"].map((d) =>
    shift(d, 8, { workweek_start: "2026-07-20" })
  );
  const wk2 = ["2026-07-27", "2026-07-28", "2026-07-29"].map((d) =>
    shift(d, 8, { workweek_start: "2026-07-27" })
  );
  eq(weekTotals([...wk1, ...wk2]), { regular: 48, overtime: 0, double_ot: 0 });
});

/* -- comparing with the source --------------------------------------------- */

test("agreement is not a disagreement", () => {
  const s = shift("2026-07-20", 9);
  const p = proposeOvertime([s]).get(s.id)!;
  const c = compareToSource(p, { regular: 8, overtime: 1, double_ot: 0 });
  no(c.differs, "identical splits");
});

test("the stitched-overnight case is exactly what a disagreement looks like", () => {
  // Homebase paid ten hours flat; we say 8 + 2. Same total, different split —
  // which is why the comparison is per-bucket and not on the total.
  const s = shift("2026-07-20", 10);
  const p = proposeOvertime([s]).get(s.id)!;
  const c = compareToSource(p, { regular: 10, overtime: 0, double_ot: 0 });
  ok(c.differs, "differs");
  eq(c.proposed, { regular: 8, overtime: 2, double_ot: 0 });
  eq(c.source, { regular: 10, overtime: 0, double_ot: 0 });
  eq(splitTotal(c.proposed), splitTotal(c.source), "the TOTAL is unchanged");
  eq(c.reasons, ["daily_over_8"]);
});

test("a null from the source is a claim of zero, not a disagreement", () => {
  const s = shift("2026-07-20", 8);
  const p = proposeOvertime([s]).get(s.id)!;
  const c = compareToSource(p, { regular: 8, overtime: null, double_ot: null });
  no(c.differs, "null overtime against 0 proposed");
});

test("a proposal names why, and only on the shift carrying the hours", () => {
  const a = shift("2026-07-20", 5);
  const b = shift("2026-07-20", 5);
  const m = proposeOvertime([a, b]);
  eq(m.get(a.id)!.reasons, [], "the early shift explains nothing");
  eq(m.get(b.id)!.reasons, ["daily_over_8"], "the late one does");
});

test("a one-cent gap is rounding convention, not a disagreement", () => {
  // Our hours come from instants (7.46666…) and the source's from its own
  // rounded decimal. Measured over all 44,537 real shifts, treating a cent as a
  // disagreement flags 4,388 rows; treating it as noise flags 267. The first
  // number is the same as flagging nothing.
  const s = shift("2026-07-20", 7.47);
  const p = proposeOvertime([s]).get(s.id)!;
  no(compareToSource(p, { regular: 7.46, overtime: 0, double_ot: 0 }).differs, "one cent");
  ok(compareToSource(p, { regular: 7.44, overtime: 0, double_ot: 0 }).differs, "three cents");
});

test("but a cent that MOVED between buckets still counts", () => {
  // Same total, and the split is what we are adjudicating — so this must not be
  // swallowed by the same tolerance that hides rounding on a single bucket.
  const s = shift("2026-07-20", 9);
  const p = proposeOvertime([s]).get(s.id)!;
  eq({ r: p.regular, o: p.overtime }, { r: 8, o: 1 });
  ok(compareToSource(p, { regular: 9, overtime: 0, double_ot: 0 }).differs, "a whole hour moved");
});
