// The night's paperwork — production brief decision 5.
//
// Every number asserted here was MEASURED off the real 2026-08-07 DF02 packet
// (`DF Operations Screenshots/desktop/Production/`), so a case that goes red is
// a claim about paper somebody printed, not about a preference.

import {
  tallyBoxes,
  trayRuler,
  rollUp,
  batchCount,
  formatBatches,
  elementDemand,
  packetDate,
  totalDonuts,
  TALLY_BOXES,
  TRAY_CELLS,
  type ScheduleLine,
  type ItemDemandSource,
} from "../../src/lib/productionSchedule";
import type { BatchYield, CostElement } from "../../src/lib/productionCost";
import { test, eq, ok, no } from "./harness";

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

/* -- batch size ------------------------------------------------------------ */

const YIELDS: BatchYield[] = [
  { item_type: "Cake", subtype: "Banana", size: null, portion_of_batch: 1 / 30, size_factor: 1 },
  { item_type: "Old Fashioned", subtype: "Promise Ring", size: null, portion_of_batch: 1 / 60, size_factor: 1 },
  { item_type: "Scrap", subtype: "Fritter", size: null, portion_of_batch: 1 / 16, size_factor: 1 },
  { item_type: "Raised", subtype: null, size: null, portion_of_batch: 1 / 340, size_factor: 1 },
  { item_type: "Raised", subtype: null, size: "Mini", portion_of_batch: 1 / 340, size_factor: 1 / 3 },
];

const near = (a: number | null, b: number, what: string) => {
  if (a === null || Math.abs(a - b) > 0.005) throw new Error(`${what}: expected ~${b}, got ${a}`);
};

test("batch size reproduces the printed cake figures exactly", () => {
  near(batchCount([line({ subtype: "Banana", par: 15 })], YIELDS).batches, 0.5, "BANANA 15 -> 0.50");
  near(batchCount([line({ item_type: "Old Fashioned", subtype: "Promise Ring", par: 33 })], YIELDS).batches,
    0.55, "OLD FASHIONED 33 -> 0.55");
  near(batchCount([line({ item_type: "Scrap", subtype: "Fritter", par: 20 })], YIELDS).batches,
    1.25, "FRITTER 20 -> 1.25");
});

test("size_factor is applied — a mini is a third of a regular", () => {
  const regular = batchCount([line({ item_type: "Raised", subtype: "Bismark", size: "Regular", par: 30 })], YIELDS);
  const mini = batchCount([line({ item_type: "Raised", subtype: "Bismark", size: "Mini", par: 30 })], YIELDS);
  near(regular.batches, 30 / 340, "regular");
  near(mini.batches, 30 / 340 / 3, "mini");
});

test("an item with NO batch rule contributes nothing AND says so", () => {
  // The phase-2 lesson: a silently-too-small dough figure still looks like a
  // plausible number. Defaulting to zero here is the dangerous failure.
  const mixed = batchCount(
    [line({ subtype: "Banana", par: 15 }), line({ item_type: "Mochi", subtype: "Krinkle", par: 18 })],
    YIELDS
  );
  near(mixed.batches, 0.5, "only the rule we have");
  eq(mixed.unresolved.length, 1, "and the gap is named");
  eq(mixed.unresolved[0].reason, "no batch yield");
  ok(formatBatches(mixed).startsWith("AT LEAST"), "printed as a lower bound");
});

test("no rules at all is null, never 0.00", () => {
  const none = batchCount([line({ item_type: "Mochi", subtype: "Krinkle", par: 18 })], YIELDS);
  eq(none.batches, null, "batches");
  eq(formatBatches(none), "", "prints nothing rather than a confident zero");
});

test("the PDF spells the lower bound out, because Helvetica has no >= glyph", () => {
  // It rendered as a stray "e" on the recipe sheet, which did not merely lose
  // the claim — it replaced it with a typo.
  const partial = batchCount(
    [line({ subtype: "Banana", par: 15 }), line({ item_type: "Mochi", par: 6 })],
    YIELDS
  );
  no(formatBatches(partial).includes("≥"), "no >= in the printed string");
});

test("a type's batch figure is the SUM of its subtypes', not a separate sum", () => {
  // RAISED 0.60 on the real packet is Bismark 0.14 + Promise Ring 0.38 +
  // Bullseye 0.05 + Danish 0.03. Computed twice, the page could disagree with
  // itself; computed as the sum, it cannot.
  const raised = rollUp(
    [
      line({ item_type: "Raised", subtype: "Bismark", size: "Regular", par: 60 }),
      line({ item_type: "Raised", subtype: "Danish", size: "Regular", par: 12 }),
      line({ item_type: "Raised", subtype: "Promise Ring", size: "Regular", par: 156 }),
    ],
    "subtype",
    YIELDS
  );
  const subs = raised[0].sizes[0].subtypes;
  const parts = subs.reduce((n, s) => n + (s.batches.batches ?? 0), 0);
  near(raised[0].batches.batches, parts, "type = sum of subtypes");
  near(raised[0].batches.batches, 228 / 340, "and that is the whole run");
});

/* -- element demand -------------------------------------------------------- */

const RAISED = "el-raised";
const GLAZE = "el-glaze";

function graph(): Map<string, CostElement> {
  return new Map<string, CostElement>([
    [RAISED, { id: RAISED, name: "Raised Dough", kind: "made", manual_cost: null, manual_cost_unit: null }],
    [GLAZE, { id: GLAZE, name: "BOH Glaze", kind: "made", manual_cost: null, manual_cost_unit: null }],
  ]);
}

function items(): Map<string, ItemDemandSource> {
  return new Map<string, ItemDemandSource>([
    ["king", {
      id: "king", item_type: "Raised", subtype: "Bismark", size: "Regular",
      base_element_id: RAISED,
      elements: [{ id: "e1", label: null, qty: 0.5, unit: "oz", element_id: GLAZE }],
    }],
    ["panda", {
      id: "panda", item_type: "Raised", subtype: "Promise Ring", size: "Regular",
      base_element_id: RAISED,
      elements: [{ id: "e2", label: null, qty: 0.25, unit: "oz", element_id: GLAZE }],
    }],
  ]);
}

test("dough demand accumulates across every item that shares it", () => {
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 }),
     line({ item_id: "panda", item_type: "Raised", subtype: "Promise Ring", par: 156 })],
    items(), graph(), YIELDS
  );
  const dough = demand.find((d) => d.elementId === RAISED)!;
  near(dough.batches, 216 / 340, "one dough for two cuts");
  eq(dough.name, "Raised Dough");
});

test("component demand is the edge quantity times the par", () => {
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 }),
     line({ item_id: "panda", item_type: "Raised", subtype: "Promise Ring", par: 156 })],
    items(), graph(), YIELDS
  );
  const glaze = demand.find((d) => d.elementId === GLAZE)!;
  near(glaze.quantity, 60 * 0.5 + 156 * 0.25, "glaze");
  eq(glaze.unit, "oz");
});

test("an edge with no quantity is a NAMED hole, not a zero", () => {
  const map = items();
  map.set("king", { ...map.get("king")!, elements: [{ id: "e1", label: null, qty: null, unit: "oz", element_id: GLAZE }] });
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 })],
    map, graph(), YIELDS
  );
  const glaze = demand.find((d) => d.elementId === GLAZE)!;
  eq(glaze.quantity, null, "nothing counted");
  eq(glaze.unresolved.map((u) => u.reason), ["no quantity"], "and reported");
});

test("a line with no par contributes nothing at all", () => {
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 0 })],
    items(), graph(), YIELDS
  );
  eq(demand.length, 0, "no demand from a zero line");
});

test("an unknown element still gets a bucket rather than vanishing", () => {
  const demand = elementDemand(
    [line({ item_id: "king", item_type: "Raised", subtype: "Bismark", par: 60 })],
    items(), new Map(), YIELDS
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
