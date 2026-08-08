#!/usr/bin/env node
/**
 * Restaurant Friend — FMP production items → production-items.json (037).
 *
 *   node transform-production-items.mjs           # dry run
 *   node transform-production-items.mjs --write   # writes ../../FMP Export/transformed/
 *
 * Five source files into six tables. Run `transform-production.mjs` first —
 * this one resolves elements by their `legacy_id`, so 036's catalog has to
 * exist before 037's items can point at it.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THIS SCRIPT IS FOR
 *
 * 1. SPLITTING THE BOM. FileMaker states what an item is made of twice —
 *    `_idBase_t` (the dough) and `_dependencies` (everything else) — and the
 *    two overlap on 84 of 216 items. Loading both would count the dough twice
 *    on those; loading only dependencies would lose it on the other 132. The
 *    base becomes a column, dependencies become edges, and any edge naming the
 *    item's own base is dropped with a report.
 *
 * 2. COLLAPSING THE PRICE GRID. 125 rows are 40 (class, tier) cells copied
 *    across four locations, and DF01/DF02/DF03 agree on all 40. They become 40
 *    org rows plus an override wherever a location disagrees — measured, that
 *    is EVENT on 5 cells and nothing else.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const OUT = resolve(DATA, 'production-items.json');
const CATALOG = resolve(DATA, 'production-catalog.json');
const APPLY = process.argv.includes('--write');

const GS = String.fromCharCode(0x1d);

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function table(path, label, fields) {
  if (!existsSync(path)) { console.error(`No ${path}`); process.exit(1); }
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0].map((h) => h.trim());
  const positions = new Map();
  header.forEach((h, i) => {
    const k = h.toLowerCase();
    if (!positions.has(k)) positions.set(k, []);
    positions.get(k).push(i);
  });
  const F = {}, missing = [];
  for (const [key, { names, required = true }] of Object.entries(fields)) {
    const i = names.map((n) => positions.get(n.toLowerCase())?.[0]).find((v) => v !== undefined);
    if (i === undefined && required) missing.push(`${key} (tried ${names.join(', ')})`);
    F[key] = i;
  }
  if (missing.length) {
    console.error(`${label} is missing:`);
    for (const m of missing) console.error(`  · ${m}`);
    console.error(`\nColumns present: ${header.join(', ')}`);
    process.exit(1);
  }
  return {
    rows: rows.slice(1),
    g: (row, k) => (F[k] === undefined ? '' : String(row[F[k]] ?? '').trim()),
  };
}

const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const reps = (v) => String(v ?? '').split(GS).map((s) => s.trim());
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const fatal = [];
const problems = [];
const note = (m) => { if (problems.length < 4000) problems.push(m); };

/* ========================================================================== */
/* 0. The element catalog, so items can point at it                            */
/* ========================================================================== */

if (!existsSync(CATALOG)) {
  console.error(`No ${CATALOG} — run \`node transform-production.mjs --write\` first.`);
  console.error('Items reference elements by legacy_id, so 036\'s catalog has to exist.');
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
// FMP element id → our element legacy_id. The catalog's own payload carries
// the mapping, including for the rows that absorbed a duplicate.
const elementByFmpId = new Map();
for (const e of catalog.elements) {
  const fmp = e.source_payload?.fmp_element_id;
  if (fmp) elementByFmpId.set(String(fmp), e.legacy_id);
  for (const merged of e.source_payload?.merged_legacy_ids ?? []) {
    const m = /^E:(.+)$/.exec(merged);
    if (m) elementByFmpId.set(m[1], e.legacy_id);
  }
}
console.log(`Element catalog: ${catalog.elements.length} elements, ${elementByFmpId.size} FMP ids resolvable`);

/* ========================================================================== */
/* 1. Items                                                                    */
/* ========================================================================== */

const I = table(resolve(PROD, 'Production_Items.mer'), 'Production_Items.mer', {
  id: { names: ['_idDonut_t'] },
  base: { names: ['_idBase_t'] },
  name: { names: ['donutName_t'] },
  type: { names: ['donutType_t'] },
  cut: { names: ['donutTypeCut_t'] },
  finish: { names: ['donutTypeFinish_t'] },
  size: { names: ['donutSize_t'] },
  price_class: { names: ['PriceClass_t'] },
  price_tier: { names: ['PriceTier_t'] },
  cost_each: { names: ['costEach_c'] },
  price_current: { names: ['priceCurrent_c'] },
});

const items = [];
const itemByFmpId = new Map();
// Not a merge key — a REPORT. An item's name is a label, not its identity
// (migration 038): "Angry Samoa" is four different donuts. This only counts
// how often a name is shared so the report can say so out loud, because the
// first version of this script merged on it and turned 307 items into 173.
const nameCount = new Map();
const identitySeen = new Map();

for (const r of I.rows) {
  const fmpId = I.g(r, 'id');
  const name = I.g(r, 'name');
  if (!fmpId) { note(`Production_Items row with no _idDonut_t: "${name}"`); continue; }
  if (!name) { note(`Production_Items ${fmpId} has no name`); continue; }

  nameCount.set(norm(name), (nameCount.get(norm(name)) ?? 0) + 1);

  // (name, size, type, subtype) is exactly unique over all 307 rows. Nothing
  // in the schema enforces it — 038 explains why — so a collision here is
  // reported rather than refused, which is also what would happen in the app.
  const identity = [name, I.g(r, 'size'), I.g(r, 'type'), I.g(r, 'cut')].map(norm).join('|');
  if (identitySeen.has(identity)) {
    note(`two items share a name AND taxonomy: "${name}" (FMP ${fmpId} and ${identitySeen.get(identity)}) — both loaded`);
  } else identitySeen.set(identity, fmpId);

  const baseFmp = I.g(r, 'base');
  let baseLegacy = null;
  if (baseFmp) {
    baseLegacy = elementByFmpId.get(baseFmp) ?? null;
    if (!baseLegacy) note(`item "${name}" names base element ${baseFmp}, which does not exist`);
  }

  const legacy = `PI:${fmpId}`;
  items.push({
    legacy_id: legacy,
    name,
    item_type: blank(I.g(r, 'type')),
    subtype: blank(I.g(r, 'cut')),
    finish: blank(I.g(r, 'finish')),
    size: blank(I.g(r, 'size')),
    base_element_legacy_id: baseLegacy,
    price_class: blank(I.g(r, 'price_class')),
    price_tier: blank(I.g(r, 'price_tier')),
    // tally_box_size is left to 037's default of 6 — every item is 6 today
    // (measured over the real 8/7 packet: 888 boxes, all of them 6).
    is_active: true,
    source: 'filemaker',
    source_payload: {
      fmp_item_id: fmpId,
      fmp_base_element_id: baseFmp || undefined,
      // FMP's own frozen figures, kept for the diff that validates our live
      // costing rather than to be displayed. Decision 11: never a cost column.
      fmp_cost_each: num(I.g(r, 'cost_each')) ?? undefined,
      fmp_price: num(I.g(r, 'price_current')) ?? undefined,
    },
  });
  itemByFmpId.set(fmpId, legacy);
}

/* ========================================================================== */
/* 2. The BOM — dependencies, minus any edge that names the item's own base     */
/* ========================================================================== */

const D = table(resolve(PROD, '_dependencies.mer'), '_dependencies.mer', {
  id: { names: ['_id_dependency_t'] },
  item: { names: ['_id_donut_t'] },
  element: { names: ['_id_element_t'] },
  qty: { names: ['cost_qty_n'] },
  unit: { names: ['cost_unit_t'] },
});

const itemByLegacy = new Map(items.map((i) => [i.legacy_id, i]));
const edges = [];
const edgeSeen = new Set();
let droppedAsBase = 0;

for (const r of D.rows) {
  const itemLegacy = itemByFmpId.get(D.g(r, 'item'));
  if (!itemLegacy) { note(`dependency ${D.g(r, 'id')} names item ${D.g(r, 'item')}, which does not exist`); continue; }
  const elementLegacy = elementByFmpId.get(D.g(r, 'element'));
  if (!elementLegacy) { note(`dependency ${D.g(r, 'id')} names element ${D.g(r, 'element')}, which does not exist`); continue; }

  const item = itemByLegacy.get(itemLegacy);
  // THE MERGE. An edge naming the item's own dough is dropped: its quantity is
  // derived from the batch-yield rule, not stored, and keeping both would cost
  // the dough twice. 84 of these, 41 carrying no quantity at all.
  if (item && item.base_element_legacy_id === elementLegacy) { droppedAsBase++; continue; }

  const pair = `${itemLegacy}|${elementLegacy}`;
  if (edgeSeen.has(pair)) { note(`duplicate BOM edge ${pair} — kept the first`); continue; }
  edgeSeen.add(pair);

  edges.push({
    legacy_id: `PIE:${D.g(r, 'id')}`,
    item_legacy_id: itemLegacy,
    element_legacy_id: elementLegacy,
    qty: num(D.g(r, 'qty')),
    unit: blank(D.g(r, 'unit')),
    sort: null,
  });
}

/* ========================================================================== */
/* 3. Per-location pars                                                        */
/* ========================================================================== */

const P = table(resolve(PROD, '_donutpars.mer'), '_donutpars.mer', {
  id: { names: ['_id_donutPars_t'] },
  item: { names: ['_id_donut_t'] },
  location: { names: ['location_t'] },
  par: { names: ['par_array_n'] },
});

// Mark, 2026-08-07: "honestly can't remember, can skip for now."
const SKIP_LOCATIONS = new Set(['WHOLESALE']);

const itemLocations = [];
let skippedWholesale = 0, skippedNoLocation = 0;
for (const r of P.rows) {
  const itemLegacy = itemByFmpId.get(P.g(r, 'item'));
  if (!itemLegacy) { note(`par row ${P.g(r, 'id')} names item ${P.g(r, 'item')}, which does not exist`); continue; }
  const code = blank(P.g(r, 'location'));
  if (!code) { skippedNoLocation++; continue; }
  if (SKIP_LOCATIONS.has(code.toUpperCase())) { skippedWholesale++; continue; }

  const par = reps(P.g(r, 'par')).slice(0, 7).map(num);
  while (par.length < 7) par.push(null);

  itemLocations.push({
    legacy_id: `PIL:${P.g(r, 'id')}`,
    item_legacy_id: itemLegacy,
    location_code: code,
    par_by_weekday: par.some((v) => v !== null) ? par : null,
    price_override: null,      // filled from _prices below
  });
}

/* -- item-level price overrides ------------------------------------------- */

const O = table(resolve(PROD, '_prices.mer'), '_prices.mer', {
  id: { names: ['_PrimaryKey'] },
  item: { names: ['donutID_t'] },
  location: { names: ['location_t'] },
  price: { names: ['price_n'] },
});

const byPair = new Map(itemLocations.map((l) => [`${l.item_legacy_id}|${l.location_code}`, l]));
let overridesPlaced = 0, overridesNewRow = 0;
for (const r of O.rows) {
  const itemLegacy = itemByFmpId.get(O.g(r, 'item'));
  if (!itemLegacy) { note(`price override ${O.g(r, 'id')} names item ${O.g(r, 'item')}, which does not exist`); continue; }
  const code = blank(O.g(r, 'location'));
  if (!code || SKIP_LOCATIONS.has(code.toUpperCase())) continue;
  const price = num(O.g(r, 'price'));

  const existing = byPair.get(`${itemLegacy}|${code}`);
  if (existing) { existing.price_override = price; overridesPlaced++; continue; }
  // An override on a shop with no par row for that item — the price is still a
  // real fact about that shop, so it gets a row of its own rather than being
  // dropped for want of a par.
  const row = {
    legacy_id: `PIL:price:${O.g(r, 'id')}`,
    item_legacy_id: itemLegacy,
    location_code: code,
    par_by_weekday: null,
    price_override: price,
  };
  itemLocations.push(row);
  byPair.set(`${itemLegacy}|${code}`, row);
  overridesNewRow++;
}

/* ========================================================================== */
/* 4. The price grid — collapse 125 rows to 40 + the exceptions                 */
/* ========================================================================== */

const G = table(resolve(PROD, 'Production_Item_Prices.mer'), 'Production_Item_Prices.mer', {
  id: { names: ['_PrimaryKey_t'] },
  klass: { names: ['Class_t'] },
  tier: { names: ['Tier_t'] },
  location: { names: ['Location_t'] },
  price: { names: ['Price_n'] },
});

const cells = new Map();     // "class|tier" → { class, tier, byLocation }
for (const r of G.rows) {
  const klass = blank(G.g(r, 'klass'));
  const tier = blank(G.g(r, 'tier'));
  const code = blank(G.g(r, 'location'));
  if (!klass || !tier || !code) { note(`price grid row ${G.g(r, 'id')} is incomplete`); continue; }
  const key = `${klass}|${tier}`;
  if (!cells.has(key)) cells.set(key, { price_class: klass, price_tier: tier, byLocation: {} });
  cells.get(key).byLocation[code] = num(G.g(r, 'price'));
}

// The org price is the MAJORITY answer across locations; anything else becomes
// an override. Majority rather than "DF01's value" so the grid stays right if
// the odd shop out ever changes.
const TIER_SORT = (t) => { const m = /(\d+)/.exec(t ?? ''); return m ? Number(m[1]) : null; };
const CLASS_ORDER = ['Regular', 'Mini', 'Giant', 'Letter', 'Special', 'Delivery', 'Event', 'Wholesale'];

const grid = [];
const gridOverrides = [];
for (const cell of cells.values()) {
  const counts = new Map();
  for (const price of Object.values(cell.byLocation)) {
    const k = price === null ? 'null' : String(price);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [winner] = [...counts].sort((a, b) => b[1] - a[1]);
  const orgPrice = winner[0] === 'null' ? null : Number(winner[0]);

  const key = `PG:${cell.price_class}|${cell.price_tier}`;
  grid.push({
    legacy_id: key,
    price_class: cell.price_class,
    price_tier: cell.price_tier,
    price: orgPrice,
    class_sort: CLASS_ORDER.indexOf(cell.price_class) >= 0 ? CLASS_ORDER.indexOf(cell.price_class) : null,
    tier_sort: TIER_SORT(cell.price_tier),
  });
  for (const [code, price] of Object.entries(cell.byLocation)) {
    if (price === orgPrice) continue;
    gridOverrides.push({ grid_legacy_id: key, location_code: code, price });
  }
}

/* ========================================================================== */
/* 5. Batch yields — Mark's rule, seeded over FMP's structure                   */
/* ========================================================================== */

const Y = table(resolve(PROD, '_yields.mer'), '_yields.mer', {
  id: { names: ['_PrimaryKey'] },
  type: { names: ['_donutType_t'] },
  subtype: { names: ['_donutSubType_t'] },
  size: { names: ['_donutSize_t'] },
  portion: { names: ['portionOfBatch_cn'] },
  factor: { names: ['sizeFactor_n'] },
});

/**
 * Mark, 2026-08-07:
 *   "each regular donut (promise rings, bismarks, bullseyes, letters) is 1/340
 *    of a batch, mini donuts are 1/3 the size of a regular donut, giant donuts
 *    are 2x a regular donut"
 *
 * He named only the RAISED cuts, so only raised portions are replaced. The
 * export's cake and scrap portions (Vanilla 1/40, Chocolate 1/35, Banana 1/30,
 * Fritter 1/16, Old Fashioned 1/60) have no stated replacement and load as they
 * stand — inventing one would be guessing. Every change is reported.
 */
const MARK_RAISED_PORTION = 1 / 340;
const MARK_SIZE_FACTOR = { mini: 1 / 3, giant: 2 };

const yields = [];
const yieldByKey = new Map();
const yieldChanges = [];
for (const r of Y.rows) {
  const type = blank(Y.g(r, 'type'));
  if (!type) { note(`yield row ${Y.g(r, 'id')} has no type`); continue; }
  const subtype = blank(Y.g(r, 'subtype'));
  const size = blank(Y.g(r, 'size'));
  const label = `${type} / ${subtype ?? '—'} / ${size ?? '—'}`;

  let portion = num(Y.g(r, 'portion'));
  let factor = num(Y.g(r, 'factor'));

  if (norm(type) === 'raised' && portion !== null &&
      Math.abs(portion - MARK_RAISED_PORTION) > 1e-9) {
    yieldChanges.push(`${label}: portion ${portion.toFixed(7)} → ${MARK_RAISED_PORTION.toFixed(7)} (1/340, Mark)`);
    portion = MARK_RAISED_PORTION;
  }
  const sizeKey = norm(size);
  if (MARK_SIZE_FACTOR[sizeKey] !== undefined && factor !== null &&
      Math.abs(factor - MARK_SIZE_FACTOR[sizeKey]) > 1e-9) {
    yieldChanges.push(`${label}: size factor ${factor} → ${MARK_SIZE_FACTOR[sizeKey].toFixed(4)} (Mark)`);
    factor = MARK_SIZE_FACTOR[sizeKey];
  }

  // 037 keys this (type, subtype, size) with a coalesced unique index, because
  // a rule the resolver could match twice has two answers. FileMaker has one
  // real duplicate — (Raised, Letter, Regular) twice, with identical values —
  // found by replaying into the harness rather than by reading. Merge with a
  // report; say so loudly if the two ever DISAGREE, because then somebody has
  // to choose and it must not be this script.
  const key = [norm(type), norm(subtype), norm(size)].join('|');
  const seen = yieldByKey.get(key);
  if (seen) {
    const same = seen.portion_of_batch === portion && seen.size_factor === factor;
    note(same
      ? `duplicate yield rule ${label} — identical, merged`
      : `duplicate yield rule ${label} DISAGREES: kept portion ${seen.portion_of_batch} / factor ${seen.size_factor}, dropped ${portion} / ${factor}`);
    continue;
  }
  const row = {
    legacy_id: `BY:${Y.g(r, 'id')}`,
    item_type: type,
    subtype,
    size,
    portion_of_batch: portion,
    size_factor: factor,
  };
  yieldByKey.set(key, row);
  yields.push(row);
}

// The sizes the ITEMS use, so a size with no rule is visible rather than
// silently costing nothing.
const itemSizes = new Set(items.map((i) => norm(i.size)).filter(Boolean));
const yieldSizes = new Set(yields.map((y) => norm(y.size)).filter(Boolean));
const sizesWithNoRule = [...itemSizes].filter((s) => !yieldSizes.has(s));

/* ========================================================================== */
/* 6. Report                                                                   */
/* ========================================================================== */

console.log(`\n── ITEMS ──`);
console.log(`  ${I.rows.length} source rows → ${items.length} items`);
console.log(`  ${items.filter((i) => i.base_element_legacy_id).length} carry a base element (the dough)`);
// The number that caught the bug: a NAME is not an identity here.
const shared = [...nameCount.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
console.log(`  ${nameCount.size} distinct NAMES — ${shared} items share a name with another size or cut`);
console.log(`    (e.g. "Angry Samoa" is a Regular Cake, a Mini Raised, a Letter and a Giant)`);
const typeCount = new Map();
for (const i of items) typeCount.set(i.item_type ?? '(none)', (typeCount.get(i.item_type ?? '(none)') ?? 0) + 1);
console.log(`  ${typeCount.size} types: ${[...typeCount].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t} ${n}`).join(' · ')}`);

console.log(`\n── THE BOM ──`);
console.log(`  ${D.rows.length} dependency rows → ${edges.length} edges`);
console.log(`  ${droppedAsBase} dropped as duplicates of the item's own base element`);
console.log(`  ${edges.filter((e) => e.qty === null).length} edges carry NO quantity (they cost nothing and say so)`);

console.log(`\n── PER-LOCATION ──`);
console.log(`  ${P.rows.length} par rows → ${itemLocations.length} item-location rows`);
console.log(`    ${skippedWholesale} WHOLESALE rows skipped (Mark: "can skip for now")`);
if (skippedNoLocation) console.log(`    ${skippedNoLocation} skipped for having no location`);
const locCount = new Map();
for (const l of itemLocations) locCount.set(l.location_code, (locCount.get(l.location_code) ?? 0) + 1);
console.log(`    ${[...locCount].map(([c, n]) => `${c} ${n}`).join(' · ')}`);
console.log(`  ${overridesPlaced + overridesNewRow} item price overrides (${overridesNewRow} needed a new row)`);

console.log(`\n── THE PRICE GRID ──`);
console.log(`  ${G.rows.length} source rows → ${grid.length} org cells + ${gridOverrides.length} location overrides`);
if (gridOverrides.length) {
  const byLoc = new Map();
  for (const o of gridOverrides) byLoc.set(o.location_code, (byLoc.get(o.location_code) ?? 0) + 1);
  console.log(`    overrides by location: ${[...byLoc].map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  for (const o of gridOverrides.slice(0, 8)) {
    const cell = grid.find((g) => g.legacy_id === o.grid_legacy_id);
    console.log(`      ${cell.price_class} ${cell.price_tier}: org ${cell.price} → ${o.location_code} ${o.price}`);
  }
}

console.log(`\n── BATCH YIELDS ──`);
console.log(`  ${Y.rows.length} source rows → ${yields.length} rules`);
if (yieldChanges.length) {
  console.log(`  ${yieldChanges.length} value(s) replaced with MARK'S RULE (the export is stale):`);
  for (const c of yieldChanges.slice(0, 12)) console.log(`      ${c}`);
  if (yieldChanges.length > 12) console.log(`      … and ${yieldChanges.length - 12} more`);
}
if (sizesWithNoRule.length) {
  console.log(`  sizes used by items with NO yield rule: ${sizesWithNoRule.join(', ')}`);
  console.log(`    (those items' dough costs nothing until a rule is added — visible, not silent)`);
}

/* -- identity -------------------------------------------------------------- */

console.log(`\n── IDENTITY ──`);
for (const [label, rows] of [
  ['items', items], ['bom edges', edges], ['item-locations', itemLocations],
  ['price grid', grid], ['batch yields', yields],
]) {
  const ids = rows.map((r) => r.legacy_id);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const collisions = [...seen].filter(([, n]) => n > 1);
  console.log(`  ${String(label).padEnd(16)} ${String(rows.length).padStart(4)} rows, ${new Set(ids).size} distinct legacy_id`);
  if (collisions.length) fatal.push(`${label}: ${collisions.length} legacy_id collisions`);
}
// 037 makes (item, location) unique.
const pairSeen = new Map();
for (const l of itemLocations) {
  const k = `${l.item_legacy_id}|${l.location_code}`;
  pairSeen.set(k, (pairSeen.get(k) ?? 0) + 1);
}
const pairDupes = [...pairSeen].filter(([, n]) => n > 1);
if (pairDupes.length) fatal.push(`${pairDupes.length} duplicate (item, location) rows, e.g. ${pairDupes[0][0]}`);

if (problems.length) {
  console.log(`\n── ${problems.length} NOTE(S) ──`);
  for (const p of problems.slice(0, 30)) console.log(`  · ${p}`);
  if (problems.length > 30) console.log(`  … and ${problems.length - 30} more`);
}

if (fatal.length) {
  console.error(`\n── REFUSING TO WRITE ──`);
  for (const f of fatal) console.error(`  x ${f}`);
  process.exit(1);
}

const payload = { items, edges, item_locations: itemLocations, grid, grid_overrides: gridOverrides, yields };
console.log(`\n${items.length} items · ${edges.length} edges · ${itemLocations.length} item-locations · ` +
  `${grid.length} grid cells · ${gridOverrides.length} grid overrides · ${yields.length} yield rules`);

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --write.\n`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nWrote ${OUT}\n`);
