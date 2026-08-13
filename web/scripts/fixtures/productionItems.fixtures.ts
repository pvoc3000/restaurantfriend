// Item costing and the price cascade — production brief decisions 10 and 11,
// and Mark's batch-yield rule.
//
// Each case was checked by breaking the code it pins.

import {
  itemCost,
  elementCost,
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
/**
 * The costing CONTEXT — a shop and its labour rate. `elementCost` and friends
 * take this rather than a bare id, because a made element's cost now includes
 * the prep time on its recipe and that is hours until a rate turns it into
 * money.
 *
 * NO RATE by default: these cases pin the ingredient arithmetic, and a rate
 * would fold labour into every expected figure. The ones that mean to test
 * labour supply their own.
 */
const AT_DF01 = { locationId: DF01, laborRate: null };
const EVENT = "loc-event";

/* -- the dough rule -------------------------------------------------------- */

/**
 * A raised dough: $100 of flour a batch, and the batch makes 100 donuts — so
 * one donut of dough is exactly $1.
 *
 * THE YIELD ROW IS THE ONLY THING THAT SETS THAT (Mark, 2026-08-13: "the
 * expected yield IS the portion of a batch. They're the same thing. Use the
 * yield."). `RAISED` below still carries a `portion_of_batch` of 1/340 — a
 * deliberately absurd second answer, kept so the cases can prove costing
 * ignores it. If it were ever consulted again a donut would cost $0.29.
 */
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

test("a regular donut is ONE UNIT of its dough", () => {
  // $100 a batch over a yield of 100 → $1.00 each.
  const c = itemCost(donut(), graph(dough(), flour), RAISED, AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 0.0001, `expected $1.00, got ${c.cost}`);
  eq(c.unit, "each");
});

test("PORTION_OF_BATCH IS IGNORED — the yield row decides, and only it", () => {
  // The rule and the recipe disagree here on purpose: the rule says 1/340 of a
  // batch and the recipe says a batch makes 100. Measured over the live
  // catalog they disagree on every cake dough (a yield row of 15 against
  // portions of 1/30, 1/35, 1/40), and they used to be BOTH consulted — the
  // item through the portion, the element through the yield — so one donut had
  // two costs. Change the portion to anything and this must not move.
  const g = graph(dough(), flour);
  const wild: BatchYield[] = RAISED.map((r) => ({ ...r, portion_of_batch: 1 / 7 }));
  const a = itemCost(donut(), g, RAISED, AT_DF01);
  const b = itemCost(donut(), g, wild, AT_DF01);
  eq(a.cost, b.cost, "the portion has no say");
  ok(a.cost !== null && Math.abs(a.cost - 1) < 0.0001, `still $1.00, got ${a.cost}`);
});

test("the dough costs what the DOUGH costs — one call, not two", () => {
  // The invariant that replaces the old batch arithmetic: a regular donut's
  // dough IS `elementCost` of that dough, so the item screen and the element
  // screen cannot disagree, and neither can follow a cost-column radio the
  // other does not see.
  const g = graph(dough(), flour);
  const per = elementCost(dough(), g, AT_DF01);
  const item = itemCost(donut(), g, RAISED, AT_DF01);
  eq(item.cost, per.cost, "same number");
});

test("a mini is a THIRD of a regular and a giant is TWICE it (Mark's rule)", () => {
  const g = graph(dough(), flour);
  const mini = itemCost(donut({ size: "Mini" }), g, RAISED, AT_DF01);
  const giant = itemCost(donut({ size: "Giant" }), g, RAISED, AT_DF01);
  ok(mini.cost !== null && Math.abs(mini.cost - 1 / 3) < 0.0001, `mini ${mini.cost}`);
  ok(giant.cost !== null && Math.abs(giant.cost - 2) < 0.0001, `giant ${giant.cost}`);
});

test("the yield is applied ONCE — not twice, and not never", () => {
  // The old trap was applying it twice (dividing by the yield AND multiplying
  // by a portion), which gave $0.01 for a $1.00 donut. The new one would be
  // applying it never. $1.00 is the only answer that is neither.
  const c = itemCost(donut(), graph(dough(), flour), RAISED, AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 0.0001, `got ${c.cost}`);
});

test("toppings are added on top of the dough", () => {
  const sprinkles: CostElement = {
    id: "el-spr", name: "Sprinkles", kind: "purchased",
    manual_cost: null, manual_cost_unit: null,
    inventory: { id: "i2", base_unit: "lbs", vendor_items: [{ id: "v2", price: 4, package_content: 1, is_active: true }] },
  };
  const c = itemCost(
    donut({ elements: [{ id: "e", label: "Sprinkles", qty: 0.25, unit: "lbs", element_id: "el-spr" }] }),
    graph(dough(), flour, sprinkles), RAISED, AT_DF01
  );
  ok(c.cost !== null && Math.abs(c.cost - 2) < 0.0001, `$1 dough + $1 sprinkles, got ${c.cost}`);
});

test("a size with NO yield rule costs nothing and names the gap", () => {
  // Measured on the real catalog: `giant` and `42g` are used by items and have
  // no rule. Defaulting them to 1 would invent a number for 46 giant donuts.
  const c = itemCost(donut({ size: "42g" }), graph(dough(), flour), RAISED, AT_DF01);
  eq(c.cost, null);
  ok(c.unresolved.some((u) => u.reason === "no batch yield"), "the gap is named");
});

/* -- which rule applies ---------------------------------------------------- */

/* -- the dough is charged like every other component (2026-08-13) ---------- */

/** The same dough with a prep-time row: 2 hr, which at $35 is $70 of labour. */
function doughWithLabour(): CostElement {
  const d = dough();
  d.master!.lines = [
    { id: "prep", label: "Prep Time", qty: 2, unit: "hr", element_id: null },
    ...d.master!.lines,
  ];
  return d;
}

test("THE DOUGH'S LABOUR IS CHARGED — an item and its dough are one number", () => {
  // The bug this pins shipped and was measured on the real catalog: `itemCost`
  // priced the dough with `versionBatchCost` (ingredients only) while every
  // other component on the item went through `elementCost` (which includes
  // labour). A raised donut's dough contributed $0.0168 where the element
  // screen quoted $0.5282 for the very same dough.
  //
  // Here: $100 of flour + 2 hr x $35 = $170 a batch, over a yield of 100 →
  // $1.70 a donut. Ingredients-only gives $1.00, which is what the old code
  // said.
  const at = { locationId: DF01, laborRate: 35 };
  const g = graph(doughWithLabour(), flour);
  const c = itemCost(donut(), g, RAISED, at);
  ok(c.cost !== null && Math.abs(c.cost - 1.7) < 1e-9, `expected $1.70, got ${c.cost}`);

  // And it is not merely "bigger" — it is EXACTLY what the dough itself costs.
  // Two calls that must never diverge again.
  const per = elementCost(doughWithLabour(), g, at);
  eq(c.cost, per.cost, "the item's dough IS the dough's cost");
});

test("with no labour rate the dough falls back to ingredients, and SAYS SO", () => {
  const c = itemCost(donut(), graph(doughWithLabour(), flour), RAISED, AT_DF01);
  ok(c.cost !== null && Math.abs(c.cost - 1) < 1e-9, `ingredients only: ${c.cost}`);
  // Not silently — the figure is a lower bound and the item names why.
  ok(
    c.unresolved.some((u) => u.reason === "no labour rate"),
    `expected a labour-rate gap, got ${JSON.stringify(c.unresolved)}`
  );
});

test("a dough with NO prep-time row makes the item a lower bound", () => {
  // 97 of the 128 master recipes have no prep row. The item still costs what
  // it can — it just stops claiming the figure is complete.
  const c = itemCost(donut(), graph(dough(), flour), RAISED, { locationId: DF01, laborRate: 35 });
  ok(c.cost !== null && Math.abs(c.cost - 1) < 1e-9, `got ${c.cost}`);
  ok(
    c.unresolved.some((u) => u.reason === "no prep time"),
    `expected a prep-time gap, got ${JSON.stringify(c.unresolved)}`
  );
});

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
