// scheduleSourceLabel / plansInForce — what the schedules list's From column
// says, and what the record's own sentence says under the title.
//
// "Plan" was true of every plan schedule and so distinguished none of them
// (Mark, 2026-08-27). The label names the plan instead — and because it is
// DERIVED rather than snapshotted, the matching rule has to mirror
// `production_day`'s own: active, this selling shop, this KITCHEN, and the date
// inside the plan's range.
//
// The cases below were each checked by breaking the code: drop the kitchen test
// and a shop running two kitchens names the wrong plan; use `new Date` for the
// range and the boundary days move west of Greenwich; forget that several plans
// can be in force and a seasonal menu overlapping the everyday one silently
// names only one of them.

import {
  plansInForce,
  scheduleSourceLabel,
  type SchedulePlan,
  type ScheduleOrigin,
} from "../../src/lib/productionSchedule";
import { eq, test } from "./harness";

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function plan(over: Partial<SchedulePlan> = {}): SchedulePlan {
  return {
    id: "plan-1",
    title: "SUMMER 2026 (DF01)",
    location_id: DF01,
    kitchen_location_id: DF01,
    is_active: true,
    starts_on: "2026-08-08",
    ends_on: null,
    ...over,
  };
}

function schedule(over: Partial<ScheduleOrigin> = {}): ScheduleOrigin {
  return {
    source: "plan",
    title: null,
    schedule_date: "2026-08-28",
    location_id: DF01,
    kitchen_location_id: DF01,
    ...over,
  };
}

/* ==========================================================================
 * The label
 * ========================================================================== */

test("scheduleSourceLabel: a plan schedule names its plan", () => {
  eq(scheduleSourceLabel(schedule(), [plan()]), "SUMMER 2026 (DF01)", "label");
});

test("scheduleSourceLabel: no plan in force still says something", () => {
  // A schedule generated before a plan was retired, or at a shop whose plan has
  // been replaced. "Plan" is what it always said and is still true.
  eq(scheduleSourceLabel(schedule(), []), "Plan", "none");
  eq(scheduleSourceLabel(schedule(), [plan({ is_active: false })]), "Plan", "inactive");
});

test("scheduleSourceLabel: two plans are both named, three are counted", () => {
  const a = plan({ id: "a", title: "EVERYDAY" });
  const b = plan({ id: "b", title: "SUMMER" });
  const c = plan({ id: "c", title: "HOLIDAY" });
  eq(scheduleSourceLabel(schedule(), [a, b]), "EVERYDAY + SUMMER", "two");
  // Past a pair the cell would be a paragraph; the full list rides in `title`.
  eq(scheduleSourceLabel(schedule(), [a, b, c]), "EVERYDAY + 2 more", "three");
});

test("scheduleSourceLabel: the other two sources are unchanged", () => {
  eq(
    scheduleSourceLabel(schedule({ source: "special_order", title: "#9885 · Fay wedding" }), []),
    "#9885 · Fay wedding",
    "special order"
  );
  eq(scheduleSourceLabel(schedule({ source: "special_order" }), []), "Special order", "untitled");
  eq(scheduleSourceLabel(schedule({ source: "manual" }), []), "By hand", "manual");
  eq(scheduleSourceLabel(schedule({ source: "manual", title: "Tasting" }), []), "Tasting", "titled");
});

test("scheduleSourceLabel: a special order never consults the plans", () => {
  // Its title IS the answer, and a plan that happens to be in force that day
  // must not leak into a row that has nothing to do with it.
  eq(
    scheduleSourceLabel(schedule({ source: "special_order", title: "#7769" }), [plan()]),
    "#7769",
    "unaffected"
  );
});

/* ==========================================================================
 * Which plans are in force
 * ========================================================================== */

test("plansInForce: the SELLING shop has to match", () => {
  eq(plansInForce(schedule(), [plan({ location_id: DF02 })]).length, 0, "other shop");
});

test("plansInForce: the KITCHEN has to match too", () => {
  // A shop running two plans into two kitchens produces two schedules, and each
  // is fed by one of them. Without this test the DF02-kitchen plan would put
  // its name on the DF01-kitchen night.
  const toDF02 = plan({ id: "b", title: "OVERNIGHT", kitchen_location_id: DF02 });
  eq(plansInForce(schedule(), [plan(), toDF02]).map((p) => p.title), ["SUMMER 2026 (DF01)"], "one");
  eq(
    plansInForce(schedule({ kitchen_location_id: DF02 }), [plan(), toDF02]).map((p) => p.title),
    ["OVERNIGHT"],
    "the other"
  );
});

test("plansInForce: a plan with NO kitchen falls back to its selling shop", () => {
  // 039 leaves it nullable — "a plan can be written before anyone has decided
  // which kitchen takes it" — and decision 9 reads that as the selling shop.
  const undecided = plan({ kitchen_location_id: null });
  eq(plansInForce(schedule(), [undecided]).length, 1, "matches its own shop");
  eq(plansInForce(schedule({ kitchen_location_id: DF02 }), [undecided]).length, 0, "not another");
});

test("plansInForce: the date range includes BOTH its ends", () => {
  const bounded = plan({ starts_on: "2026-08-08", ends_on: "2026-08-28" });
  eq(plansInForce(schedule({ schedule_date: "2026-08-08" }), [bounded]).length, 1, "first day");
  eq(plansInForce(schedule({ schedule_date: "2026-08-28" }), [bounded]).length, 1, "last day");
  eq(plansInForce(schedule({ schedule_date: "2026-08-07" }), [bounded]).length, 0, "day before");
  eq(plansInForce(schedule({ schedule_date: "2026-08-29" }), [bounded]).length, 0, "day after");
});

test("plansInForce: an open-ended plan runs forever forward", () => {
  eq(plansInForce(schedule({ schedule_date: "2030-01-01" }), [plan()]).length, 1, "still on");
});
