// Item costing and the price cascade — production brief decisions 10 and 11,
// and Mark's batch-yield rule.
//
// Each case was checked by breaking the code it pins.

import {
  itemCost,
  matchYield,
  type BatchYield,
  type CostElement,
  type ItemBom,
} from "../../src/lib/productionCost";
import {
  resolveItemPrice,
  findCell,
  margin,
  formatMargin,
  sortGrid,
  gridAxes,
  type PriceGridCell,
} from "../../src/lib/productionPrice";
import { test, eq, ok } from "./harness";

const DF01 = "loc-df01";
const EVENT = "loc-event";

/* -- the dough rule -------------------------------------------------------- */

/** A raised dough whose BATCH costs $340, so 1/340 of it is exactly $1. */
function dough(): CostElement {
  return {
    id: "el-dough",
    name: "Raised Dough",
    kind: "made",
    manual_cost: null,
    manual_cost_unit: null,
    master: {
      id: "v",
      lines: [
        // The yield is a LINE, not a column — see `elementCost`.
        { id: "yield", label: "Expected Yield", qty: 100, unit: "lbs", element_id: null },
        { id: "l", label: "Flour", qty: 340, unit: "lbs", element_id: "el-flour" },
      ],
    },
  };
}
const flour: CostElement = {
  id: "el-flour",
  name: "Flour",
  kind: "purchased",
  manual_cost: null,
  manual_cost_unit: null,
  inventory: {
    id: "inv",
    base_unit: "lbs",
    vendor_items: [{ id: "vi", price: 1, package_content: 1, is_active: true }],
  },
};

const RAISED: BatchYield[] = [
  { item_type: "Raised", subtype: null, size: "Regular", portion_of_batch: 1 / 340, size_factor: 1 },
  { item_type: "Raised", subtype: null, size: "Mini", portion_of_batch: 1 / 340, size_factor: 1 / 3 },
  { item_type: "Raised", subtype: null, size: "Giant", portion_of_batch: 1 / 340, size_factor: 2 },
];

const graph = (...els: CostElement[]) => new Map(els.map((e) => [e.id, e]));

function donut(over: Partial<ItemBom> = {}): ItemBom {
  return {
    id: "it", name: "Plain", item_type: "Raised", subtype: "Promise Ring",
    size: "Regular", base_element_id: "el-dough", elements: [], ...over,
  };
}

test("a regular donut costs 1/340 of its dough's BATCH", () => {
  // The batch is 340 lbs of $1 flour = $340. Mark's rule: 1/340 → $1.00.
  const c = itemCost(donut(), graph(dough(), flour), RAISED, DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 0.0001, `expected $1.00, got ${c.cost}`);
  eq(c.unit, "each");
});

test("a mini is a THIRD of a regular and a giant is TWICE it (Mark's rule)", () => {
  const g = graph(dough(), flour);
  const mini = itemCost(donut({ size: "Mini" }), g, RAISED, DF01);
  const giant = itemCost(donut({ size: "Giant" }), g, RAISED, DF01);
  ok(mini.cost !== null && Math.abs(mini.cost - 1 / 3) < 0.0001, `mini ${mini.cost}`);
  ok(giant.cost !== null && Math.abs(giant.cost - 2) < 0.0001, `giant ${giant.cost}`);
});

test("the dough reads the BATCH cost, not the per-unit cost", () => {
  // The trap: `elementCost` on a made element divides by the yield. Doing that
  // AND multiplying by portion_of_batch applies the yield twice, which here
  // would give $0.01 instead of $1.00 — a hundredfold error that still looks
  // like a plausible ingredient cost.
  const c = itemCost(donut(), graph(dough(), flour), RAISED, DF01);
  ok(c.cost !== null && c.cost > 0.5, `the yield was applied twice: ${c.cost}`);
});

test("toppings are added on top of the dough", () => {
  const sprinkles: CostElement = {
    id: "el-spr", name: "Sprinkles", kind: "purchased",
    manual_cost: null, manual_cost_unit: null,
    inventory: { id: "i2", base_unit: "lbs", vendor_items: [{ id: "v2", price: 4, package_content: 1, is_active: true }] },
  };
  const c = itemCost(
    donut({ elements: [{ id: "e", label: "Sprinkles", qty: 0.25, unit: "lbs", element_id: "el-spr" }] }),
    graph(dough(), flour, sprinkles), RAISED, DF01
  );
  ok(c.cost !== null && Math.abs(c.cost - 2) < 0.0001, `$1 dough + $1 sprinkles, got ${c.cost}`);
});

test("a size with NO yield rule costs nothing and names the gap", () => {
  // Measured on the real catalog: `giant` and `42g` are used by items and have
  // no rule. Defaulting them to 1 would invent a number for 46 giant donuts.
  const c = itemCost(donut({ size: "42g" }), graph(dough(), flour), RAISED, DF01);
  eq(c.cost, null);
  ok(c.unresolved.some((u) => u.reason === "no batch yield"), "the gap is named");
});

/* -- which rule applies ---------------------------------------------------- */

test("the MOST SPECIFIC yield rule wins", () => {
  const rules: BatchYield[] = [
    { item_type: "Cake", subtype: null, size: null, portion_of_batch: 1 / 40, size_factor: 1 },
    { item_type: "Cake", subtype: "Banana", size: null, portion_of_batch: 1 / 30, size_factor: 1 },
    { item_type: "Cake", subtype: "Banana", size: "Mini", portion_of_batch: 1 / 30, size_factor: 0.5 },
  ];
  eq(matchYield({ item_type: "Cake", subtype: "Vanilla", size: "Regular" }, rules)!.portion_of_batch, 1 / 40);
  eq(matchYield({ item_type: "Cake", subtype: "Banana", size: "Regular" }, rules)!.portion_of_batch, 1 / 30);
  eq(matchYield({ item_type: "Cake", subtype: "Banana", size: "Mini" }, rules)!.size_factor, 0.5);
});

test("a type with no rule at all matches nothing rather than borrowing one", () => {
  eq(matchYield({ item_type: "Mochi", subtype: "Krinkle", size: "Regular" }, RAISED), null);
});

test("matching ignores case and stray spaces, as the FMP data requires", () => {
  const r = matchYield({ item_type: " raised ", subtype: "x", size: "REGULAR" }, RAISED);
  ok(r !== null && r.size === "Regular");
});

/* -- the price cascade ----------------------------------------------------- */

const GRID: PriceGridCell[] = [
  { id: "g1", price_class: "Regular", price_tier: "Tier 1", price: 3.45, class_sort: 0, tier_sort: 1 },
  { id: "g2", price_class: "Regular", price_tier: "Tier 2", price: 3.9, class_sort: 0, tier_sort: 2 },
  { id: "g3", price_class: "Mini", price_tier: "Tier 1", price: 2.0, class_sort: 1, tier_sort: 1 },
];

test("an item with no override takes the ORG grid price", () => {
  const r = resolveItemPrice({ price_class: "Regular", price_tier: "Tier 1" }, DF01, GRID, [], []);
  eq(r.price, 3.45);
  eq(r.source, "org");
});

test("a LOCATION grid override beats the org grid — EVENT's real case", () => {
  const overrides = [{ grid_id: "g1", location_id: EVENT, price: 5 }];
  eq(resolveItemPrice({ price_class: "Regular", price_tier: "Tier 1" }, EVENT, GRID, overrides, []).price, 5);
  eq(resolveItemPrice({ price_class: "Regular", price_tier: "Tier 1" }, DF01, GRID, overrides, []).price, 3.45);
});

test("an ITEM override beats both", () => {
  const r = resolveItemPrice(
    { price_class: "Regular", price_tier: "Tier 1" }, EVENT, GRID,
    [{ grid_id: "g1", location_id: EVENT, price: 5 }],
    [{ location_id: EVENT, price_override: 7.5 }]
  );
  eq(r.price, 7.5);
  eq(r.source, "item");
});

test("an item override at ANOTHER shop does not speak for this one", () => {
  const r = resolveItemPrice(
    { price_class: "Regular", price_tier: "Tier 1" }, DF01, GRID, [],
    [{ location_id: EVENT, price_override: 7.5 }]
  );
  eq(r.price, 3.45);
  eq(r.source, "org");
});

test("an item missing a class or a tier has NO price, not a default one", () => {
  // 19 of the 307 real items carry neither. Falling back to some cell would
  // put a confident wrong number on a menu.
  eq(resolveItemPrice({ price_class: null, price_tier: "Tier 1" }, DF01, GRID, [], []).source, "none");
  eq(resolveItemPrice({ price_class: "Regular", price_tier: null }, DF01, GRID, [], []).price, null);
  eq(findCell({ price_class: "Nonesuch", price_tier: "Tier 1" }, GRID), null);
});

/* -- margin ---------------------------------------------------------------- */

test("margin is a fraction of PRICE, not of cost", () => {
  // $1 cost at $4 is a 75% margin and a 300% markup. Confusing the two is how
  // a menu ends up mispriced.
  eq(margin(1, 4), 0.75);
  eq(formatMargin(margin(1, 4)), "75%");
});

test("margin is null whenever either side is unknown", () => {
  eq(margin(null, 4), null);
  eq(margin(1, null), null);
  eq(margin(1, 0), null, "never divide by a zero price");
  eq(formatMargin(null), "—");
});

/* -- grid layout ----------------------------------------------------------- */

test("the grid sorts in menu order, not alphabetically", () => {
  const messy: PriceGridCell[] = [
    { id: "a", price_class: "Mini", price_tier: "Tier 10", price: 1, class_sort: 1, tier_sort: 10 },
    { id: "b", price_class: "Mini", price_tier: "Tier 2", price: 1, class_sort: 1, tier_sort: 2 },
    { id: "c", price_class: "Regular", price_tier: "Tier 1", price: 1, class_sort: 0, tier_sort: 1 },
  ];
  eq(sortGrid(messy).map((c) => c.id), ["c", "b", "a"]);
  const axes = gridAxes(messy);
  eq(axes.classes, ["Regular", "Mini"]);
  eq(axes.tiers, ["Tier 1", "Tier 2", "Tier 10"]);
});
