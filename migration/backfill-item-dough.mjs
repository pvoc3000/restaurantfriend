/**
 * Move each item's DOUGH out of `production_items.base_element_id` and into the
 * component list, where every other thing an item is made of already lives.
 *
 * Mark, 2026-08-13: "get rid of the 'dough' field on production items. It's not
 * necessary and doubles existing data. Components live in the component list
 * only." And, the same day, on why the field was wrong in the first place:
 * "Items can be anything. They don't even have to be a donut. Assuming they're
 * donuts, or that they are a specific kind of donut, is weird and wrong."
 *
 * ---------------------------------------------------------------------------
 * THE COLUMN CANNOT SIMPLY BE DROPPED.
 *
 * "It doubles existing data" was true of FileMaker, where the dough sat in
 * `_idBase_t` AND in `_dependencies` and the two overlapped on 84 of 216 items.
 * It is NOT true of this database: the 036 loader resolved that overlap by
 * dropping any dependency edge that named the item's own base, so measured
 * today ZERO of the 216 items carry their base as a component edge. Drop the
 * column with no backfill and every one of them silently loses its dough — the
 * largest single component of a donut's cost.
 *
 * So this script writes the edges first. Migration 045 drops the column after.
 *
 * ---------------------------------------------------------------------------
 * WHAT QUANTITY THE EDGE CARRIES
 *
 * An item does not store how much dough it uses, because until now the amount
 * was DERIVED from `production_batch_yields` — a table of (item_type, subtype,
 * size) triples. Since 2026-08-13 costing reads the dough's own recipe yield,
 * so all that table still contributed was `size_factor`: a regular donut is one
 * unit of its dough, a mini a third, a giant more.
 *
 * That is exactly what an edge quantity is. So the edge takes `size_factor` as
 * its qty, in the dough's own yield unit, and `production_batch_yields` loses
 * its last reader. The (type, subtype, size) triples go with it, and with them
 * the assumption that an item is a known kind of donut.
 *
 * NOTHING IS INVENTED FOR THE ITEMS THE TABLE COULD NOT ANSWER. 58 of the 216
 * match no rule — 33 of them `Raised/Promise Ring/Giant`, because the rules
 * treat "Giant" as a SUBTYPE while the items use it as a SIZE — and their dough
 * has therefore cost nothing all along. They get an edge with a NULL qty, which
 * costs nothing and reports itself as a gap exactly as today, but is now a box
 * on the item's own screen rather than a missing row in a shared table. Filling
 * them in is Mark's, not this script's: the Giant factor is 4 in the seeded data
 * and 2 in his own stated rule, and that is a number to type, not to guess.
 *
 * Idempotent: an item that already carries an edge for its base is skipped, so
 * a second run writes nothing.
 *
 *   node --env-file=.env backfill-item-dough.mjs          # dry run
 *   node --env-file=.env backfill-item-dough.mjs --apply
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BUILD = new URL("../web/.fixtures-build/src/lib/", import.meta.url).pathname;

// `batchYield` is LIVE app code, so it is imported rather than copied — the
// unit an edge is written in has to be the unit costing will read it in.
const { batchYield } = await import(`${BUILD}productionCost.js`).catch(() => {
  throw new Error(
    "web/.fixtures-build is missing — run `npm run fixtures` in web/ first.\n" +
      "This script imports the app's OWN `batchYield` rather than copying it."
  );
});

/**
 * `matchYield`, FROZEN — a copy on purpose, where `batchYield` above is not.
 *
 * This rule is the thing being retired: the app deleted it in the same commit
 * that added this script, because looking a quantity up by (item_type, subtype,
 * size) is the assumption Mark objected to. A one-shot script that reproduces
 * a rule's LAST answer has to carry that rule with it, or it stops running the
 * moment the rule is gone — which is exactly what happened on the first try.
 *
 * Verbatim from `lib/productionCost` at 5dcc439. Most specific match wins; null
 * in a stored rule means "any".
 */
function matchYield(item, yields) {
  const eq = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const candidates = yields.filter(
    (y) =>
      eq(y.item_type, item.item_type) &&
      (y.subtype === null || eq(y.subtype, item.subtype)) &&
      (y.size === null || eq(y.size, item.size))
  );
  if (!candidates.length) return null;
  const score = (y) => (y.subtype === null ? 0 : 1) + (y.size === null ? 0 : 1);
  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** PostgREST caps a select at 1,000 rows and says nothing about it. */
async function all(table, select, order = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(order)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const [items, edges, yieldRows, elements, recipes, versions, lines] = await Promise.all([
  all("production_items", "id, org_id, name, item_type, subtype, size, base_element_id"),
  all("production_item_elements", "id, item_id, element_id"),
  all("production_batch_yields", "item_type, subtype, size, portion_of_batch, size_factor", "item_type"),
  all("production_elements", "id, name"),
  all("production_recipes", "id, element_id, name"),
  all("production_recipe_versions", "id, recipe_id, is_master, scale_labels, scale_multipliers, cost_column"),
  all("production_recipe_lines", "id, version_id, label, qty, unit, scale_auto, scale_amounts, scale_units"),
]);

/* -- the doughs' recipes, only enough of them to read a yield --------------- */

const linesByVersion = new Map();
for (const l of lines) {
  const g = linesByVersion.get(l.version_id) ?? [];
  g.push({
    id: l.id,
    label: l.label,
    qty: l.qty === null ? null : Number(l.qty),
    unit: l.unit,
    element_id: null,
    scaleAuto: l.scale_auto !== false,
    scaleAmounts:
      (l.scale_amounts ?? null)?.map((n) => (n === null || n === "" ? null : Number(n))) ?? null,
    scaleUnits: l.scale_units ?? null,
  });
  linesByVersion.set(l.version_id, g);
}
const masterByRecipe = new Map();
for (const v of versions.filter((v) => v.is_master)) masterByRecipe.set(v.recipe_id, v);

// The element's master is the master of its FIRST recipe family by name — the
// tiebreak `loadProductionGraph` makes, so this cannot pick a different version
// of a dough than the app will.
const masterByElement = new Map();
for (const r of recipes.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
  const m = masterByRecipe.get(r.id);
  if (m && !masterByElement.has(r.element_id)) masterByElement.set(r.element_id, m);
}

const elementName = new Map(elements.map((e) => [e.id, e.name]));
const yieldUnitOf = (elementId) => {
  const m = masterByElement.get(elementId);
  if (!m) return null;
  return batchYield({
    id: elementId,
    name: elementName.get(elementId) ?? "",
    kind: "made",
    manual_cost: null,
    manual_cost_unit: null,
    master: {
      id: m.id,
      lines: linesByVersion.get(m.id) ?? [],
      scale_labels: m.scale_labels,
      scale_multipliers: m.scale_multipliers,
      cost_column: m.cost_column === null || m.cost_column === undefined ? null : Number(m.cost_column),
    },
  }).unit;
};

/* -- the plan -------------------------------------------------------------- */

const yields = yieldRows.map((y) => ({
  ...y,
  portion_of_batch: y.portion_of_batch === null ? null : Number(y.portion_of_batch),
  size_factor: y.size_factor === null ? null : Number(y.size_factor),
}));

const hasEdge = new Set(edges.map((e) => `${e.item_id}|${e.element_id}`));

const planned = [];
const skipped = [];
const noQty = [];

for (const item of items) {
  if (!item.base_element_id) continue;
  if (hasEdge.has(`${item.id}|${item.base_element_id}`)) {
    skipped.push(item.name);
    continue;
  }
  const rule = matchYield(item, yields);
  const qty = rule && rule.size_factor !== null ? Number(rule.size_factor) : null;
  if (qty === null) noQty.push(`${item.name} [${item.item_type}/${item.subtype}/${item.size}]`);
  planned.push({
    org_id: item.org_id,
    item_id: item.id,
    element_id: item.base_element_id,
    qty,
    unit: yieldUnitOf(item.base_element_id),
    // The base leads the component list. Every existing edge has a null sort,
    // which falls to the end, so 0 puts the dough first without touching them.
    sort: 0,
    _name: item.name,
    _dough: elementName.get(item.base_element_id) ?? "?",
  });
}

console.log(`items with a base element : ${items.filter((i) => i.base_element_id).length}`);
console.log(`already a component edge   : ${skipped.length}`);
console.log(`edges to write             : ${planned.length}`);
console.log(`  of those, NO quantity    : ${noQty.length}  (no size rule matched — costs nothing, same as today)`);

const units = new Map();
for (const p of planned) units.set(p.unit ?? "(none)", (units.get(p.unit ?? "(none)") ?? 0) + 1);
console.log(`  units                    : ${[...units].map(([k, v]) => `${k}:${v}`).join("  ")}`);

const qtys = new Map();
for (const p of planned) qtys.set(String(p.qty), (qtys.get(String(p.qty)) ?? 0) + 1);
console.log(`  quantities               : ${[...qtys].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`);

console.log(`\nfirst 8:`);
for (const p of planned.slice(0, 8)) {
  console.log(`  ${p._name.slice(0, 30).padEnd(31)} ${String(p.qty ?? "—").padEnd(8)} ${(p.unit ?? "").padEnd(4)} of ${p._dough}`);
}
if (noQty.length) {
  console.log(`\nno quantity (type a number on the item's own screen):`);
  for (const n of noQty.slice(0, 10)) console.log(`  ${n}`);
  if (noQty.length > 10) console.log(`  … and ${noQty.length - 10} more`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
  process.exit(0);
}

const rows = planned.map(({ _name, _dough, ...row }) => row);
for (let i = 0; i < rows.length; i += 200) {
  const { error } = await supabase.from("production_item_elements").insert(rows.slice(i, i + 200));
  if (error) throw new Error(`insert failed at row ${i}: ${error.message}`);
}
console.log(`\nWROTE ${rows.length} component edges.`);
console.log(`Now apply migration 045 to drop production_items.base_element_id.`);
