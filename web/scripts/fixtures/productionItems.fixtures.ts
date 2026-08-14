// Item costing and the price cascade — production brief decisions 10 and 11,
// and Mark's batch-yield rule.
//
// Each case was checked by breaking the code it pins.

import {
  itemCost,
  elementCost,
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
/** The costing CONTEXT — just the shop; see productionCost.fixtures. */
const AT_DF01 = { locationId: DF01 };
const EVENT = "loc-event";

/* -- an item is its component list, and nothing is special -------------------
 *
 * `production_items.base_element_id` and `production_batch_yields` are GONE
 * (Mark, 2026-08-13: "get rid of the 'dough' field on production items … 
 * components live in the component list only", and "items can be anything.
 * They don't even have to be a donut. Assuming they're donuts, or that they are
 * a specific kind of donut, is weird and wrong.").
 *
 * So there is no dough arithmetic left to pin. What these cases pin instead is
 * that there is NONE: an item costs the sum of its edges, the base among them,
 * with no lookup by (item_type, subtype, size) anywhere.
 */

/** A dough: $100 of flour a batch, and the batch makes 100 — $1.00 each. */
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
        { id: "yield", label: "Expected Yield", qty: 100, unit: "ea", element_id: null },
        { id: "l", label: "Flour", qty: 100, unit: "lbs", element_id: "el-flour" },
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

const graph = (...els: CostElement[]) => new Map(els.map((e) => [e.id, e]));

/** The base arrives as an ordinary edge — 1 of it for a regular donut, which is
 *  what `backfill-item-dough.mjs` wrote from the old `size_factor`. */
function donut(over: Partial<ItemBom> = {}): ItemBom {
  return {
    id: "it",
    name: "Plain",
    elements: [{ id: "e0", label: "Raised Dough", qty: 1, unit: "ea", element_id: "el-dough" }],
    ...over,
  };
}

test("an item costs the sum of its components, base included", () => {
  const c = itemCost(donut(), graph(dough(), flour), AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 0.0001, `expected $1.00, got ${c.cost}`);
  eq(c.unit, "each");
});

test("the base is JUST A COMPONENT — no type, no cut, no size is consulted", () => {
  // The whole point of dropping the field. An item carrying no taxonomy at all
  // costs exactly the same as one carrying every field, because nothing looks
  // anything up: "items can be anything. They don't even have to be a donut."
  const g = graph(dough(), flour);
  const bare = itemCost(donut(), g, AT_DF01);
  const dressed = itemCost(
    { ...donut(), name: "Angry Samoa" } as ItemBom,
    g,
    AT_DF01
  );
  eq(bare.cost, dressed.cost, "the taxonomy has no say");
});

test("a mini is a third because its EDGE says so, not because a rule does", () => {
  const g = graph(dough(), flour);
  const mini = itemCost(
    donut({ elements: [{ id: "e0", label: null, qty: 1 / 3, unit: "ea", element_id: "el-dough" }] }),
    g, AT_DF01
  );
  const giant = itemCost(
    donut({ elements: [{ id: "e0", label: null, qty: 2, unit: "ea", element_id: "el-dough" }] }),
    g, AT_DF01
  );
  ok(mini.cost !== null && Math.abs(mini.cost - 1 / 3) < 0.0001, `mini ${mini.cost}`);
  ok(giant.cost !== null && Math.abs(giant.cost - 2) < 0.0001, `giant ${giant.cost}`);
});

test("the base costs what the ELEMENT costs — one call, not two", () => {
  const g = graph(dough(), flour);
  eq(itemCost(donut(), g, AT_DF01).cost, elementCost(dough(), g, AT_DF01).cost, "same number");
});

test("toppings are added on top of the base", () => {
  const sprinkles: CostElement = {
    id: "el-spr", name: "Sprinkles", kind: "purchased",
    manual_cost: null, manual_cost_unit: null,
    inventory: { id: "i2", base_unit: "lbs", vendor_items: [{ id: "v2", price: 4, package_content: 1, is_active: true }] },
  };
  const c = itemCost(
    donut({ elements: [
      { id: "e0", label: null, qty: 1, unit: "ea", element_id: "el-dough" },
      { id: "e1", label: "Sprinkles", qty: 0.25, unit: "lbs", element_id: "el-spr" },
    ] }),
    graph(dough(), flour, sprinkles), AT_DF01
  );
  ok(c.cost !== null && Math.abs(c.cost - 2) < 0.0001, `$1 base + $1 sprinkles, got ${c.cost}`);
});

test("an edge with NO quantity costs nothing and names the gap", () => {
  // 58 items' bases arrived with a null qty because their old (type, subtype,
  // size) rule matched nothing — 33 of them Raised/Promise Ring/Giant, since
  // the rules called "Giant" a subtype and the items call it a size. Same
  // as before: no cost, and said out loud.
  const c = itemCost(
    donut({ elements: [{ id: "e0", label: null, qty: null, unit: "ea", element_id: "el-dough" }] }),
    graph(dough(), flour), AT_DF01
  );
  eq(c.cost, null);
  ok(c.unresolved.some((u) => u.reason === "no quantity"), "the gap is named");
});

/**
 * Labour is an ELEMENT now (migration 050) — manual, typed `Labor`, priced per
 * shop. $35/hr at DF01, and $20 at a second shop so a case can show the rate
 * following the shop rather than a column on `locations`.
 */
const labour: CostElement = {
  id: "el-labour", name: "Prep Time", kind: "manual", element_type: "Labor",
  manual_cost: 20, manual_cost_unit: "hr",
  location_costs: [{ location_id: DF01, cost: 35 }],
};

/** The same dough, with two hours of labour on its recipe. */
function doughWithLabour(): CostElement {
  const d = dough();
  d.master!.lines = [
    { id: "prep", label: "Prep Time", qty: 2, unit: "hr", element_id: "el-labour" },
    ...d.master!.lines,
  ];
  return d;
}

test("THE BASE'S LABOUR IS CHARGED, like every other component", () => {
  // $100 of flour + 2 hr × $35 = $170 a batch, over a yield of 100 → $1.70.
  const g = graph(doughWithLabour(), flour, labour);
  const c = itemCost(donut(), g, AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1.7) < 1e-9, `expected $1.70, got ${c.cost}`);
  eq(c.cost, elementCost(doughWithLabour(), g, AT_DF01).cost, "the item's base IS the element's cost");
});

test("AN ITEM CAN CARRY LABOUR OF ITS OWN — decorating is in no recipe", () => {
  // What the old shape could not express at all: `itemCost` read
  // `locations.labor_rate` never, so work done ON the donut rather than in a
  // recipe was uncostable. Now it is an ordinary component carrying hours.
  const c = itemCost(
    donut({ elements: [
      { id: "e0", label: null, qty: 1, unit: "ea", element_id: "el-dough" },
      { id: "e1", label: "Decorating", qty: 0.02, unit: "hr", element_id: "el-labour" },
    ] }),
    graph(dough(), flour, labour), AT_DF01
  );
  ok(c.cost !== null && Math.abs(c.cost - (1 + 0.02 * 35)) < 1e-9, `got ${c.cost}`);
});

test("a shop with no rate row falls back to the element's own cost", () => {
  const g = graph(doughWithLabour(), flour, labour);
  const other = itemCost(donut(), g, { locationId: "loc-df09" });
  ok(other.cost !== null && Math.abs(other.cost - (100 + 2 * 20) / 100) < 1e-9, `got ${other.cost}`);
});

test("a recipe with NO labour line makes the item a lower bound", () => {
  // 97 of the 128 master recipes said nothing about how long they take, and
  // that silence used to be invisible. Same sentence as before, new source.
  const c = itemCost(donut(), graph(dough(), flour), AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 1e-9, `got ${c.cost}`);
  ok(c.unresolved.some((u) => u.reason === "no prep time"), JSON.stringify(c.unresolved));
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
