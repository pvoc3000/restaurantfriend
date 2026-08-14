/**
 * What an element costs to make or buy, resolved LIVE through the production
 * graph and out into purchasing (production brief decision 11).
 *
 * Nothing here is ever stored. FileMaker froze every cost at map time and still
 * carries 1/30/2022 prices in 2026 — recipe item costs, recipe costs, item
 * costs, all stale snapshots of a number that had already moved. Migration 036
 * has no cost column for the same reason. The cost of a Strawberry Glaze is
 * whatever its ingredients cost today, and the only way that stays true is to
 * ask every time.
 *
 * The three kinds resolve differently:
 *
 *   purchased → its inventory item → the effective vendor price (design rule 6:
 *               a location override beats the catalog price), divided by the
 *               package content to get a cost per base unit.
 *   made      → its master recipe version's lines, summed, divided by that
 *               recipe's own "Expected Yield" row (NOT the version's
 *               `yield_amount` column — see `elementCost`).
 *   manual    → the set cost it carries.
 *
 * ---------------------------------------------------------------------------
 * WHY AN UNKNOWN COST IS NOT ZERO
 *
 * The BOM is full of holes on day one — 155 of the 470 migrated elements
 * resolve to nothing, because FileMaker never mapped them to a vendor item and
 * because 24 of them are cleaning duties that have no cost at all. A resolver
 * that treated those as $0.00 would report a confident, wrong, and always-too-low
 * number for every recipe containing one, and nothing on screen would say so.
 *
 * So a cost is `{ cost, unresolved }` — the money we could account for, and the
 * elements we could not. A caller that ignores `unresolved` gets a lower bound,
 * which is why the UI renders "≥ $4.12" and names the count.
 */

import { convert } from "./units";
import {
  columnCell,
  metadataLine,
  scaleColumns,
  type ScalableLine,
  type ScaleColumn,
} from "./production";

export type ElementKind = "made" | "purchased" | "manual";

/** The graph, as the screens load it. Deliberately structural, not row types. */
export type CostElement = {
  id: string;
  name: string;
  kind: ElementKind;
  manual_cost: number | null;
  manual_cost_unit: string | null;
  /** The inventory item a purchased element resolves through, if any. */
  inventory?: CostInventoryItem | null;
  /** The master version of this element's recipe, if it has one. */
  master?: CostVersion | null;
};

export type CostInventoryItem = {
  id: string;
  base_unit: string | null;
  /** Every vendor item that can supply it; the cheapest priced one wins. */
  vendor_items: CostVendorItem[];
};

export type CostVendorItem = {
  id: string;
  price: number | null;
  package_content: number | null;
  is_active: boolean;
  /** Per-location overrides, design rule 6. */
  vendor_item_location_prices?: { location_id: string; price: number | null }[];
};

/**
 * A recipe version as COSTING sees it: its lines, and the batch size it is
 * costed AT.
 *
 * NO `yield_amount` / `yield_unit`. Those columns still exist on the table but
 * nothing costs from them and nothing may — the yield is the "Expected Yield"
 * line, which is why the divisor is in `lines` like everything else. Leaving
 * them on this type is how the next reader reaches for the wrong one.
 */
export type CostVersion = {
  id: string;
  lines: CostLine[];
  /** 041's strip — what batch sizes this version has, and what each multiplies
   *  the base by. Absent means the version has only its base column. */
  scale_labels?: string[] | null;
  scale_multipliers?: number[] | null;
  /** Migration 042 — which of them the recipe is costed at. Null = the base. */
  cost_column?: number | null;
};

export type CostLine = {
  id: string;
  label: string | null;
  /** The BASE column's amount. Every other column is derived — see 041. */
  qty: number | null;
  unit: string | null;
  element_id: string | null;
  /** 041's per-line strip, read only for the yield row and only when the row
   *  is typed rather than computed. Costing ignores it for ingredients, which
   *  scale by the column's multiplier like the matrix does. */
  scaleAuto?: boolean;
  scaleAmounts?: (number | null)[] | null;
  scaleUnits?: (string | null)[] | null;
  /**
   * Where the row sits in its list. Nothing about COSTING reads it — a total is
   * a total in any order — but the screens that render these lines do, and a
   * row you have just added has to land somewhere predictable rather than
   * wherever its uuid happens to fall.
   */
  sort?: number | null;
};

/** Why a cost could not be resolved, in the words the UI shows. */
export type Unresolved = {
  elementId: string | null;
  name: string;
  reason:
    | "no inventory item"      // purchased, never mapped
    | "no vendor price"        // mapped, but nothing carries a price
    | "no package content"     // priced, but we can't get to a per-unit cost
    | "no recipe"              // made, but no master version
    | "no ingredients"         // made, and the master version is an empty document
    | "no yield"               // made, but the version doesn't say how much it makes
    | "no prep time"           // made, but the recipe never says how long it takes
    | "no labour rate"         // the hours are known and the shop has no rate
    | "no quantity"            // a line with no amount
    | "incompatible units"     // the line's unit can't reach the element's
    | "cycle";                 // the BOM refers to itself
};

/**
 * WHERE a cost is being asked from — and therefore what it costs.
 *
 * BOTH HALVES ARE PROPERTIES OF THE SHOP (Mark, 2026-08-12: "each location has
 * its own vendor item and labor costs"). A `vendor_item_location_prices`
 * override beats the catalog price, which is design rule 6, and labour is
 * charged at that shop's `locations.labor_rate`. So the same recipe read at
 * DF01 and at DF02 legitimately costs different amounts to make, and that is
 * the answer rather than an inconsistency: 135 override rows exist and the two
 * open shops have their own rates to move independently.
 *
 * One object rather than two positional arguments because the rate arrived
 * later than the location, and a fifth positional `number | null` sitting next
 * to `seen` is exactly the kind of thing that gets passed in the wrong slot.
 */
export type CostContext = {
  locationId: string | null;
  /** `locations.labor_rate`. Null charges NO labour rather than charging zero,
   *  which are different claims — see `recipeCostMatrix`. */
  laborRate: number | null;
};

/**
 * The context for a screen's WORKING location — the one line every costing
 * caller needs, so nobody has to remember that labour comes from a different
 * column of the same row they already have.
 */
export function costContext(
  location: { id: string; labor_rate: number | null } | null
): CostContext {
  return {
    locationId: location?.id ?? null,
    laborRate: location?.labor_rate ?? null,
  };
}

export type Cost = {
  /** Cost per ONE of `unit`, or null when nothing at all could be resolved. */
  cost: number | null;
  unit: string | null;
  /** Everything that could not be priced. Empty means the figure is complete. */
  unresolved: Unresolved[];
};

const EMPTY: Cost = { cost: null, unit: null, unresolved: [] };

/**
 * The effective price of a vendor item at a location — design rule 6, and the
 * same cascade `effectiveCatalogPrice` implements for purchase orders. Not
 * imported from `lib/purchaseOrders`: that one takes a PO LINE, whose shape is
 * a purchase-order concern, and importing it here would drag the whole PO type
 * graph into the recipe screens for four lines of arithmetic.
 */
export function effectiveVendorPrice(
  vi: CostVendorItem,
  locationId: string | null
): number | null {
  if (locationId) {
    const override = (vi.vendor_item_location_prices ?? []).find(
      (p) => p.location_id === locationId
    );
    if (override && override.price !== null) return Number(override.price);
  }
  return vi.price === null ? null : Number(vi.price);
}

/**
 * What one base unit of an inventory item costs — the CHEAPEST active source,
 * which is what the kitchen would actually pay.
 *
 * Cheapest rather than first: an item with three vendors has three prices and
 * picking by row order would make the answer depend on how PostgREST felt.
 * Cheapest is at least a rule, and it matches how the order guide presents
 * sources (unit price, for comparison).
 */
export function inventoryUnitCost(
  item: CostInventoryItem,
  locationId: string | null
): { cost: number | null; reason: Unresolved["reason"] | null } {
  let best: number | null = null;
  let sawPrice = false;
  for (const vi of item.vendor_items) {
    if (!vi.is_active) continue;
    const price = effectiveVendorPrice(vi, locationId);
    if (price === null) continue;
    sawPrice = true;
    // package_content is the content in the item's OWN base unit (design rule
    // 5), so this division needs no conversion — that is the whole reason the
    // column is defined that way.
    if (!vi.package_content) continue;
    const per = price / Number(vi.package_content);
    if (best === null || per < best) best = per;
  }
  if (best !== null) return { cost: best, reason: null };
  return { cost: null, reason: sawPrice ? "no package content" : "no vendor price" };
}

/**
 * The cost of ONE `unit` of an element.
 *
 * `seen` carries the elements currently being resolved, which is what makes a
 * cyclic BOM report itself instead of recursing until the stack gives out. A
 * cycle is reachable: 036 lets a recipe line point at any element, and nothing
 * stops someone making Glaze A from Glaze B and Glaze B from Glaze A. FileMaker
 * had no such guard because its costs were snapshots — the cycle just froze.
 */
export function elementCost(
  element: CostElement,
  byId: Map<string, CostElement>,
  ctx: CostContext,
  seen: Set<string> = new Set()
): Cost {
  if (seen.has(element.id)) {
    return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "cycle" }] };
  }

  if (element.kind === "manual") {
    if (element.manual_cost === null) {
      return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "no vendor price" }] };
    }
    return { cost: Number(element.manual_cost), unit: element.manual_cost_unit, unresolved: [] };
  }

  if (element.kind === "purchased") {
    if (!element.inventory) {
      return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "no inventory item" }] };
    }
    const { cost, reason } = inventoryUnitCost(element.inventory, ctx.locationId);
    if (cost === null) {
      return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: reason ?? "no vendor price" }] };
    }
    return { cost, unit: element.inventory.base_unit, unresolved: [] };
  }

  // made
  const version = element.master;
  if (!version) {
    return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "no recipe" }] };
  }
  // WHAT ONE OF THESE COSTS IS `recipeCostMatrix`, AT THE COLUMN THE RECIPE IS
  // COSTED AT — see `versionCostedBatch`, which both this and `itemCost` go
  // through so a donut's dough and the same dough on its own screen cannot
  // disagree.
  const batch = versionCostedBatch(
    version,
    byId,
    ctx,
    element.name,
    new Set(seen).add(element.id)
  );

  if (batch.subtotal === null) {
    return { cost: null, unit: null, unresolved: batch.unresolved };
  }

  if (!batch.yieldQty) {
    // The batch cost is still real and worth showing; what we can't do is
    // divide it into a per-unit figure.
    return {
      cost: null,
      unit: null,
      unresolved: [
        { elementId: element.id, name: element.name, reason: "no yield" },
        ...batch.unresolved,
      ],
    };
  }
  return {
    cost: batch.subtotal / batch.yieldQty,
    unit: batch.yieldUnit,
    unresolved: batch.unresolved,
  };
}

/**
 * ONE BATCH OF A MADE ELEMENT, ALL IN — what it costs at the column the recipe
 * is costed at, and how much that batch makes.
 *
 * THIS IS THE ONE PLACE A BATCH IS PRICED, and it exists because there were two
 * (Mark, 2026-08-12: "just do one calculation (that includes labor) and use it
 * everywhere … use the value in the cost matrix"). `elementCost` read the
 * matrix and `itemCost` read `versionBatchCost` directly, so a raised donut's
 * dough contributed $0.0168 while the very same dough quoted $0.5282 on its own
 * screen — a 31× understatement on 152 of the 307 items, and the whole of it
 * was the $122.50 of prep time. Route both through here and the two cannot
 * drift again; there is nothing left to drift.
 *
 * Two things it settles that a caller must not settle for itself:
 *
 * THE YIELD is the recipe's own "Expected Yield" ROW, never the version's
 * `yield_amount` column — two answers to one question, and over the 128 masters
 * 84 agree, 19 differ and 25 have neither. The row wins because it is what the
 * kitchen reads: on the printed sheet, per batch size, maintained by whoever
 * maintains the recipe.
 *
 * INGREDIENTS AND YIELD MOVE TOGETHER. Both are taken at the chosen column, so
 * `subtotal / yieldQty` is right at any of them. Take one without the other and
 * the answer is out by that column's multiplier.
 */
export function versionCostedBatch(
  version: CostVersion,
  byId: Map<string, CostElement>,
  ctx: CostContext,
  /** What to call this recipe in an `unresolved` entry — the element's own
   *  name, so "2 not priced: Raised Dough" reads as a place to go. */
  name: string,
  seen: Set<string> = new Set()
): {
  /** The ingredients at the chosen column. */
  ingredients: number | null;
  /** Ingredients PLUS labour — what a batch actually costs to produce. */
  subtotal: number | null;
  /** The expected-yield row at the same column. */
  yieldQty: number | null;
  yieldUnit: string | null;
  unresolved: Unresolved[];
} {
  const batch = versionBatchCost(version, byId, ctx, seen);
  const none = {
    ingredients: null,
    subtotal: null,
    yieldQty: null,
    yieldUnit: null,
    unresolved: batch.unresolved,
  };
  if (batch.cost === null) return none;

  const matrix = recipeCostMatrix({
    columns: scaleColumns(version.scale_labels ?? null, version.scale_multipliers ?? null),
    lines: version.lines,
    baseIngredientCost: batch.cost,
    laborRate: ctx.laborRate,
    costColumn: version.cost_column ?? null,
  });
  const chosen = defaultColumn(matrix);
  if (chosen === null) return none;

  // UNCHARGED LABOUR IS AN UNKNOWN COST, NOT A ZERO — this module's founding
  // rule, applied to the half of a cost that arrived last.
  //
  // Labour comes from the prep-time row, and 97 of the 128 master recipes have
  // none: every glaze, every icing, most fillings. Before this the subtotal
  // quietly became ingredients-only and `formatCost` printed a confident
  // "$0.12" — the app advertising that costs include labour while three
  // recipes in four silently omitted it, which is exactly the confident
  // always-too-low number the `unresolved` list exists to prevent.
  //
  // Said only when there are ingredients to cost: a version of nothing but
  // metadata rows already reports "no ingredients", and a second complaint
  // about its missing prep time names no useful fix.
  const unresolved = [...batch.unresolved];
  if (version.lines.some((l) => l.element_id)) {
    if (chosen.laborHours === null) {
      unresolved.push({ elementId: null, name, reason: "no prep time" });
    } else if (ctx.laborRate === null) {
      // The hours are on the recipe and the shop has no rate to price them at.
      // A different gap with a different fix, so it says so rather than
      // blaming the recipe.
      unresolved.push({ elementId: null, name, reason: "no labour rate" });
    }
  }

  return {
    ingredients: chosen.ingredients,
    subtotal: chosen.subtotal,
    yieldQty: chosen.yieldQty,
    yieldUnit: chosen.yieldUnit,
    unresolved,
  };
}

/**
 * What one BATCH of a recipe version costs — the sum of its lines.
 *
 * `cost` is the money we could account for, so it is a LOWER BOUND whenever
 * `unresolved` is non-empty. It is deliberately not null in that case: a glaze
 * whose sugar is priced and whose flavoring isn't still tells you more than
 * nothing, as long as the screen says which is missing.
 */
export function versionBatchCost(
  version: CostVersion,
  byId: Map<string, CostElement>,
  ctx: CostContext,
  seen: Set<string> = new Set()
): Cost {
  let total = 0;
  let priced = 0;
  const unresolved: Unresolved[] = [];

  for (const line of version.lines) {
    const result = lineCost(line, byId, ctx, seen);
    if (result.cost === null) {
      unresolved.push(...result.unresolved);
      continue;
    }
    total += result.cost;
    priced += 1;
    unresolved.push(...result.unresolved);
  }

  // A version with nothing PRICEABLE in it costs nothing AND had nothing to
  // report, so it used to come back as an unexplained null — an element reading
  // "—" with no reason beside it, which is the one thing this module's whole
  // unresolved-list exists to prevent. Measured against the live catalog: one
  // element (Toasted Coconut) is exactly this.
  //
  // "Nothing priceable" and "no lines" are NOT the same test, and the
  // difference started mattering when the yield became a line: a version whose
  // only rows are Expected Yield and Mixer Size has lines and still has no
  // ingredients. Free-text rows ("pinch of salt") count as nothing here too,
  // which is right — they price nothing.
  if (!version.lines.some((l) => l.element_id)) {
    unresolved.push({ elementId: null, name: "this recipe", reason: "no ingredients" });
  }
  return { cost: priced ? total : null, unit: null, unresolved };
}

/** What one recipe line contributes to its batch. */
export function lineCost(
  line: CostLine,
  byId: Map<string, CostElement>,
  ctx: CostContext,
  seen: Set<string> = new Set()
): Cost {
  const named = line.label ?? "(unnamed line)";
  if (!line.element_id) {
    // A note-shaped line: "pinch of salt". 222 of them came over from FMP.
    // Not an error and not a cost — it is simply not a priced ingredient, so
    // it contributes nothing and reports nothing.
    return EMPTY;
  }
  const element = byId.get(line.element_id);
  if (!element) return { cost: null, unit: null, unresolved: [{ elementId: line.element_id, name: named, reason: "no inventory item" }] };

  if (line.qty === null) {
    return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "no quantity" }] };
  }

  const per = elementCost(element, byId, ctx, seen);
  if (per.cost === null) return { cost: null, unit: null, unresolved: per.unresolved };

  // The line's unit and the element's may differ — a recipe calls for 170 g of
  // a flour priced per pound. `convert` returns null across families and for
  // package units, which is exactly right: a case of cups and a case of flour
  // share nothing but the word, so a confident conversion there would be a
  // wrong number on a purchase order.
  const qtyInElementUnit =
    line.unit && per.unit && line.unit !== per.unit
      ? convert(Number(line.qty), line.unit, per.unit)
      : Number(line.qty);

  if (qtyInElementUnit === null) {
    return { cost: null, unit: null, unresolved: [{ elementId: element.id, name: element.name, reason: "incompatible units" }] };
  }
  return { cost: qtyInElementUnit * per.cost, unit: null, unresolved: per.unresolved };
}

/**
 * "$4.12", or "≥ $4.12" when something in the tree could not be priced.
 *
 * A SUB-CENT COST KEEPS FOUR DECIMALS, and that is not a nicety. Half this
 * catalog is priced per GRAM — Chocolate Glaze is $7.68 a batch over a 3,272 g
 * yield, which is $0.0024/g — and two decimals renders every one of them as
 * "$0.00", i.e. free. That reads as the costing being broken rather than as
 * rounding, and it is why FileMaker kept a CostPerGram column to sixteen
 * places. Found on the element screen with real data.
 */
export function formatCost(cost: Cost, currency = "$"): string {
  if (cost.cost === null) return "—";
  const places = cost.cost !== 0 && Math.abs(cost.cost) < 0.01 ? 4 : 2;
  const money = `${currency}${cost.cost.toFixed(places)}`;
  return cost.unresolved.length ? `≥ ${money}` : money;
}

/** "2 ingredients not priced" — what the ≥ is hiding, in words. */
export function unresolvedSummary(cost: Cost): string | null {
  if (!cost.unresolved.length) return null;
  const names = [...new Set(cost.unresolved.map((u) => u.name))];
  const head = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `${names.length} not priced: ${head}${rest}`;
}

/* ========================================================================== */
/* Items — the finished good                                                   */
/* ========================================================================== */

/**
 * What one ITEM costs to make: the sum of what it is made of.
 *
 * THERE IS NO "DOUGH" HERE ANY MORE, and that is the point (Mark, 2026-08-13:
 * "get rid of the 'dough' field on production items. It's not necessary and
 * doubles existing data. Components live in the component list only.").
 *
 * `production_items.base_element_id` used to name one component specially, and
 * because it was special it needed its own arithmetic: a
 * `production_batch_yields` rule looked up by (item_type, subtype, size) said
 * how much of it went into one donut. Which meant costing had to know what KIND
 * of donut an item was — and, as Mark put it, "items can be anything. They
 * don't even have to be a donut. Assuming they're donuts, or that they are a
 * specific kind of donut, is weird and wrong."
 *
 * It was also measurably failing: 58 of the 216 items with a base matched no
 * rule, so their largest component silently cost nothing. 33 of those were
 * `Raised/Promise Ring/Giant`, because the rules table treats "Giant" as a
 * SUBTYPE while the items use it as a SIZE — the exact failure that enumerating
 * (type, subtype, size) triples invites.
 *
 * `migration/backfill-item-dough.mjs` moved every base into
 * `production_item_elements` carrying its old `size_factor` as an ordinary
 * quantity, so nothing repriced on the way through, and migration 045 drops the
 * column. An item is now a list of components and nothing else.
 */
export type ItemBom = {
  id: string;
  name: string;
  /** The things it is made of — `production_item_elements`. */
  elements: CostLine[];
};

export function itemCost(
  item: ItemBom,
  byId: Map<string, CostElement>,
  ctx: CostContext
): Cost {
  let total = 0;
  let priced = 0;
  const unresolved: Unresolved[] = [];

  for (const line of item.elements) {
    const result = lineCost(line, byId, ctx);
    if (result.cost === null) { unresolved.push(...result.unresolved); continue; }
    total += result.cost;
    priced += 1;
    unresolved.push(...result.unresolved);
  }

  return { cost: priced ? total : null, unit: "each", unresolved };
}

/* ===========================================================================
 * THE ONE COST CALCULATION
 * ===========================================================================
 *
 * Mark, 2026-08-12: "why are you reinventing the wheel? The cost per each is
 * already a calculated value, as displayed in the screenshot, but you're
 * recalculating it somewhere else. That seems ripe for drift. Just do one
 * calculation (that includes labor) and use it everywhere."
 *
 * He was right, and the drift was not hypothetical: the block said $0.53 per
 * donut while `elementCost` said $0.17, because one charged the prep time and
 * the other did not. Two answers to "what does one of these cost" is exactly
 * the disease decision 11 exists to cure, and having them in two modules is
 * how it got missed.
 *
 * So this is the calculation, and `elementCost` reads its chosen column rather
 * than doing the arithmetic again. It lives HERE, in the costing module, and
 * `lib/recipeCosts` re-exports it for the block that renders it — the block is
 * a view of the calculation, not the home of it.
 */

/**
 * What the matrix needs of a line — its name and its scaling, nothing else.
 *
 * Deliberately looser than `CostLine`: the matrix reads the prep and yield
 * ROWS, which carry no element and no id it cares about. A `CostLine` is
 * assignable to it, so the resolver can hand its own lines straight over.
 */
export type MatrixLine = ScalableLine & { label: string | null };

export type CostColumnFigures = {
  column: ScaleColumn;
  /** What the ingredients come to at this batch size. */
  ingredients: number | null;
  /** The prep-time row at this column, in hours. */
  laborHours: number | null;
  labor: number | null;
  subtotal: number | null;
  /** The expected-yield row at this column. */
  yieldQty: number | null;
  yieldUnit: string | null;
  /** Subtotal ÷ yield — what one donut costs to make at this batch size. */
  costPer: number | null;
  /** The column this recipe is costed at (migration 042). */
  isDefault: boolean;
};

/**
 * Every batch column, costed.
 *
 * INGREDIENTS SCALE AND LABOUR DOES NOT, which is the whole reason this matrix
 * is worth printing rather than one figure. Ten times the batch is ten times the
 * flour and nowhere near ten times the work — Banana Cake Donut v10 runs 0.5
 * hours at its smallest batch and 0.7 at its largest — so the cost of one donut
 * falls as the batch grows, and by a lot: FileMaker's own sheet reads $3.08 at
 * the test batch against $0.61 at ×1. A recipe costed only at its base column
 * would price the shop's actual output nearly five times too high.
 *
 * Labour is charged at the WORKING LOCATION's rate. It is a fact about the shop
 * doing the making, not about the recipe, so a recipe read at DF01 and at EVENT
 * legitimately costs different amounts to produce.
 */
export function recipeCostMatrix({
  columns,
  lines,
  baseIngredientCost,
  laborRate,
  costColumn,
}: {
  columns: readonly ScaleColumn[];
  lines: readonly MatrixLine[];
  /** What the ingredients cost at the BASE column, from `versionBatchCost`. */
  baseIngredientCost: number | null;
  /** The shop's hourly rate — `locations.labor_rate`. Null charges no labour
   *  rather than charging zero, which are different claims. */
  laborRate: number | null;
  /** Migration 042. Null = the base column. */
  costColumn: number | null;
}): CostColumnFigures[] {
  // A version with NO strip at all still has one batch — the amounts on its
  // lines. 11 of the 493 are like this, and without an implicit base column
  // they would cost nothing at all and the block would render empty. The
  // synthesised column is unnamed on purpose: there is no name to show, and
  // inventing one ("Base") would put a word on the sheet FileMaker never had.
  const priced = columns.filter((c) => !c.isPercent);
  const withBase: readonly ScaleColumn[] = priced.length
    ? priced
    : [{ label: "", multiplier: 1, isPercent: false, index: 0 }];
  const baseColumn = withBase[0] ?? null;
  const baseIndex = baseColumn?.index ?? 0;
  const base = baseColumn?.multiplier ?? 1;

  const prep = metadataLine(lines, "prep");
  const yields = metadataLine(lines, "yield");

  // A cost column pointing at a slot this version doesn't have — the strip was
  // shortened after somebody chose it — falls back to the base rather than
  // marking nothing, so the block always says which column it is quoting.
  const chosen = withBase.some((c) => c.index === costColumn) ? costColumn : baseIndex;

  return withBase.map((column) => {
    const factor = column.multiplier / (base || 1);
    const ingredients = baseIngredientCost === null ? null : baseIngredientCost * factor;

    const prepCell = prep ? columnCell(prep, column, base, baseIndex) : null;
    const laborHours = prepCell?.qty ?? null;
    const labor = laborHours === null || laborRate === null ? null : laborHours * laborRate;

    const subtotal =
      ingredients === null && labor === null ? null : (ingredients ?? 0) + (labor ?? 0);

    const yieldCell = yields ? columnCell(yields, column, base, baseIndex) : null;
    const yieldQty = yieldCell?.qty ?? null;

    return {
      column,
      ingredients,
      laborHours,
      labor,
      subtotal,
      yieldQty,
      yieldUnit: yieldCell?.unit ?? null,
      costPer: subtotal === null || !yieldQty ? null : subtotal / yieldQty,
      isDefault: column.index === chosen,
    };
  });
}

/** The figures for the column this recipe is costed at — the block's headline. */
export function defaultColumn(matrix: CostColumnFigures[]): CostColumnFigures | null {
  return matrix.find((c) => c.isDefault) ?? matrix[0] ?? null;
}

/**
 * HOW MANY A BATCH MAKES — the Expected Yield row at the column the recipe is
 * costed at, and nothing else.
 *
 * The same answer `elementCost` divides by, reached without walking the graph:
 * production wants the yield without wanting the money, and pricing a whole BOM
 * to read one row would also report cost gaps as production gaps. Passing null
 * for both money inputs is not a trick — the matrix computes each column's
 * yield from the lines regardless, and `costPer` is simply the figure we are
 * not asking for.
 *
 * This is what makes `lib/productionSchedule` able to state a night's dough in
 * batches without a second definition of a batch (Mark, 2026-08-13: "the
 * expected yield IS the portion of a batch").
 */
export function batchYield(element: CostElement): { qty: number | null; unit: string | null } {
  const version = element.master;
  if (!version) return { qty: null, unit: null };
  const chosen = defaultColumn(
    recipeCostMatrix({
      columns: scaleColumns(version.scale_labels ?? null, version.scale_multipliers ?? null),
      lines: version.lines,
      baseIngredientCost: null,
      laborRate: null,
      costColumn: version.cost_column ?? null,
    })
  );
  return { qty: chosen?.yieldQty ?? null, unit: chosen?.yieldUnit ?? null };
}
