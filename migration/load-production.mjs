#!/usr/bin/env node
/**
 * Restaurant Friend — load production-catalog.json into migration 036's tables.
 *
 *   node --env-file=.env load-production.mjs           # loads; refuses if not empty
 *   node --env-file=.env load-production.mjs --wipe    # replaces the FileMaker rows
 *
 * `--wipe` deletes only `source = 'filemaker'` rows, so anything typed in the
 * app survives a reload. Run `transform-production.mjs --write` first.
 *
 * ORDER MATTERS and is not negotiable: elements before recipes (element_id is
 * NOT NULL), recipes before versions, versions before lines and steps. A line
 * also points at an ELEMENT, so the element map has to survive the whole run.
 *
 * THE MASTER FLAG IS SET LAST, ON PURPOSE. 036 puts a partial unique index on
 * (recipe_id) where is_master, so inserting versions with their master flag
 * already set is fine — but only if the transform got it right for every
 * family. It did (it refuses to write otherwise), so they go in as-is and the
 * loader VERIFIES rather than repairs: a family with two masters means the
 * transform is wrong and should be fixed there, not patched here.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'production-catalog.json');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env load-production.mjs');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-production.mjs --write\` first.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => {
  console.error(`FAILED at ${step}:`, error?.message ?? error);
  process.exit(1);
};

const data = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${data.elements.length} elements, ${data.recipes.length} recipes from ${IN}`);

/* -------------------------------------------------------------------------- */
/* 1. Resolve the keys                                                         */
/* -------------------------------------------------------------------------- */

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name');
if (orgErr) die('orgs', orgErr);
if (orgs.length !== 1) die('orgs', new Error(`Expected exactly one org, found ${orgs.length}.`));
const ORG = orgs[0].id;

const { data: locations, error: locErr } = await db.from('locations').select('id, code');
if (locErr) die('locations', locErr);
const locationByCode = new Map(locations.map((l) => [l.code, l.id]));

// Purchased elements link to an INVENTORY ITEM, never to a vendor item —
// design rule 6: the inventory item is the stable identity and vendor items
// are its sources. FMP mapped its ingredients to VENDOR items, so the link is
// resolved through `vendor_items.legacy_id` → that row's inventory_item_id.
const vendorItemToInventory = new Map();
for (let from = 0; ; from += 1000) {
  const { data: rows, error } = await db
    .from('vendor_items')
    .select('legacy_id, inventory_item_id')
    .not('legacy_id', 'is', null)
    .order('legacy_id')                 // an unordered .range() sweep overlaps pages
    .range(from, from + 999);
  if (error) die('vendor_items', error);
  for (const r of rows) {
    if (r.inventory_item_id) vendorItemToInventory.set(String(r.legacy_id), r.inventory_item_id);
  }
  if (rows.length < 1000) break;
}
console.log(`Resolved ${vendorItemToInventory.size} vendor items → inventory items`);

/* -------------------------------------------------------------------------- */
/* 2. Refuse, or wipe                                                          */
/* -------------------------------------------------------------------------- */

// .limit(1) and never a HEAD count: a HEAD response has no body to carry an
// error message, so a policy refusal reads as "zero rows" and the loader
// cheerfully proceeds to load into a table it cannot see.
const { data: existing, error: exErr } = await db
  .from('production_elements').select('id').limit(1);
if (exErr) die('checking production_elements', exErr);

if (existing.length && !WIPE) {
  console.error('\nproduction_elements is not empty. Re-run with --wipe to replace the');
  console.error('FileMaker rows (anything created in the app is left alone).');
  process.exit(1);
}
if (WIPE) {
  // Children first: recipes RESTRICT their element, and lines/steps cascade
  // from versions but are deleted explicitly so the counts are reportable.
  for (const t of ['production_recipe_steps', 'production_recipe_lines']) {
    const { error } = await db.from(t).delete().eq('org_id', ORG).not('legacy_id', 'is', null);
    if (error) die(`wiping ${t}`, error);
  }
  for (const t of ['production_recipe_versions', 'production_recipes']) {
    const { error } = await db.from(t).delete().eq('org_id', ORG).eq('source', 'filemaker');
    if (error) die(`wiping ${t}`, error);
  }
  const { error: elErr } = await db.from('production_element_locations')
    .delete().eq('org_id', ORG).not('legacy_id', 'is', null);
  if (elErr) die('wiping production_element_locations', elErr);
  const { error: eErr } = await db.from('production_elements')
    .delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (eErr) die('wiping production_elements', eErr);
  console.log('Wiped the FileMaker rows.');
}

/* -------------------------------------------------------------------------- */
/* 3. Load                                                                     */
/* -------------------------------------------------------------------------- */

/** Insert in batches, returning every inserted row. */
async function insertAll(table, rows, select = 'id, legacy_id') {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data: got, error } = await db.from(table).insert(chunk).select(select);
    if (error) die(`${table} (batch at ${i})`, error);
    out.push(...got);
  }
  return out;
}

/* -- elements -------------------------------------------------------------- */

let unresolvedVendorKeys = 0;
const elementRows = data.elements.map((e) => {
  const inventoryId = e.vendor_item_legacy_key
    ? vendorItemToInventory.get(String(e.vendor_item_legacy_key)) ?? null
    : null;
  if (e.vendor_item_legacy_key && !inventoryId) unresolvedVendorKeys++;
  return {
    org_id: ORG,
    kind: e.kind,
    name: e.name,
    element_type: e.element_type,
    type_sort: e.type_sort,
    schedule_class: e.schedule_class,
    inventory_item_id: inventoryId,
    manual_cost: e.manual_cost,
    manual_cost_unit: e.manual_cost_unit,
    is_active: e.is_active,
    notes: e.notes,
    legacy_id: e.legacy_id,
    source: 'filemaker',
    source_payload: e.source_payload ?? null,
  };
});
const insertedElements = await insertAll('production_elements', elementRows);
const elementIdByLegacy = new Map(insertedElements.map((r) => [r.legacy_id, r.id]));
console.log(`production_elements: ${insertedElements.length}`);
console.log(`  ${elementRows.filter((r) => r.inventory_item_id).length} linked to an inventory item` +
  (unresolvedVendorKeys ? `, ${unresolvedVendorKeys} vendor keys resolved to nothing` : ''));

/* -- element locations ----------------------------------------------------- */

const missingLocations = new Set();
const elementLocationRows = data.element_locations.flatMap((el) => {
  const locationId = locationByCode.get(el.location_code);
  if (!locationId) { missingLocations.add(el.location_code); return []; }
  const elementId = elementIdByLegacy.get(el.element_legacy_id);
  if (!elementId) return [];
  return [{
    org_id: ORG,
    element_id: elementId,
    location_id: locationId,
    par_by_weekday: el.par_by_weekday,
    yield_by_weekday: el.yield_by_weekday,
    stock_count: el.stock_count,
    stock_size: el.stock_size,
    stock_unit: el.stock_unit,
    legacy_id: el.legacy_id,
  }];
});
const insertedElementLocations = await insertAll(
  'production_element_locations', elementLocationRows, 'id');
console.log(`production_element_locations: ${insertedElementLocations.length}`);
if (missingLocations.size) {
  console.log(`  location codes not in this org, skipped: ${[...missingLocations].join(', ')}`);
}

/* -- recipes --------------------------------------------------------------- */

const recipeRows = data.recipes.map((r) => {
  const elementId = elementIdByLegacy.get(r.element_legacy_id);
  if (!elementId) die('recipes', new Error(`recipe "${r.name}" has no element — the transform should have refused`));
  return {
    org_id: ORG,
    element_id: elementId,
    name: r.name,
    recipe_type: r.recipe_type,
    is_active: r.is_active,
    legacy_id: r.legacy_id,
    source: 'filemaker',
  };
});
const insertedRecipes = await insertAll('production_recipes', recipeRows);
const recipeIdByLegacy = new Map(insertedRecipes.map((r) => [r.legacy_id, r.id]));
console.log(`production_recipes: ${insertedRecipes.length}`);

/* -- versions -------------------------------------------------------------- */

const versionRows = data.recipes.flatMap((r) =>
  r.versions.map((v) => ({
    org_id: ORG,
    recipe_id: recipeIdByLegacy.get(r.legacy_id),
    version_label: v.version_label,
    version_sort: v.version_sort,
    is_master: v.is_master,
    is_active: v.is_active,
    author: v.author,
    description: v.description,
    note: v.note,
    testing_notes: v.testing_notes,
    yield_amount: v.yield_amount,
    yield_unit: v.yield_unit,
    mixer_size: v.mixer_size,
    prep_time: v.prep_time,
    shelf_life: v.shelf_life,
    storage: v.storage,
    tools: v.tools,
    scale_labels: v.scale_labels,
    scale_multipliers: v.scale_multipliers,
    legacy_id: v.legacy_id,
    source: 'filemaker',
    source_payload: v.source_payload ?? null,
  })));
const insertedVersions = await insertAll('production_recipe_versions', versionRows);
const versionIdByLegacy = new Map(insertedVersions.map((r) => [r.legacy_id, r.id]));
console.log(`production_recipe_versions: ${insertedVersions.length}`);

/* -- lines and steps ------------------------------------------------------- */

const lineRows = data.recipes.flatMap((r) => r.versions.flatMap((v) =>
  v.lines.map((l) => ({
    org_id: ORG,
    version_id: versionIdByLegacy.get(v.legacy_id),
    element_id: l.element_legacy_id ? elementIdByLegacy.get(l.element_legacy_id) ?? null : null,
    label: l.label,
    qty: l.qty,
    unit: l.unit,
    sort: l.sort,
    section: l.section,
    note: l.note,
    // Migration 041. A reload carries FileMaker's own AUTO flag and the typed
    // strip it guards, so `backfill-recipe-scales.mjs` is only ever needed on
    // data that was already loaded — it must not become the second place this
    // is decided.
    scale_auto: l.scale_auto !== false,
    scale_amounts: l.scale_amounts ?? null,
    scale_units: l.scale_units ?? null,
    hide_on_print: l.hide_on_print === true,
    legacy_id: l.legacy_id,
    source_payload: l.source_payload ?? null,
  }))));
const insertedLines = await insertAll('production_recipe_lines', lineRows, 'id');
console.log(`production_recipe_lines: ${insertedLines.length}`);

const stepRows = data.recipes.flatMap((r) => r.versions.flatMap((v) =>
  v.steps.map((s) => ({
    org_id: ORG,
    version_id: versionIdByLegacy.get(v.legacy_id),
    sort: s.sort,
    body: s.body,
    section: s.section,
    legacy_id: s.legacy_id,
  }))));
const insertedSteps = await insertAll('production_recipe_steps', stepRows, 'id');
console.log(`production_recipe_steps: ${insertedSteps.length}`);

/* -------------------------------------------------------------------------- */
/* 4. Verify                                                                   */
/* -------------------------------------------------------------------------- */

console.log('\n── SANITY ──');
const count = async (t, q = (b) => b) => {
  const { count: n, error } = await q(
    db.from(t).select('*', { count: 'exact', head: true }).eq('org_id', ORG));
  if (error) die(`counting ${t}`, error);
  return n;
};

console.log(`  elements            ${await count('production_elements')} (expected ${data.elements.length})`);
console.log(`  element-locations   ${await count('production_element_locations')} (expected ${elementLocationRows.length})`);
console.log(`  recipes             ${await count('production_recipes')} (expected ${data.recipes.length})`);
console.log(`  versions            ${await count('production_recipe_versions')} (expected ${versionRows.length})`);
console.log(`  lines               ${await count('production_recipe_lines')} (expected ${lineRows.length})`);
console.log(`  steps               ${await count('production_recipe_steps')} (expected ${stepRows.length})`);

const masters = await count('production_recipe_versions', (b) => b.eq('is_master', true));
console.log(`  masters             ${masters} (expected ${data.recipes.length} — one per family)`);
if (masters !== data.recipes.length) {
  console.error('  ^ A family without exactly one master. 036 indexes this; investigate.');
}

const uncosted = await count('production_elements', (b) =>
  b.eq('kind', 'purchased').is('inventory_item_id', null).eq('is_active', true));
console.log(`  active purchased elements with no inventory item: ${uncosted}`);
console.log('    (these render as uncosted — expected, and the catalog cleanup to do)');

console.log('\nDone.\n');
