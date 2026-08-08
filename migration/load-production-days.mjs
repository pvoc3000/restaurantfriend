#!/usr/bin/env node
/**
 * Restaurant Friend — load production-days.json into migration 040's
 * `production_element_days`, plus the stock-up pars it recovers for 036's
 * `production_element_locations`.
 *
 *   node --env-file=.env load-production-days.mjs           # loads; refuses if not empty
 *   node --env-file=.env load-production-days.mjs --wipe    # replaces the FileMaker rows
 *
 * Run `transform-production-days.mjs --write` first, and run this AFTER
 * `load-production.mjs` — every batch points at an element, and the stock-up
 * pars land on element-location rows phase 1 created.
 *
 * `--wipe` deletes only `source = 'filemaker'` batches, so anything typed in
 * the app survives a reload. It never deletes an element-location row: those
 * belong to phase 1 and this only fills three columns 036 left empty.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'production-days.json');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env load-production-days.mjs');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-production-days.mjs --write\` first.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => {
  console.error(`FAILED at ${step}:`, error?.message ?? error);
  process.exit(1);
};

const data = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${data.element_days.length} batches and ${data.element_locations.length} stock-up pars from ${IN}`);

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

const elementByLegacy = new Map();
for (let from = 0; ; from += 1000) {
  const { data: rows, error } = await db
    .from('production_elements')
    .select('id, legacy_id, name')
    .eq('org_id', ORG)
    .not('legacy_id', 'is', null)
    .order('legacy_id')                 // an unordered .range() sweep overlaps pages
    .range(from, from + 999);
  if (error) die('production_elements', error);
  for (const r of rows) elementByLegacy.set(String(r.legacy_id), r);
  if (rows.length < 1000) break;
}
console.log(`Resolved ${elementByLegacy.size} elements`);
if (elementByLegacy.size === 0) {
  console.error('\nNo elements. Run `load-production.mjs` first — a batch has nothing to point at.');
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* 2. Refuse, or wipe                                                          */
/* -------------------------------------------------------------------------- */

// .limit(1) and never a HEAD count. A HEAD response has no body to carry an
// error, so a missing table or a policy refusal reads as "zero rows" and the
// loader cheerfully proceeds — the trap 039's probe fell into.
const { data: existing, error: exErr } = await db
  .from('production_element_days').select('id').limit(1);
if (exErr) die('checking production_element_days (is migration 040 applied?)', exErr);

if (existing.length && !WIPE) {
  console.error('\nproduction_element_days is not empty. Re-run with --wipe to replace the');
  console.error('FileMaker rows (anything created in the app is left alone).');
  process.exit(1);
}
if (WIPE) {
  const { error } = await db.from('production_element_days')
    .delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (error) die('wiping production_element_days', error);
  console.log('Wiped the FileMaker batches.');
}

/* -------------------------------------------------------------------------- */
/* 3. The batches                                                              */
/* -------------------------------------------------------------------------- */

const skipped = [];
const rows = [];
for (const d of data.element_days) {
  const element = elementByLegacy.get(d.element_legacy_id);
  if (!element) { skipped.push(`element ${d.element_legacy_id} is not in the catalog`); continue; }
  const locationId = locationByCode.get(d.location_code);
  if (!locationId) { skipped.push(`kitchen ${d.location_code} is not a location`); continue; }

  rows.push({
    org_id: ORG,
    element_id: element.id,
    location_id: locationId,
    weekday: d.weekday,
    shift: d.shift,
    batch_label: d.batch_label,
    sort: d.sort,
    occurrence: d.occurrence,
    batch_amount: d.batch_amount,
    batch_unit: d.batch_unit,
    is_excluded: d.is_excluded,
    note: d.note,
    legacy_id: d.legacy_id,
    source: 'filemaker',
    source_payload: d.source_payload,
  });
}

for (let i = 0; i < rows.length; i += BATCH) {
  const { error } = await db.from('production_element_days').insert(rows.slice(i, i + BATCH));
  if (error) die(`inserting batches ${i}–${i + BATCH}`, error);
}
console.log(`Loaded ${rows.length} batches.`);

/* -------------------------------------------------------------------------- */
/* 4. The stock-up pars                                                        */
/* -------------------------------------------------------------------------- */
//
// An UPSERT on 036's `unique (element_id, location_id)`, carrying only the
// three stock columns — so `par_by_weekday` and `yield_by_weekday`, which phase
// 1 loaded from `_elementpars.mer`, are untouched on a row that already exists.
//
// A par that did NOT parse ("x4", "2 Pan?", "?") is written to `notes` instead
// of being dropped, and ONLY where the row has no note yet: overwriting
// something a human typed to make room for a string we couldn't read would be
// the wrong trade in both directions.

const { data: existingLocs, error: elErr } = await db
  .from('production_element_locations')
  .select('element_id, location_id, notes')
  .eq('org_id', ORG);
if (elErr) die('reading production_element_locations', elErr);
const noteByPair = new Map(existingLocs.map((r) => [`${r.element_id}|${r.location_id}`, r.notes]));

const parRows = [];
let unparsed = 0, keptNote = 0;
for (const p of data.element_locations) {
  const element = elementByLegacy.get(p.element_legacy_id);
  if (!element) { skipped.push(`stock-up par names element ${p.element_legacy_id}, not in the catalog`); continue; }
  const locationId = locationByCode.get(p.location_code);
  if (!locationId) { skipped.push(`stock-up par names kitchen ${p.location_code}, not a location`); continue; }

  const row = {
    org_id: ORG,
    element_id: element.id,
    location_id: locationId,
    stock_count: p.stock_count,
    stock_size: p.stock_size,
    stock_unit: p.stock_unit,
  };

  if (p.stock_count === null) {
    unparsed++;
    const had = noteByPair.get(`${element.id}|${locationId}`);
    if (had) keptNote++;
    else row.notes = `Stock-up par from FileMaker: ${p.stock_raw}`;
  }
  parRows.push(row);
}

for (let i = 0; i < parRows.length; i += BATCH) {
  const { error } = await db.from('production_element_locations')
    .upsert(parRows.slice(i, i + BATCH), { onConflict: 'element_id,location_id' });
  if (error) die(`upserting stock-up pars ${i}–${i + BATCH}`, error);
}
console.log(`Upserted ${parRows.length} stock-up pars (${unparsed} unparsed, written to notes; ${keptNote} left an existing note alone).`);

/* -------------------------------------------------------------------------- */
/* 5. Verify, don't assume                                                     */
/* -------------------------------------------------------------------------- */

const count = async (table, filter = (q) => q) => {
  const { count: n, error } = await filter(
    db.from(table).select('*', { count: 'exact', head: true }).eq('org_id', ORG));
  if (error) die(`counting ${table}`, error);
  return n;
};

const loaded = await count('production_element_days');
const labelled = await count('production_element_days', (q) => q.not('batch_label', 'is', null));
const withAmount = await count('production_element_days', (q) => q.not('batch_amount', 'is', null));

console.log(`\nproduction_element_days: ${loaded} rows · ${labelled} labelled · ${withAmount} with an amount`);

// The trap this whole transform exists to avoid, asserted against the database
// rather than against the JSON: "Caramel" and "Blueberry" are real batches, and
// an integer column would have dropped them without a word.
const { data: named, error: namedErr } = await db
  .from('production_element_days')
  .select('batch_label')
  .eq('org_id', ORG)
  .not('batch_label', 'is', null)
  .order('batch_label');
if (namedErr) die('checking batch labels', namedErr);
const nonNumeric = [...new Set(named.map((r) => r.batch_label).filter((l) => !/^\d+$/.test(l)))];
console.log(`Non-numeric batch labels that survived: ${nonNumeric.join(', ') || 'NONE — that is a bug'}`);

if (skipped.length) {
  console.log(`\n── ${skipped.length} SKIPPED ──`);
  for (const s of [...new Set(skipped)].slice(0, 20)) console.log(`  · ${s}`);
}
console.log('');
