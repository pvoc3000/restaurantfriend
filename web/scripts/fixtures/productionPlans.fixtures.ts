// Plans — production brief decision 9.
//
// The weekday arithmetic especially: ISO 1 = Monday everywhere in this schema,
// and off by one silently shifts a whole shop's menu by a day.

import {
  coversDate,
  rangesOverlap,
  overlappingPlans,
  planRange,
  buildMatrix,
  WEEKDAYS,
  type PlanSummary,
} from "../../src/lib/productionPlans";
import { test, eq, ok, no } from "./harness";

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function plan(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "p1", title: "October", location_id: DF02, kitchen_location_id: DF02,
    starts_on: "2026-10-01", ends_on: "2026-10-31", is_active: true, ...over,
  };
}

/* -- dates ----------------------------------------------------------------- */

test("a plan covers its own first and last day", () => {
  const p = plan();
  ok(coversDate(p, "2026-10-01"), "the first day is inside");
  ok(coversDate(p, "2026-10-31"), "the last day is inside");
  no(coversDate(p, "2026-09-30"));
  no(coversDate(p, "2026-11-01"));
});

test("an open-ended plan runs until somebody says otherwise", () => {
  const p = plan({ ends_on: null });
  ok(coversDate(p, "2099-01-01"));
  no(coversDate(p, "2026-09-30"), "but still not before it starts");
});

test("dates compare as STRINGS, never through Date", () => {
  // `new Date("2026-08-07")` is UTC midnight, so west of Greenwich it is the
  // 6th locally — which would shift a plan's first day for everyone here.
  // Comparing the ISO text has no timezone to get wrong.
  const p = plan({ starts_on: "2026-08-07", ends_on: "2026-08-07" });
  ok(coversDate(p, "2026-08-07"), "a one-day plan covers its day");
  no(coversDate(p, "2026-08-06"));
  no(coversDate(p, "2026-08-08"));
});

/* -- overlap is the FEATURE ------------------------------------------------ */

test("ranges that touch at a single day overlap", () => {
  ok(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: "2026-01-10" },
    { starts_on: "2026-01-10", ends_on: "2026-01-20" }
  ));
  no(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: "2026-01-09" },
    { starts_on: "2026-01-10", ends_on: "2026-01-20" }
  ));
});

test("an open-ended plan overlaps everything after it starts", () => {
  ok(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: null },
    { starts_on: "2030-01-01", ends_on: "2030-02-01" }
  ));
});

test("DF01 making DF02's raised while DF02 makes its own cake is TWO overlapping plans", () => {
  // Decision 9's own example, and the thing the schema deliberately permits.
  const plans = [
    plan({ id: "raised", title: "DF02 raised", kitchen_location_id: DF01 }),
    plan({ id: "cake", title: "DF02 cake", kitchen_location_id: DF02 }),
  ];
  const warn = overlappingPlans(plans);
  eq(warn.get("raised"), ["DF02 cake"]);
  eq(warn.get("cake"), ["DF02 raised"]);
});

test("plans at DIFFERENT shops never warn about each other", () => {
  const plans = [
    plan({ id: "a", location_id: DF01 }),
    plan({ id: "b", location_id: DF02 }),
  ];
  eq(overlappingPlans(plans).size, 0);
});

test("an INACTIVE plan neither warns nor is warned about", () => {
  const plans = [
    plan({ id: "a" }),
    plan({ id: "b", title: "old", is_active: false }),
  ];
  eq(overlappingPlans(plans).size, 0);
});

test("planRange says 'from' when a plan has no end", () => {
  eq(planRange({ starts_on: "2018-09-03", ends_on: "2018-11-04" }), "3 Sep 2018 – 4 Nov 2018");
  eq(planRange({ starts_on: "2018-09-03", ends_on: null }), "from 3 Sep 2018");
});

/* -- the matrix ------------------------------------------------------------ */

test("weekday 1 is MONDAY and 7 is Sunday, matching every array in the schema", () => {
  eq(WEEKDAYS[0].iso, 1);
  eq(WEEKDAYS[0].short, "Mon");
  eq(WEEKDAYS[6].iso, 7);
  eq(WEEKDAYS[6].short, "Sun");
});

test("a slot lands in the column its weekday names", () => {
  const names = new Map([["it1", "Bananaversary"]]);
  const m = buildMatrix(
    [{ id: "t1", tray_number: "01", band: "RAISED", sort: 1 }],
    [{ id: "s1", tray_id: "t1", weekday: 6, item_id: "it1" }],
    names
  );
  // Saturday is index 5, not 6 — the off-by-one that would shift a menu.
  eq(m[0].days[5].map((s) => s.name), ["Bananaversary"]);
  eq(m[0].days[6].length, 0, "Sunday is empty");
  eq(m[0].days.length, 7);
});

test("a slot may hold SEVERAL items — half a tray of two things", () => {
  const names = new Map([["a", "Angry Samoa"], ["b", "Bacon 182"]]);
  const m = buildMatrix(
    [{ id: "t1", tray_number: "01", band: null, sort: 1 }],
    [
      { id: "s1", tray_id: "t1", weekday: 1, item_id: "a" },
      { id: "s2", tray_id: "t1", weekday: 1, item_id: "b" },
    ],
    names
  );
  eq(m[0].days[0].map((s) => s.name).sort(), ["Angry Samoa", "Bacon 182"]);
});

test("trays order by sort, then by their number", () => {
  const m = buildMatrix(
    [
      { id: "c", tray_number: "07", band: null, sort: 3 },
      { id: "a", tray_number: "01", band: null, sort: 1 },
      { id: "b", tray_number: "05", band: null, sort: 2 },
    ],
    [],
    new Map()
  );
  eq(m.map((r) => r.tray.tray_number), ["01", "05", "07"]);
});

test("a tray with nothing on it still renders seven empty days", () => {
  // The empty slot is information — decision 9's combined view is what shows
  // tray 07 empty on Tuesdays.
  const m = buildMatrix([{ id: "t", tray_number: "07", band: null, sort: 1 }], [], new Map());
  eq(m[0].days.length, 7);
  eq(m[0].days.flat().length, 0);
});

test("an item with no name renders an em dash rather than a raw uuid", () => {
  const m = buildMatrix(
    [{ id: "t", tray_number: "01", band: null, sort: 1 }],
    [{ id: "s", tray_id: "t", weekday: 1, item_id: "gone" }],
    new Map()
  );
  eq(m[0].days[0][0].name, "—");
});
