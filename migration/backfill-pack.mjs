#!/usr/bin/env node
/**
 * Restaurant Friend — restore the vendor item pack structure (migration 010).
 *
 * FileMaker recorded a pack as UnitAmount × UnitSize UnitMeasure ("12 × 32oz").
 * The original load multiplied those into `package_content` in base units and
 * kept nothing else, so the guide could only say "1 × 24 lbs". This copies the
 * three source fields back onto vendor_items, matched by legacy_id.
 *
 * It NEVER touches package_content — that stays the base-unit total the
 * ordering math divides by. Display provenance only, so there is no conversion
 * and nothing to get arithmetically wrong.
 *
 * Requires migration 010 to have been applied first.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env backfill-pack.mjs            # dry run, writes nothing
 *     node --env-file=.env backfill-pack.mjs --apply    # actually write
 *
 * Idempotent: rerunning writes the same values. Rows whose pack fields already
 * match are skipped, so a second --apply reports 0 changes.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export', 'VendorItems.mer');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env backfill-pack.mjs');
  process.exit(1);
}
if (!existsSync(MER)) {
  console.error(`No VendorItems.mer at ${MER} (override with MER_DIR=…)`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** FileMaker .mer is CSV with quoted fields; repeating fields use 0x1D, unused here. */
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

const rows = parseCSV(readFileSync(MER, 'latin1'));
const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
for (const col of ['_PrimaryKey_n', 'UnitAmount', 'UnitSize', 'UnitMeasure']) {
  if (idx[col] === undefined) {
    console.error(`VendorItems.mer has no ${col} column — wrong export?`);
    process.exit(1);
  }
}

// FMP writes empty repetitions and stray zeros; treat both as "not recorded".
const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const fmp = new Map();
for (const r of rows.slice(1)) {
  const legacy = String(r[idx['_PrimaryKey_n']] ?? '').trim();
  if (!legacy) continue;
  fmp.set(legacy, {
    pack_count: num(r[idx['UnitAmount']]),
    pack_size: num(r[idx['UnitSize']]),
    pack_unit: String(r[idx['UnitMeasure']] ?? '').trim() || null,
  });
}
console.log(`VendorItems.mer: ${fmp.size} rows with a primary key`);

const live = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('vendor_items')
    .select('id, legacy_id, description, pack_count, pack_size, pack_unit')
    .order('id')
    .range(from, from + 999);
  if (error) { console.error('reading vendor_items:', error.message); process.exit(1); }
  live.push(...data);
  if (data.length < 1000) break;
}
console.log(`live vendor_items: ${live.length}`);

const updates = [];
let unmatched = 0, nothingToRestore = 0, alreadyCorrect = 0;

for (const vi of live) {
  if (vi.legacy_id === null || vi.legacy_id === undefined) { unmatched++; continue; }
  const src = fmp.get(String(vi.legacy_id));
  if (!src) { unmatched++; continue; }
  if (src.pack_count === null && src.pack_size === null && src.pack_unit === null) {
    nothingToRestore++;
    continue;
  }
  // The check constraint forbids a count without a size.
  if (src.pack_count !== null && src.pack_size === null) { nothingToRestore++; continue; }
  const same =
    Number(vi.pack_count ?? NaN) === Number(src.pack_count ?? NaN) &&
    Number(vi.pack_size ?? NaN) === Number(src.pack_size ?? NaN) &&
    (vi.pack_unit ?? null) === src.pack_unit;
  if (same) { alreadyCorrect++; continue; }
  updates.push({ id: vi.id, description: vi.description, ...src });
}

console.log('');
console.log(`  to write            : ${updates.length}`);
console.log(`  already correct     : ${alreadyCorrect}`);
console.log(`  no structure in FMP : ${nothingToRestore}`);
console.log(`  no matching .mer row: ${unmatched}`);
console.log(`  multi-packs among writes: ${updates.filter((u) => (u.pack_count ?? 1) > 1).length}`);
console.log('\n  sample:');
for (const u of updates.slice(0, 8)) {
  console.log(`    ${(u.description ?? '').slice(0, 40).padEnd(40)} -> ${u.pack_count ?? 1} x ${u.pack_size}${u.pack_unit ?? ''}`);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

// Grouped by identical pack values, so ~2,600 rows become a few hundred
// statements instead of one round-trip each — and a shorter run is a smaller
// window to be interrupted in.
const byValues = new Map();
for (const u of updates) {
  const key = `${u.pack_count}|${u.pack_size}|${u.pack_unit}`;
  const g = byValues.get(key) ?? { pack_count: u.pack_count, pack_size: u.pack_size, pack_unit: u.pack_unit, ids: [] };
  g.ids.push(u.id);
  byValues.set(key, g);
}

// One bad row must not abandon the rest: a partially-written backfill is worse
// than either outcome, and that is exactly what an integer pack_count did on
// the 0.5 x 1qt row the first time. Collect failures, keep going, report.
let written = 0;
const failures = [];
const groups = [...byValues.values()];

for (const [i, g] of groups.entries()) {
  for (let from = 0; from < g.ids.length; from += 200) {
    const chunk = g.ids.slice(from, from + 200);
    const { error } = await db
      .from('vendor_items')
      .update({ pack_count: g.pack_count, pack_size: g.pack_size, pack_unit: g.pack_unit })
      .in('id', chunk);
    if (error) failures.push({ values: `${g.pack_count ?? 1} x ${g.pack_size}${g.pack_unit ?? ''}`, rows: chunk.length, message: error.message });
    else written += chunk.length;
  }
  process.stdout.write(`\rwriting: group ${i + 1}/${groups.length}, ${written} rows   `);
}

console.log(`\n\nwritten: ${written} of ${updates.length}`);
if (failures.length > 0) {
  console.log(`FAILED on ${failures.length} group(s) — the rest were still written; fix and re-run:`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f.values} (${f.rows} rows): ${f.message}`);
  process.exit(1);
}
console.log('done.');
