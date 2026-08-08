#!/usr/bin/env node
/**
 * Restaurant Friend — load production-items.json into 037's tables.
 *
 *   node --env-file=.env load-production-items.mjs           # refuses if not empty
 *   node --env-file=.env load-production-items.mjs --wipe    # replaces the FileMaker rows
 *
 * NEEDS 037 AND 038. Without 038 this fails partway through on
 * `production_items_org_id_name_key`, because 134 of the 307 items share a
 * name with another size or cut — "Angry Samoa" alone is four donuts.
 *
 * Run `transform-production-items.mjs --write` first, which in turn needs
 * `transform-production.mjs --write` (items point at 036's elements).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'production-items.json');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-production-items.mjs --write\` first.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => {
  console.error(`FAILED at ${step}:`, error?.message ?? error);
  if (/production_items_org_id_name_key/.test(error?.message ?? '')) {
    console.error('\n^ That is migration 038. An item name is not unique — apply it and re-run.');
  }
  process.exit(1);
};

const data = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${data.items.length} items from ${IN}`);

/* -- keys ------------------------------------------------------------------ */

const { data: orgs, error: orgErr } = await db.from('orgs').select('id');
if (orgErr) die('orgs', orgErr);
if (orgs.length !== 1) die('orgs', new Error(`Expected one org, found ${orgs.length}.`));
const ORG = orgs[0].id;

const { data: locations, error: locErr } = await db.from('locations').select('id, code');
if (locErr) die('locations', locErr);
const locationByCode = new Map(locations.map((l) => [l.code, l.id]));

// 036's elements, by legacy_id. Paginated — PostgREST caps at 1,000 and there
// are 470 today, but a catalog grows and a silent truncation here would leave
// items pointing at nothing.
const elementByLegacy = new Map();
for (let from = 0; ; from += 1000) {
  const { data: rows, error } = await db
    .from('production_elements').select('id, legacy_id')
    .not('legacy_id', 'is', null).order('id').range(from, from + 999);
  if (error) die('production_elements', error);
  for (const r of rows) elementByLegacy.set(r.legacy_id, r.id);
  if (rows.length < 1000) break;
}
console.log(`Resolved ${elementByLegacy.size} elements`);
if (!elementByLegacy.size) {
  console.error('No elements loaded — run the 036 load first (load-production.mjs).');
  process.exit(1);
}

/* -- refuse, or wipe ------------------------------------------------------- */

const { data: existing, error: exErr } = await db.from('production_items').select('id').limit(1);
if (exErr) die('checking production_items', exErr);
if (existing.length && !WIPE) {
  console.error('\nproduction_items is not empty. Re-run with --wipe to replace the');
  console.error('FileMaker rows (anything created in the app is left alone).');
  process.exit(1);
}
if (WIPE) {
  for (const t of ['production_item_elements', 'production_item_locations']) {
    const { error } = await db.from(t).delete().eq('org_id', ORG).not('legacy_id', 'is', null);
    if (error) die(`wiping ${t}`, error);
  }
  for (const t of ['production_price_grid_locations', 'production_price_grid',
                   'production_batch_yields']) {
    const { error } = await db.from(t).delete().eq('org_id', ORG);
    if (error) die(`wiping ${t}`, error);
  }
  const { error } = await db.from('production_items')
    .delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (error) die('wiping production_items', error);
  console.log('Wiped the FileMaker rows.');
}

/* -- load ------------------------------------------------------------------ */

async function insertAll(table, rows, select = 'id, legacy_id') {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data: got, error } = await db.from(table).insert(rows.slice(i, i + BATCH)).select(select);
    if (error) die(`${table} (batch at ${i})`, error);
    out.push(...got);
  }
  return out;
}

const itemRows = data.items.map((i) => ({
  org_id: ORG,
  name: i.name,
  item_type: i.item_type,
  subtype: i.subtype,
  finish: i.finish,
  size: i.size,
  base_element_id: i.base_element_legacy_id
    ? elementByLegacy.get(i.base_element_legacy_id) ?? null : null,
  price_class: i.price_class,
  price_tier: i.price_tier,
  is_active: i.is_active,
  legacy_id: i.legacy_id,
  source: 'filemaker',
  source_payload: i.source_payload ?? null,
}));
const insertedItems = await insertAll('production_items', itemRows);
const itemByLegacy = new Map(insertedItems.map((r) => [r.legacy_id, r.id]));
console.log(`production_items: ${insertedItems.length}`);
console.log(`  ${itemRows.filter((r) => r.base_element_id).length} linked to a base element`);

const edgeRows = data.edges.flatMap((e) => {
  const itemId = itemByLegacy.get(e.item_legacy_id);
  const elementId = elementByLegacy.get(e.element_legacy_id);
  if (!itemId || !elementId) return [];
  return [{
    org_id: ORG, item_id: itemId, element_id: elementId,
    qty: e.qty, unit: e.unit, sort: e.sort, legacy_id: e.legacy_id,
  }];
});
console.log(`production_item_elements: ${(await insertAll('production_item_elements', edgeRows, 'id')).length}`);

const missingLocations = new Set();
const locationRows = data.item_locations.flatMap((l) => {
  const itemId = itemByLegacy.get(l.item_legacy_id);
  const locationId = locationByCode.get(l.location_code);
  if (!locationId) { missingLocations.add(l.location_code); return []; }
  if (!itemId) return [];
  return [{
    org_id: ORG, item_id: itemId, location_id: locationId,
    par_by_weekday: l.par_by_weekday, price_override: l.price_override,
    legacy_id: l.legacy_id,
  }];
});
console.log(`production_item_locations: ${(await insertAll('production_item_locations', locationRows, 'id')).length}`);
if (missingLocations.size) {
  console.log(`  location codes not in this org, skipped: ${[...missingLocations].join(', ')}`);
}

const gridRows = data.grid.map((g) => ({
  org_id: ORG, price_class: g.price_class, price_tier: g.price_tier,
  price: g.price, class_sort: g.class_sort, tier_sort: g.tier_sort,
}));
const insertedGrid = await insertAll('production_price_grid', gridRows, 'id, price_class, price_tier');
const gridByKey = new Map(insertedGrid.map((r) => [`PG:${r.price_class}|${r.price_tier}`, r.id]));
console.log(`production_price_grid: ${insertedGrid.length}`);

const overrideRows = data.grid_overrides.flatMap((o) => {
  const gridId = gridByKey.get(o.grid_legacy_id);
  const locationId = locationByCode.get(o.location_code);
  if (!gridId || !locationId) { missingLocations.add(o.location_code); return []; }
  return [{ org_id: ORG, grid_id: gridId, location_id: locationId, price: o.price }];
});
if (overrideRows.length) {
  const { error } = await db.from('production_price_grid_locations').insert(overrideRows);
  if (error) die('production_price_grid_locations', error);
}
console.log(`production_price_grid_locations: ${overrideRows.length}`);

const yieldRows = data.yields.map((y) => ({
  org_id: ORG, item_type: y.item_type, subtype: y.subtype, size: y.size,
  portion_of_batch: y.portion_of_batch, size_factor: y.size_factor, legacy_id: y.legacy_id,
}));
if (yieldRows.length) {
  const { error } = await db.from('production_batch_yields').insert(yieldRows);
  if (error) die('production_batch_yields', error);
}
console.log(`production_batch_yields: ${yieldRows.length}`);

/* -- verify ---------------------------------------------------------------- */

console.log('\n── SANITY ──');
const count = async (t, q = (b) => b) => {
  const { count: n, error } = await q(db.from(t).select('*', { count: 'exact', head: true }).eq('org_id', ORG));
  if (error) die(`counting ${t}`, error);
  return n;
};
console.log(`  items            ${await count('production_items')} (expected ${itemRows.length})`);
console.log(`  bom edges        ${await count('production_item_elements')} (expected ${edgeRows.length})`);
console.log(`  item-locations   ${await count('production_item_locations')} (expected ${locationRows.length})`);
console.log(`  price grid       ${await count('production_price_grid')} (expected ${gridRows.length})`);
console.log(`  grid overrides   ${await count('production_price_grid_locations')} (expected ${overrideRows.length})`);
console.log(`  batch yields     ${await count('production_batch_yields')} (expected ${yieldRows.length})`);

// The invariant 037's header names: no item lists its own dough twice.
const { data: doubled, error: dErr } = await db
  .from('production_item_elements').select('id, item_id, element_id').limit(2000);
if (!dErr) {
  const { data: bases } = await db.from('production_items').select('id, base_element_id');
  const baseById = new Map((bases ?? []).map((b) => [b.id, b.base_element_id]));
  const dupes = (doubled ?? []).filter((e) => baseById.get(e.item_id) === e.element_id);
  console.log(`  items listing their own dough as an edge: ${dupes.length} (expected 0)`);
}

console.log('\nDone.\n');
