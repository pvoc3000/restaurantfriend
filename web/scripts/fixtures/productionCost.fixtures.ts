// Live cost resolution through the production graph — production brief
// decision 11, the rule that replaces FileMaker's frozen 2022 prices.
//
// Every case here was checked by BREAKING the code it pins: the cycle guard,
// the never-zero rule for an unresolved element, the location-override cascade
// (design rule 6), the cheapest-source rule, and the refusal to convert a
// package unit.

import {
  elementCost,
  versionBatchCost,
  lineCost,
  inventoryUnitCost,
  effectiveVendorPrice,
  formatCost,
  unresolvedSummary,
  type CostElement,
  type CostVendorItem,
} from "../../src/lib/productionCost";
import { test, eq, ok, no } from "./harness";

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function vendorItem(over: Partial<CostVendorItem> = {}): CostVendorItem {
  return {
    id: "vi-1",
    price: 10,
    package_content: 50,     // 50 lbs in the case
    is_active: true,
    vendor_item_location_prices: [],
    ...over,
  };
}

/** A purchased element: 50 lbs for $10 → $0.20/lb. */
function flour(over: Partial<CostElement> = {}): CostElement {
  return {
    id: "el-flour",
    name: "Flour",
    kind: "purchased",
    manual_cost: null,
    manual_cost_unit: null,
    inventory: {
      id: "inv-flour",
      base_unit: "lbs",
      vendor_items: [vendorItem()],
    },
    ...over,
  };
}

const graph = (...els: CostElement[]) => new Map(els.map((e) => [e.id, e]));

/* -- the three kinds ------------------------------------------------------- */

test("purchased element costs price ÷ package content", () => {
  const el = flour();
  const c = elementCost(el, graph(el), DF01);
  eq(c.cost, 0.2, "cost per lb");
  eq(c.unit, "lbs");
  eq(c.unresolved.length, 0);
});

test("manual element costs what it says", () => {
  const el: CostElement = {
    id: "el-labor", name: "Decorating", kind: "manual",
    manual_cost: 0.35, manual_cost_unit: "ea",
  };
  const c = elementCost(el, graph(el), DF01);
  eq(c.cost, 0.35);
  eq(c.unit, "ea");
});

test("made element costs its batch ÷ its yield", () => {
  const f = flour();
  const glaze: CostElement = {
    id: "el-glaze", name: "Speedy Glaze", kind: "made",
    manual_cost: null, manual_cost_unit: null,
    master: {
      id: "v-1", yield_amount: 10, yield_unit: "qt",
      lines: [{ id: "l-1", label: "Flour", qty: 20, unit: "lbs", element_id: "el-flour" }],
    },
  };
  // 20 lbs x $0.20 = $4.00 the batch, over 10 qt = $0.40/qt
  const c = elementCost(glaze, graph(f, glaze), DF01);
  eq(c.cost, 0.4, "cost per qt");
  eq(c.unit, "qt");
});

/* -- design rule 6: the location override wins ----------------------------- */

test("a location override beats the catalog price", () => {
  const vi = vendorItem({
    vendor_item_location_prices: [{ location_id: DF01, price: 25 }],
  });
  eq(effectiveVendorPrice(vi, DF01), 25, "at the override's location");
  eq(effectiveVendorPrice(vi, DF02), 10, "at another location");
  eq(effectiveVendorPrice(vi, null), 10, "with no location in hand");
});

test("the override changes the resolved element cost", () => {
  const el = flour({
    inventory: {
      id: "inv-flour", base_unit: "lbs",
      vendor_items: [vendorItem({
        vendor_item_location_prices: [{ location_id: DF01, price: 25 }],
      })],
    },
  });
  eq(elementCost(el, graph(el), DF01).cost, 0.5, "DF01 pays the override");
  eq(elementCost(el, graph(el), DF02).cost, 0.2, "DF02 pays the catalog price");
});

/* -- the cheapest active source ------------------------------------------- */

test("the cheapest priced source wins, and an inactive one never does", () => {
  const item = {
    id: "inv", base_unit: "lbs",
    vendor_items: [
      vendorItem({ id: "a", price: 10, package_content: 50 }),   // $0.20
      vendorItem({ id: "b", price: 12, package_content: 100 }),  // $0.12 — cheapest
      vendorItem({ id: "c", price: 1, package_content: 100, is_active: false }), // $0.01, inactive
    ],
  };
  eq(inventoryUnitCost(item, DF01).cost, 0.12);
});

test("a priced source with no package content cannot answer, and says which", () => {
  const item = {
    id: "inv", base_unit: "lbs",
    vendor_items: [vendorItem({ price: 10, package_content: null })],
  };
  const r = inventoryUnitCost(item, DF01);
  eq(r.cost, null);
  eq(r.reason, "no package content", "priced but unusable is NOT 'no vendor price'");
});

test("no priced source at all reports 'no vendor price'", () => {
  const item = {
    id: "inv", base_unit: "lbs",
    vendor_items: [vendorItem({ price: null })],
  };
  eq(inventoryUnitCost(item, DF01).reason, "no vendor price");
});

/* -- AN UNKNOWN COST IS NEVER ZERO ---------------------------------------- */
//
// The rule the whole module turns on: 155 of the 470 migrated elements resolve
// to nothing, and treating those as free would report a confident, too-low
// number for every recipe containing one.

test("an unpriced ingredient does not silently contribute zero", () => {
  const f = flour();
  const mystery: CostElement = {
    id: "el-x", name: "Amoretti Flavoring", kind: "purchased",
    manual_cost: null, manual_cost_unit: null, inventory: null,
  };
  const version = {
    id: "v", yield_amount: 10, yield_unit: "qt",
    lines: [
      { id: "l1", label: "Flour", qty: 20, unit: "lbs", element_id: "el-flour" },
      { id: "l2", label: "Flavoring", qty: 1, unit: "lbs", element_id: "el-x" },
    ],
  };
  const c = versionBatchCost(version, graph(f, mystery), DF01);
  eq(c.cost, 4, "the money we CAN account for");
  eq(c.unresolved.length, 1, "and the one we cannot");
  eq(c.unresolved[0].name, "Amoretti Flavoring");
  eq(c.unresolved[0].reason, "no inventory item");
  // The whole point: the figure is marked as a lower bound.
  eq(formatCost(c), "≥ $4.00");
  ok(unresolvedSummary(c)?.includes("Amoretti Flavoring"));
});

test("a fully priced batch is NOT marked as a lower bound", () => {
  const f = flour();
  const version = {
    id: "v", yield_amount: 10, yield_unit: "qt",
    lines: [{ id: "l1", label: "Flour", qty: 20, unit: "lbs", element_id: "el-flour" }],
  };
  const c = versionBatchCost(version, graph(f), DF01);
  eq(formatCost(c), "$4.00");
  eq(unresolvedSummary(c), null);
});

/* -- the cycle guard ------------------------------------------------------- */

test("a BOM cycle reports itself instead of recursing forever", () => {
  const a: CostElement = {
    id: "a", name: "Glaze A", kind: "made", manual_cost: null, manual_cost_unit: null,
    master: { id: "va", yield_amount: 1, yield_unit: "qt", lines: [{ id: "la", label: "B", qty: 1, unit: "qt", element_id: "b" }] },
  };
  const b: CostElement = {
    id: "b", name: "Glaze B", kind: "made", manual_cost: null, manual_cost_unit: null,
    master: { id: "vb", yield_amount: 1, yield_unit: "qt", lines: [{ id: "lb", label: "A", qty: 1, unit: "qt", element_id: "a" }] },
  };
  const c = elementCost(a, graph(a, b), DF01);
  eq(c.cost, null);
  ok(c.unresolved.some((u) => u.reason === "cycle"), "the cycle is named");
});

test("an element used twice in one tree is not mistaken for a cycle", () => {
  // `seen` tracks the path being resolved, not everything ever visited. If it
  // were the latter, the second use of Flour here would report a false cycle.
  const f = flour();
  const version = {
    id: "v", yield_amount: 2, yield_unit: "qt",
    lines: [
      { id: "l1", label: "Flour", qty: 10, unit: "lbs", element_id: "el-flour" },
      { id: "l2", label: "More flour", qty: 10, unit: "lbs", element_id: "el-flour" },
    ],
  };
  const c = versionBatchCost(version, graph(f), DF01);
  eq(c.cost, 4, "both lines priced");
  eq(c.unresolved.length, 0, "and no cycle claimed");
});

/* -- units ----------------------------------------------------------------- */

test("a line in grams against an element priced per pound converts", () => {
  const f = flour();                                   // $0.20/lb
  const line = { id: "l", label: "Flour", qty: 453.592, unit: "g", element_id: "el-flour" };
  const c = lineCost(line, graph(f), DF01);
  ok(c.cost !== null && Math.abs(c.cost - 0.2) < 0.001, "453.592 g is one pound");
});

test("a package unit refuses to convert rather than inventing a ratio", () => {
  const el = flour({
    inventory: { id: "inv", base_unit: "CS", vendor_items: [vendorItem({ package_content: 1 })] },
  });
  // The element is priced per CASE; the line asks for pounds. There is no
  // ratio — a case of cups and a case of flour share nothing but the word.
  const line = { id: "l", label: "Flour", qty: 5, unit: "lbs", element_id: "el-flour" };
  const c = lineCost(line, graph(el), DF01);
  eq(c.cost, null);
  eq(c.unresolved[0].reason, "incompatible units");
});

/* -- the shapes FileMaker actually sent over ------------------------------- */

test("a note-shaped line with no element costs nothing and reports nothing", () => {
  // 222 of these came over: "pinch of salt", a line with a label and no link.
  const line = { id: "l", label: "pinch of salt", qty: null, unit: null, element_id: null };
  const c = lineCost(line, graph(), DF01);
  eq(c.cost, null);
  eq(c.unresolved.length, 0, "not an error — simply not a priced ingredient");
});

test("a made element with no master version says 'no recipe'", () => {
  const el: CostElement = {
    id: "e", name: "Bear Claw Filling", kind: "made",
    manual_cost: null, manual_cost_unit: null, master: null,
  };
  eq(elementCost(el, graph(el), DF01).unresolved[0].reason, "no recipe");
});

test("a recipe with no yield still reports its batch cost's gaps", () => {
  const f = flour();
  const el: CostElement = {
    id: "e", name: "Mystery Glaze", kind: "made",
    manual_cost: null, manual_cost_unit: null,
    master: {
      id: "v", yield_amount: null, yield_unit: null,
      lines: [{ id: "l", label: "Flour", qty: 20, unit: "lbs", element_id: "el-flour" }],
    },
  };
  const c = elementCost(el, graph(f, el), DF01);
  eq(c.cost, null, "no per-unit cost without a yield");
  ok(c.unresolved.some((u) => u.reason === "no yield"));
});

test("a line whose quantity is missing is named, not skipped", () => {
  const f = flour();
  const line = { id: "l", label: "Flour", qty: null, unit: "lbs", element_id: "el-flour" };
  const c = lineCost(line, graph(f), DF01);
  eq(c.cost, null);
  eq(c.unresolved[0].reason, "no quantity");
});

test("formatCost renders an empty cost as an em dash, never $0.00", () => {
  eq(formatCost({ cost: null, unit: null, unresolved: [] }), "—");
  no(formatCost({ cost: null, unit: null, unresolved: [] }).includes("0.00"));
});
