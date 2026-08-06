// lib/payrollBenefits — what a shift earns beyond its wages.
//
// The names and numbers here are the real ones out of the FileMaker export,
// because a case you can check against the source reads better than a case you
// can only check against itself. Angelica Castellanos really did work 359 DF01
// shifts without earning a cent of commuter benefit, and Eddy Salazar really
// did work two shifts on 2026-07-26.

import { test, eq, ok, no } from "./harness";
import {
  benefitAmount,
  computeAccruals,
  earningsByEmployee,
  entitlementOn,
  explainShift,
  isAccruableShift,
  mergeFrozen,
  totalByEmployee,
  type AccrualContext,
  type BenefitEntitlement,
  type BenefitShift,
  type BenefitUnit,
  type PayrollBenefit,
} from "../../src/lib/payrollBenefits";

/* -- factories ------------------------------------------------------------- */

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function benefit(over: Partial<PayrollBenefit> = {}): PayrollBenefit {
  return {
    id: "ben-commuter",
    code: "commuter",
    name: "Commuter benefit",
    gusto_column: "custom_earning_commuter_benefit",
    unit: "per_shift",
    default_amount: 12,
    is_active: true,
    ...over,
  };
}

let entSeq = 0;
function entitlement(over: Partial<BenefitEntitlement> = {}): BenefitEntitlement {
  entSeq += 1;
  return {
    id: `ent-${entSeq}`,
    employee_id: "emp-1",
    benefit_id: "ben-commuter",
    location_id: DF02,
    amount: null,
    starts_on: null,
    ends_on: null,
    ...over,
  };
}

let shiftSeq = 0;
/** A worked shift. `at` is the clock-in time on that workday. */
function shift(workday: string, at = "09:00", over: Partial<BenefitShift> = {}): BenefitShift {
  shiftSeq += 1;
  return {
    id: `ts-${String(shiftSeq).padStart(3, "0")}`,
    employee_id: "emp-1",
    location_id: DF02,
    workday,
    clock_in: `${workday}T${at}:00Z`,
    clock_out: `${workday}T17:00:00Z`,
    ...over,
  };
}

const dollars = (rows: readonly { amount: number }[]) =>
  Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100;

/* -- per_shift ------------------------------------------------------------- */

test("per_shift pays once for every qualifying shift", () => {
  const a = computeAccruals(
    [shift("2026-07-21"), shift("2026-07-22"), shift("2026-07-23")],
    [benefit()],
    [entitlement()]
  );
  eq(a.length, 3, "accruals");
  eq(dollars(a), 36, "dollars");
});

/* -- per_workday: the cap, and WHICH shift carries it ---------------------- */

test("per_workday pays once a day, on the shift that started first", () => {
  // Eddy Salazar, 2026-07-26: 7.20h from 12:18am and 9.50h from 10:10pm.
  //
  // NOTE THE ORDER THESE ARE BUILT IN. The late shift is made first so it gets
  // the LOWER id, which makes id order and time order disagree — without that
  // this case passes just as happily against a cap that picks by uuid, which is
  // the 2026-08-05 pour-over bug exactly.
  const late = shift("2026-07-26", "22:10");
  const early = shift("2026-07-26", "00:18");
  ok(late.id < early.id, "the late shift must sort FIRST by id for this case to bite");
  const a = computeAccruals([late, early], [benefit({ unit: "per_workday" })], [entitlement()]);
  eq(a.length, 1, "one accrual for the day");
  eq(a[0].timesheet_id, early.id, "carried by the 12:18am shift");
  eq(dollars(a), 12, "dollars");
});

test("per_workday does not depend on the order the shifts arrive in", () => {
  // The 2026-08-05 pour-over bug, transplanted: PostgREST returns rows in
  // whatever order it likes, so a cap that picks by arrival picks at random.
  const late = shift("2026-07-26", "22:10");
  const early = shift("2026-07-26", "00:18");
  const b = [benefit({ unit: "per_workday" })];
  const e = [entitlement()];
  eq(
    computeAccruals([early, late], b, e),
    computeAccruals([late, early], b, e),
    "same answer either way round"
  );
});

test("per_workday across two shops still pays once, at the first shift's shop", () => {
  // Built late-first again, so id order fights time order.
  const second = shift("2026-07-26", "18:00", { location_id: DF02 });
  const first = shift("2026-07-26", "06:00", { location_id: DF01 });
  const a = computeAccruals(
    [second, first],
    [benefit({ unit: "per_workday" })],
    [entitlement({ location_id: DF01, amount: 8 }), entitlement({ location_id: DF02, amount: 20 })]
  );
  eq(a.length, 1, "one accrual");
  eq(a[0].timesheet_id, first.id, "the earlier shift");
  eq(a[0].amount, 8, "and therefore DF01's amount");
});

/* -- per_period ------------------------------------------------------------ */

test("per_period pays once across everything it is given", () => {
  const days = ["21", "22", "23", "24", "27", "28", "29", "30"].map((d) =>
    shift(`2026-07-${d}`)
  );
  const a = computeAccruals(days, [benefit({ unit: "per_period", default_amount: 50 })], [entitlement()]);
  eq(a.length, 1, "one accrual");
  eq(a[0].timesheet_id, days[0].id, "on the first shift of the period");
  eq(dollars(a), 50, "dollars");
});

test("a cap is per PERSON, not across the whole payload", () => {
  const a = computeAccruals(
    [
      shift("2026-07-26", "09:00", { employee_id: "emp-1" }),
      shift("2026-07-26", "09:00", { employee_id: "emp-2" }),
    ],
    [benefit({ unit: "per_workday" })],
    [entitlement({ employee_id: "emp-1" }), entitlement({ employee_id: "emp-2" })]
  );
  eq(a.length, 2, "one each");
});

/* -- date effectiveness ---------------------------------------------------- */

test("both ends of the effective range are INCLUSIVE", () => {
  const e = [entitlement({ starts_on: "2026-07-20", ends_on: "2026-08-02" })];
  const b = [benefit()];
  no(computeAccruals([shift("2026-07-19")], b, e).length, "the day before");
  eq(computeAccruals([shift("2026-07-20")], b, e).length, 1, "the first day");
  eq(computeAccruals([shift("2026-08-02")], b, e).length, 1, "the last day");
  no(computeAccruals([shift("2026-08-03")], b, e).length, "the day after");
});

test("a null bound is unbounded, in either direction", () => {
  const b = [benefit()];
  eq(
    computeAccruals([shift("2019-01-01")], b, [entitlement({ ends_on: "2026-12-31" })]).length,
    1,
    "no start"
  );
  eq(
    computeAccruals([shift("2099-01-01")], b, [entitlement({ starts_on: "2026-01-01" })]).length,
    1,
    "no end"
  );
});

test("effectiveness is judged on the WORKDAY, not the clock-out", () => {
  // An overnight shift on the last day of a period clocks out inside the next
  // one. Its hours belong to the earlier period and so does its benefit.
  const overnight: BenefitShift = {
    ...shift("2026-08-02", "22:10"),
    clock_out: "2026-08-03T06:00:00Z",
  };
  const a = computeAccruals(
    [overnight],
    [benefit()],
    [entitlement({ starts_on: "2026-07-20", ends_on: "2026-08-02" })]
  );
  eq(a.length, 1, "accrues");
  eq(a[0].workday, "2026-08-02", "in the earlier period");
});

/* -- what does and does not count as a worked shift ------------------------ */

test("a row with no punches earns nothing", () => {
  // 028's `adjustment` kind — a sick day, holiday pay. You didn't commute to it.
  const adjustment = shift("2026-07-21");
  adjustment.clock_in = null;
  adjustment.clock_out = null;
  no(isAccruableShift(adjustment), "not accruable");
  eq(computeAccruals([adjustment], [benefit()], [entitlement()]).length, 0);
});

test("a shift clocked in but never out earns nothing", () => {
  const open = shift("2026-07-21");
  open.clock_out = null;
  eq(computeAccruals([open], [benefit()], [entitlement()]).length, 0);
});

test("a very short shift earns the FULL benefit", () => {
  // Punch-based, not hours-based, and this is the case that pins it: a flat
  // allowance pays for showing up. Measured — FileMaker stamped 3 of 6,249
  // zero-hour rows and essentially every worked one.
  const quick: BenefitShift = { ...shift("2026-07-21", "09:00"), clock_out: "2026-07-21T09:15:00Z" };
  const a = computeAccruals([quick], [benefit()], [entitlement()]);
  eq(dollars(a), 12, "the whole $12 for fifteen minutes");
});

test("a shift with no shop earns nothing, and does not throw", () => {
  const nowhere = shift("2026-07-21", "09:00", { location_id: null });
  eq(computeAccruals([nowhere], [benefit()], [entitlement()]).length, 0);
});

/* -- the shop is the rule -------------------------------------------------- */

test("Angelica Castellanos: entitled at DF02, so 359 DF01 shifts earn nothing", () => {
  const df01 = Array.from({ length: 359 }, (_, i) =>
    shift(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, "09:00", { location_id: DF01 })
  );
  const df02 = Array.from({ length: 4 }, () => shift("2026-07-21", "09:00", { location_id: DF02 }));
  const a = computeAccruals([...df01, ...df02], [benefit()], [entitlement({ location_id: DF02 })]);
  eq(a.length, 4, "exactly the four DF02 shifts");
  eq(dollars(a), 48, "dollars");
});

/* -- the amount cascade ---------------------------------------------------- */

test("the amount is the entitlement's, else the benefit's default", () => {
  eq(benefitAmount(benefit({ default_amount: 12 }), entitlement({ amount: null })), 12, "default");
  eq(benefitAmount(benefit({ default_amount: 12 }), entitlement({ amount: 20 })), 20, "override");
  eq(benefitAmount(benefit({ default_amount: null }), entitlement({ amount: null })), 0, "neither");
});

test("an entitlement worth nothing produces no row at all", () => {
  // Not a $0 line — an empty row in front of somebody implies a decision that
  // nobody made.
  const a = computeAccruals(
    [shift("2026-07-21")],
    [benefit({ default_amount: null })],
    [entitlement({ amount: null })]
  );
  eq(a.length, 0);
});

test("an inactive benefit accrues nothing", () => {
  eq(computeAccruals([shift("2026-07-21")], [benefit({ is_active: false })], [entitlement()]).length, 0);
});

test("entitlementOn matches on all four keys and the day", () => {
  const ents = [entitlement({ location_id: DF02 })];
  ok(entitlementOn(ents, "emp-1", "ben-commuter", DF02, "2026-07-21"), "the match");
  no(entitlementOn(ents, "emp-2", "ben-commuter", DF02, "2026-07-21"), "wrong person");
  no(entitlementOn(ents, "emp-1", "ben-other", DF02, "2026-07-21"), "wrong benefit");
  no(entitlementOn(ents, "emp-1", "ben-commuter", DF01, "2026-07-21"), "wrong shop");
});

/* -- more than one benefit ------------------------------------------------- */

test("two benefits on one shift both accrue, and split by Gusto column", () => {
  const commuter = benefit();
  const overnight = benefit({
    id: "ben-overnight",
    code: "overnight",
    name: "Overnight differential",
    gusto_column: "custom_earning_distributed_service_charges",
    default_amount: 5,
  });
  const a = computeAccruals(
    [shift("2026-07-21")],
    [commuter, overnight],
    [entitlement(), entitlement({ benefit_id: "ben-overnight" })]
  );
  eq(a.length, 2, "one each");
  eq(earningsByEmployee(a, [commuter, overnight]).get("emp-1"), {
    custom_earning_commuter_benefit: 12,
    custom_earning_distributed_service_charges: 5,
  });
});

test("two benefits pointed at the SAME column sum into it", () => {
  const parking = benefit({ id: "ben-a", code: "parking", default_amount: 12 });
  const transit = benefit({ id: "ben-b", code: "transit", default_amount: 8 });
  const a = computeAccruals(
    [shift("2026-07-21")],
    [parking, transit],
    [entitlement({ benefit_id: "ben-a" }), entitlement({ benefit_id: "ben-b" })]
  );
  eq(earningsByEmployee(a, [parking, transit]).get("emp-1"), {
    custom_earning_commuter_benefit: 20,
  });
});

test("totalByEmployee adds every benefit together, per person", () => {
  const a = computeAccruals(
    [
      shift("2026-07-21", "09:00", { employee_id: "emp-1" }),
      shift("2026-07-22", "09:00", { employee_id: "emp-1" }),
      shift("2026-07-21", "09:00", { employee_id: "emp-2" }),
    ],
    [benefit()],
    [entitlement({ employee_id: "emp-1" }), entitlement({ employee_id: "emp-2" })]
  );
  eq([...totalByEmployee(a).entries()].sort(), [
    ["emp-1", 24],
    ["emp-2", 12],
  ]);
});

/* -- the snapshot ---------------------------------------------------------- */

const ctx = (id: string, workday = "2026-07-21"): ReadonlyMap<string, AccrualContext> =>
  new Map([[id, { employee_id: "emp-1", workday }]]);

test("the frozen figure wins over the recomputed one", () => {
  // Backwards from tips, deliberately: an entitlement can be corrected inside a
  // closed period, so only the snapshot knows what was actually paid.
  const s = shift("2026-07-21");
  const derived = computeAccruals([s], [benefit()], [entitlement()]);
  eq(derived[0].amount, 12, "recomputed");
  const merged = mergeFrozen(
    derived,
    [{ timesheet_id: s.id, benefit_id: "ben-commuter", amount: 10 }],
    ctx(s.id)
  );
  eq(merged.length, 1, "not duplicated");
  eq(merged[0].amount, 10, "the frozen figure");
});

test("a frozen accrual with no derived twin SURVIVES", () => {
  // The entitlement was corrected away after the money went out. The money
  // still went out.
  const merged = mergeFrozen([], [{ timesheet_id: "ts-gone", benefit_id: "ben-commuter", amount: 12 }], ctx("ts-gone"));
  eq(merged.length, 1, "kept");
  eq(merged[0].employee_id, "emp-1", "person recovered from context");
  eq(merged[0].workday, "2026-07-21", "workday recovered from context");
  eq(merged[0].entitlement_id, null, "and it names no entitlement");
});

test("merging an empty snapshot changes nothing", () => {
  const derived = computeAccruals([shift("2026-07-21")], [benefit()], [entitlement()]);
  eq(mergeFrozen(derived, [], new Map()), derived);
});

/* -- explaining a shift ---------------------------------------------------- */

test("a shift at the wrong shop says so, and names the right one", () => {
  const s = shift("2026-07-21", "09:00", { location_id: DF01 });
  const ents = [entitlement({ location_id: DF02 })];
  const notes = explainShift(s, computeAccruals([s], [benefit()], ents), [benefit()], ents);
  eq(notes.length, 1);
  eq(notes[0].state, "not_entitled_here");
  eq(notes[0].state === "not_entitled_here" ? notes[0].locationIds : [], [DF02]);
});

test("the second shift of a per_workday day points at the first", () => {
  const late = shift("2026-07-26", "22:10");
  const early = shift("2026-07-26", "00:18");
  const b = [benefit({ unit: "per_workday" })];
  const ents = [entitlement()];
  const a = computeAccruals([early, late], b, ents);
  const notes = explainShift(late, a, b, ents);
  eq(notes[0].state, "covered_elsewhere");
  eq(notes[0].state === "covered_elsewhere" ? notes[0].timesheet_id : "", early.id);
});

test("a per_workday note points at THIS day's shift, never another day's", () => {
  const monA = shift("2026-07-20", "06:00");
  const tueA = shift("2026-07-21", "06:00");
  const tueB = shift("2026-07-21", "18:00");
  const b = [benefit({ unit: "per_workday" })];
  const ents = [entitlement()];
  const a = computeAccruals([monA, tueA, tueB], b, ents);
  const notes = explainShift(tueB, a, b, ents);
  eq(notes[0].state, "covered_elsewhere");
  eq(notes[0].state === "covered_elsewhere" ? notes[0].timesheet_id : "", tueA.id, "Tuesday's, not Monday's");
});

test("a punchless row says it was not worked", () => {
  const s = shift("2026-07-21");
  s.clock_in = null;
  s.clock_out = null;
  const ents = [entitlement()];
  eq(explainShift(s, [], [benefit()], ents)[0].state, "not_worked");
});

test("a shift that accrued says what it earned", () => {
  const s = shift("2026-07-21");
  const ents = [entitlement()];
  const notes = explainShift(s, computeAccruals([s], [benefit()], ents), [benefit()], ents);
  eq(notes[0].state, "accrued");
  eq(notes[0].state === "accrued" ? notes[0].amount : 0, 12);
});

test("a benefit the person is not entitled to anywhere is not mentioned", () => {
  // The note explains a benefit that nearly applied; it is not a catalogue.
  const s = shift("2026-07-21");
  eq(explainShift(s, [], [benefit()], []).length, 0);
});

/* -- determinism ----------------------------------------------------------- */

test("shuffling the input does not change the answer", () => {
  const shifts = [
    shift("2026-07-21", "06:00"),
    shift("2026-07-21", "18:00"),
    shift("2026-07-22", "06:00", { location_id: DF01 }),
    shift("2026-07-23", "09:00"),
  ];
  const b = [benefit({ unit: "per_workday" })];
  const ents = [entitlement()];
  const forward = computeAccruals(shifts, b, ents);
  const backward = computeAccruals([...shifts].reverse(), b, ents);
  const key = (rows: typeof forward) =>
    rows.map((r) => `${r.timesheet_id}:${r.amount}`).sort();
  eq(key(backward), key(forward));
});

/* -- every unit is reachable ----------------------------------------------- */

test("all three units are handled, and nothing else exists", () => {
  const units: BenefitUnit[] = ["per_shift", "per_workday", "per_period"];
  const shifts = [shift("2026-07-21", "06:00"), shift("2026-07-21", "18:00"), shift("2026-07-22")];
  eq(
    units.map((unit) => computeAccruals(shifts, [benefit({ unit })], [entitlement()]).length),
    [3, 2, 1]
  );
});
