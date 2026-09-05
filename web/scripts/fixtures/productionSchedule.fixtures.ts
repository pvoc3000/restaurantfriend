// The night's paperwork — production brief decision 5.
//
// Every number asserted here was MEASURED off the real 2026-08-07 DF02 packet
// (`DF Operations Screenshots/desktop/Production/`), so a case that goes red is
// a claim about paper somebody printed, not about a preference.

import {
  tallyBoxes,
  trayRuler,
  rollUp,
  elementDemand,
  packetDate,
  totalDonuts,
  TALLY_BOXES,
  TRAY_CELLS,
  type ScheduleLine,
  type ItemDemandSource,
} from "../../src/lib/productionSchedule";
import type { CostElement } from "../../src/lib/productionCost";
import { test, eq } from "./harness";

let seq = 0;
function line(over: Partial<ScheduleLine> = {}): ScheduleLine {
  seq += 1;
  return {
    id: `l${seq}`,
    item_id: over.item_id ?? `i${seq}`,
    item_name: "Bananaversary",
    item_type: "Cake",
    subtype: "Banana",
    finish: "Plain",
    size: "Regular",
    tally_box_size: 6,
    tray_capacity: 24,
    tray_number: "01",
    par: 15,
    made: null,
    leftover: null,
    ...over,
  };
}

/* -- the counting strip ---------------------------------------------------- */

test("the tally strip is a fixed 24 boxes whatever the par", () => {
  eq(tallyBoxes(15, 6).boxes, TALLY_BOXES, "par 15");
  eq(tallyBoxes(18, 6).boxes, TALLY_BOXES, "par 18");
  eq(tallyBoxes(0, 6).boxes, TALLY_BOXES, "par 0");
});

test("boxes fill by FLOOR, which is what the real packet shows", () => {
  // Bananaversary par 15 shades TWO boxes on the 8/7 sheet, not three.
  eq(tallyBoxes(15, 6).filled, 2, "15 at 6");
  eq(tallyBoxes(18, 6).filled, 3, "18 at 6");
  eq(tallyBoxes(9, 6).filled, 1, "9 at 6");
  eq(tallyBoxes(24, 6).filled, 4, "24 at 6");
  eq(tallyBoxes(20, 6).filled, 3, "FSF-Apple, par 20 at 6");
  eq(tallyBoxes(6, 6).filled, 1, "6 at 6");
});

test("the per-item box size is honoured, not the constant 6", () => {
  // Mark, 2026-08-07: "It's always 6, but… the ability to set the chunk size
  // for each item". A 12 must halve the shading, or the column is decoration.
  eq(tallyBoxes(24, 12).filled, 2, "24 at 12");
  eq(tallyBoxes(15, 12).filled, 1, "15 at 12");
});

test("a nonsense box size falls back to 6 rather than dividing by zero", () => {
  eq(tallyBoxes(12, 0).filled, 2, "box size 0");
  eq(tallyBoxes(12, -3).filled, 2, "negative box size");
});

test("a par past the strip never overflows it", () => {
  eq(tallyBoxes(10000, 6).filled, TALLY_BOXES, "huge par");
});

/* -- the tray ruler -------------------------------------------------------- */

test("a line's own tray capacity beats the default", () => {
  // Measured against FileMaker's real 8/7 guide: it trays fritters 16 · 4
  // rather than as a single 20, which is why capacity is a COLUMN. A constant
  // 24 prints a tray the kitchen will not fill.
  eq(trayRuler(20, 16), [16, 4], "fritters at 16");
  eq(trayRuler(20), [20], "the same run at the default 24");
});

test("a run takes the SMALLEST capacity among its lines", () => {
  const rolled = rollUp(
    [
      line({ item_type: "Scrap", subtype: "Fritter", tray_capacity: 16, par: 12 }),
      line({ item_type: "Scrap", subtype: "Fritter", tray_capacity: 24, par: 8 }),
    ],
    "subtype"
  );
  // A ruler drawn against the larger one would show fewer trays than the
  // kitchen actually fills.
  eq(rolled[0].sizes[0].subtypes[0].rows[0].trayCapacity, 16, "capacity");
});

test("the tray ruler fills whole trays then the remainder", () => {
  // Bismark 60 reads 24 · 24 · 12 on the real baker guide.
  eq(trayRuler(60), [24, 24, 12], "60 bismarks");
  eq(trayRuler(54), [24, 24, 6], "vanilla 54");
  eq(trayRuler(15), [15], "banana 15");
  eq(trayRuler(0), [], "nothing to cut");
});

test("the tray ruler is NOT the counting strip", () => {
  // Answered question 3 says so outright: reproducing one from the other's rule
  // would be wrong. 15 is ONE tray of 15, but TWO tally boxes of 6.
  eq(trayRuler(15).length, 1, "trays");
  eq(tallyBoxes(15, 6).filled, 2, "boxes");
});

test("the ruler stops at 25 cells rather than running off the page", () => {
  eq(trayRuler(10000).length, TRAY_CELLS, "cells");
});

/* -- the roll-up ----------------------------------------------------------- */

const CAKE_LINES = [
  line({ item_name: "Bananaversary", subtype: "Banana", par: 15 }),
  line({ item_name: "Angry Samoa", subtype: "Vanilla", par: 18 }),
  line({ item_name: "Caramel on Parade", subtype: "Vanilla", par: 12 }),
  line({ item_name: "Rites of Sprinkles - Cake/Choc", subtype: "Vanilla", par: 12 }),
  line({ item_name: "Rites of Sprinkles - Cake/Van", subtype: "Vanilla", par: 12 }),
];

test("the roll-up totals every level, matching the printed sheet", () => {
  const rolled = rollUp(CAKE_LINES, "item");
  eq(rolled.length, 1, "one type");
  eq(rolled[0].itemType, "Cake");
  eq(rolled[0].total, 69, "CAKE 69");
  eq(rolled[0].sizes[0].total, 69, "REGULAR CAKE TOTAL: 69");
  const subs = rolled[0].sizes[0].subtypes;
  eq(subs.map((s) => [s.subtype, s.total]), [["Banana", 15], ["Vanilla", 54]],
    "BANANA TOTAL: 15 / VANILLA TOTAL: 54");
});

test("everything sorts alphabetically, all the way down", () => {
  const rolled = rollUp(
    [
      line({ item_type: "Scrap", subtype: "Swirl", item_name: "Jimmy Eat Swirl" }),
      line({ item_type: "Cake", subtype: "Vanilla", item_name: "Zebra" }),
      line({ item_type: "Cake", subtype: "Vanilla", item_name: "Angry Samoa" }),
      line({ item_type: "Mochi", subtype: "Krinkle", item_name: "Mochi - Green Tea" }),
    ],
    "item"
  );
  eq(rolled.map((t) => t.itemType), ["Cake", "Mochi", "Scrap"], "types");
  eq(rolled[0].sizes[0].subtypes[0].rows.map((r) => r.label), ["Angry Samoa", "Zebra"], "items");
});

test("the three grains are three different cuts of one night", () => {
  const lines = [
    line({ subtype: "Promise Ring", finish: "Chocolate Glaze", item_name: "Old Fashioned - Chocolate", par: 9 }),
    line({ subtype: "Promise Ring", finish: "Maple Glaze", item_name: "Old Fashioned - Maple", par: 9 }),
    line({ subtype: "Promise Ring", finish: "Plain", item_name: "Old Fashioned - No Glaze", par: 6 }),
    line({ subtype: "Promise Ring", finish: "Vanilla Glaze", item_name: "Old Fashioned - Vanilla", par: 9 }),
  ];
  // Baker: one row, because it is all one cut.
  eq(rollUp(lines, "subtype")[0].sizes[0].subtypes[0].rows.length, 1, "baker rows");
  // Fryer: four, one per finish.
  eq(rollUp(lines, "finish")[0].sizes[0].subtypes[0].rows.map((r) => r.label),
    ["Chocolate Glaze", "Maple Glaze", "Plain", "Vanilla Glaze"], "fryer rows");
  // Decorator: four named donuts, which here happen to be the same four.
  eq(rollUp(lines, "item")[0].sizes[0].subtypes[0].rows.length, 4, "decorator rows");
  // And every cut totals the same night.
  for (const g of ["subtype", "finish", "item"] as const) {
    eq(rollUp(lines, g)[0].total, 33, `${g} total`);
  }
});

test("decorator rows read by NAME under a cut, whatever the finish says", () => {
  // Mark, 2026-09-04: the plan lists a day's donuts by name, and the guides
  // follow. By finish these would read Mango (Glaze) · Strawberry (Sugar) ·
  // Mixed Berry (Vanilla); by name Mango · Mixed Berry · Strawberry.
  const lines = [
    line({ subtype: "Mochi", finish: "Sugar", item_name: "Mochi - Strawberry", par: 24 }),
    line({ subtype: "Mochi", finish: "Vanilla", item_name: "Mochi - Mixed Berry", par: 12 }),
    line({ subtype: "Mochi", finish: "Glaze", item_name: "Mochi - Mango", par: 6 }),
  ];
  eq(
    rollUp(lines, "item")[0].sizes[0].subtypes[0].rows.map((r) => r.label),
    ["Mochi - Mango", "Mochi - Mixed Berry", "Mochi - Strawberry"]
  );
});

test("two items sharing a name are two rows, not one", () => {
  // 038: "Angry Samoa" is four different donuts. Merging them at item grain
  // would under-report the decorator's night.
  const rolled = rollUp(
    [
      line({ item_id: "a", item_name: "Angry Samoa", size: "Regular", par: 18 }),
      line({ item_id: "b", item_name: "Angry Samoa", size: "Mini", par: 12 }),
    ],
    "item"
  );
  eq(rolled[0].total, 30, "type total");
  eq(rolled[0].sizes.map((s) => s.size), ["Mini", "Regular"], "two size bands");
});

test("an item with no type is its own group and is never dropped", () => {
  // The real packet prints an empty `()` block holding one donut. That is a
  // catalog gap you want on the page, not a row to hide.
  const rolled = rollUp([line({ item_type: null, subtype: null, par: 1 })], "item");
  eq(rolled.length, 1, "groups");
  eq(rolled[0].itemType, "", "unnamed");
  eq(rolled[0].total, 1, "still counted");
  eq(totalDonuts([line({ item_type: null, par: 1 })]), 1, "and in the header count");
});

const near = (a: number | null, b: number, what: string) => {
  if (a === null || Math.abs(a - b) > 0.005) throw new Error(`${what}: expected ~${b}, got ${a}`);
};

/* -- element demand -------------------------------------------------------- */

const RAISED = "el-raised";
const GLAZE = "el-glaze";

/**
 * The dough carries a MASTER VERSION now, because how many a batch makes is the
 * recipe's own Expected Yield row rather than a `portion_of_batch` beside it
 * (Mark, 2026-08-13). A dough with no recipe can no longer state a run in
 * batches — which is a real new failure mode, pinned below.
 */
function graph(): Map<string, CostElement> {
  return new Map<string, CostElement>([
    [RAISED, {
      id: RAISED, name: "Raised Dough", kind: "made", manual_cost: null, manual_cost_unit: null,
      master: {
        id: "v-raised",
        lines: [{ id: "y", label: "Expected Yield", qty: 340, unit: "ea", element_id: null }],
      },
    }],
    [GLAZE, { id: GLAZE, name: "BOH Glaze", kind: "made", manual_cost: null, manual_cost_unit: null }],
  ]);
}

function items(): Map<string, ItemDemandSource> {
  return new Map<string, ItemDemandSource>([
    // The base is an ORDINARY EDGE now — 1 ea of the dough — because
    // `production_items.base_element_id` is gone (Mark, 2026-08-13:
    // "components live in the component list only").
    ["king", {
      id: "king",
      elements: [
        { id: "b1", label: null, qty: 1, unit: "ea", element_id: RAISED },
        { id: "e1", label: null, qty: 0.5, unit: "oz", element_id: GLAZE },
      ],
    }],
    ["panda", {
      id: "panda",
      elements: [
        { id: "b2", label: null, qty: 1, unit: "ea", element_id: RAISED },
        { id: "e2", label: null, qty: 0.25, unit: "oz", element_id: GLAZE },
      ],
    }],
  ]);
}

test("dough demand accumulates across every item that shares it", () => {
  const demand = elementDemand([line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 }),
     line({ item_id: "panda", item_type: "Raised", subtype: "Promise Ring", par: 156 })], items(), graph());
  const dough = demand.find((d) => d.elementId === RAISED)!;
  near(dough.batches, 216 / 340, "one dough for two cuts");
  eq(dough.name, "Raised Dough");
});

test("BATCHES ARE DERIVED, and for any made element rather than a dough", () => {
  // There is only one batch figure in the app now. The premade schedule stopped
  // stating one when `base_element_id` went (there is no longer a component the
  // run is "of"), so the element sheet is the single answer — and because it
  // divides a quantity by the element's own yield it works for a glaze as well
  // as a dough, which the old dough-only shape could not say at all.
  const demand = elementDemand(
    [line({ item_id: "king", par: 60 }), line({ item_id: "panda", par: 156 })],
    items(), graph()
  );
  const dough = demand.find((d) => d.elementId === RAISED)!;
  // 216 units of dough over a batch of 340.
  near(dough.batches, 216 / 340, "dough batches");
  near(dough.quantity, 216, "and the raw quantity is still there");
});

test("an element with NO recipe states a quantity but no batches", () => {
  const bare = graph();
  bare.set(RAISED, { ...bare.get(RAISED)!, master: null });
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 })],
    items(), bare
  );
  const dough = demand.find((d) => d.elementId === RAISED)!;
  eq(dough.batches, null, "never a confident zero");
  near(dough.quantity, 60, "the quantity is still known");
});

test("component demand is the edge quantity times the par", () => {
  const demand = elementDemand([line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 }),
     line({ item_id: "panda", item_type: "Raised", subtype: "Promise Ring", par: 156 })], items(), graph());
  const glaze = demand.find((d) => d.elementId === GLAZE)!;
  near(glaze.quantity, 60 * 0.5 + 156 * 0.25, "glaze");
  eq(glaze.unit, "oz");
});

test("an edge with no quantity is a NAMED hole, not a zero", () => {
  const map = items();
  map.set("king", { ...map.get("king")!, elements: [{ id: "e1", label: null, qty: null, unit: "oz", element_id: GLAZE }] });
  const demand = elementDemand([line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 })], map, graph());
  const glaze = demand.find((d) => d.elementId === GLAZE)!;
  eq(glaze.quantity, null, "nothing counted");
  eq(glaze.unresolved.map((u) => u.reason), ["no quantity"], "and reported");
});

test("a line with no par contributes nothing at all", () => {
  const demand = elementDemand([line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 0 })], items(), graph());
  eq(demand.length, 0, "no demand from a zero line");
});

test("an unknown element still gets a bucket rather than vanishing", () => {
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 })],
    items(), new Map()
  );
  eq(demand.map((d) => d.name).sort(), ["(unknown element)", "(unknown element)"], "named, not dropped");
});

/* -- the header date ------------------------------------------------------- */

test("the packet date is read from the ISO STRING, never through new Date()", () => {
  // `new Date("2026-08-07")` is UTC midnight, which is 8/6 in Los Angeles —
  // the trap `lib/productionPlans` documents for plan ranges, and a packet
  // headed the wrong day is a kitchen making Thursday's menu on Friday.
  eq(packetDate("2026-08-07"), "FRI 8/7/2026");
  eq(packetDate("2026-01-01"), "THU 1/1/2026");
  eq(packetDate("2026-08-09"), "SUN 8/9/2026");
});

test("a date it cannot read is passed through rather than guessed", () => {
  eq(packetDate(""), "");
  eq(packetDate("not a date"), "not a date");
});
