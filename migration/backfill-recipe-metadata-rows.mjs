#!/usr/bin/env node
/**
 * Restaurant Friend — put Mixer Size, Expected Yield and Prep Time back on the
 * recipe as LINES (migration 041's typed strip).
 *
 * 036 lifted those three out of the ingredient list into columns on the
 * version, on the reasoning that they are metadata about the recipe rather than
 * things you weigh. That reasoning was half right and the half it got wrong is
 * the expensive half:
 *
 *   "The yield and mixer and prep time you pulled from a single batch — the
 *    recipe contains multiple batches and the mixer and prep time are included
 *    with the batch size."   (Mark, 2026-08-08)
 *
 * They are PER BATCH COLUMN, and measurably so. Over the real export the
 * columns differ on 196 of 198 mixer-size rows, 349 of 376 expected-yield rows
 * and 57 of 94 prep-time rows. Banana Cake Donut v10 mixes in 4 / 10 / 10 / 20
 * QT and yields 15 / 30 / 45 / 60 — neither of which one number can say, and
 * the mixer sizes are not even proportional, so no amount of scaling recovers
 * them. FileMaker's own printed sheet lists all three as rows under a rule.
 *
 * The version COLUMNS stay, and are not a duplicate of this: they come from the
 * recipe record's own `Yield` / `PrepTime_text` fields, which FileMaker also
 * keeps and also prints (in the header block). `yield_amount` is additionally
 * load-bearing — `lib/productionCost` divides a made element's batch cost by it.
 *
 * Requires migration 041. Run from the migration/ folder:
 *     node --env-file=.env backfill-recipe-metadata-rows.mjs            # dry run
 *     node --env-file=.env backfill-recipe-metadata-rows.mjs --apply    # write
 *
 * Idempotent: the rows carry their FileMaker key as `legacy_id`, and
 * `production_recipe_lines` is unique on (org_id, legacy_id), so this upserts.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env backfill-recipe-metadata-rows.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const GS = String.fromCharCode(0x1d);
const VT = String.fromCharCode(0x0b);

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

function load(name) {
  const path = resolve(PROD, name);
  if (!existsSync(path)) {
    console.error(`No ${path} (override the folder with MER_DIR=)`);
    process.exit(1);
  }
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = (col) => {
    const i = header.indexOf(col.toLowerCase());
    if (i < 0) { console.error(`${name} has no ${col}. Columns: ${header.join(', ')}`); process.exit(1); }
    return i;
  };
  return { rows: rows.slice(1), at, g: (r, i) => String(r[i] ?? '').trim() };
}

const reps = (v) => String(v ?? '').split(GS).map((s) => s.trim());
const num = (v) => {
  if (String(v ?? '').trim() === '') return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

/* -------------------------------------------------------------------------- */
/* 1. Which Recipe_Items are the three metadata rows                           */
/* -------------------------------------------------------------------------- */
// The same three names 036's transform lifts. `Total Liquid` is deliberately
// NOT here: it already loaded as an ordinary labelled line, because it is a
// computed subtotal rather than a fact about the batch.
const WANTED = new Map([
  ['mixer size', 'Mixer Size'],
  ['expected yield', 'Expected Yield'],
  ['prep time', 'Prep Time'],
]);

const I = load('Recipe_Items.mer');
const Ikey = I.at('_PrimaryKey'), Iname = I.at('ItemName_text');
const metaItems = new Map();     // item key → the label to write
for (const r of I.rows) {
  const label = WANTED.get(I.g(r, Iname).trim().toLowerCase());
  if (label) metaItems.set(I.g(r, Ikey), label);
}
console.log(`Recipe_Items: ${metaItems.size} metadata items`);

/* -------------------------------------------------------------------------- */
/* 2. The lines that point at them                                             */
/* -------------------------------------------------------------------------- */
const L = load('_recipelements.mer');
const c = {
  key: L.at('_PrimaryKey'), recipe: L.at('_RecipeKey'), item: L.at('_ItemKey'),
  type: L.at('_ElementType'), amount: L.at('columnAmount_n'), unit: L.at('columnUnit_t'),
  sort: L.at('Sort_num'), hide: L.at('shouldHide_bool'), auto: L.at('AutoUpdate_bool'),
};

const wanted = [];               // one per export row
const byLabel = {};
for (const r of L.rows) {
  if (L.g(r, c.type).toLowerCase() !== 'ingredient') continue;
  const label = metaItems.get(L.g(r, c.item));
  if (!label) continue;

  const amounts = reps(L.g(r, c.amount)).map(num);
  const units = reps(L.g(r, c.unit)).map(blank);
  const auto = L.g(r, c.auto).split(VT).some((x) => x.trim() === '1');

  // Trim FileMaker's padding to 8 back to the slots that hold something.
  let width = 0;
  for (let i = 0; i < Math.max(amounts.length, units.length); i++) {
    if (amounts[i] !== null || units[i] !== null) width = i + 1;
  }
  // Slot 0 is the base column and lives in qty/unit — 041 keeps no second copy.
  const strip = !auto && width > 1
    ? {
        amounts: amounts.slice(0, width).map((a, i) => (i === 0 ? null : a)),
        units: units.slice(0, width).map((u, i) => (i === 0 ? null : u)),
      }
    : { amounts: null, units: null };

  wanted.push({
    legacy_id: `RL:${L.g(r, c.key)}`,
    recipe_key: L.g(r, c.recipe),
    label,
    qty: amounts[0] ?? null,
    unit: units[0] ?? null,
    sort: num(L.g(r, c.sort)) === null ? null : Math.round(num(L.g(r, c.sort))),
    scale_auto: auto,
    scale_amounts: strip.amounts,
    scale_units: strip.units,
    hide_on_print: L.g(r, c.hide) === '1',
  });
  byLabel[label] = (byLabel[label] ?? 0) + 1;
}
console.log(`_recipelements.mer: ${wanted.length} metadata lines`, byLabel);

/* -------------------------------------------------------------------------- */
/* 3. Match them to versions                                                   */
/* -------------------------------------------------------------------------- */
const versions = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('production_recipe_versions')
    .select('id, org_id, legacy_id').order('id').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  versions.push(...data);
  if (data.length < 1000) break;
}
const versionByLegacy = new Map(versions.map((v) => [v.legacy_id, v]));
console.log(`database: ${versions.length} versions`);

const rows = [];
let orphan = 0;
for (const w of wanted) {
  const v = versionByLegacy.get(`RV:${w.recipe_key}`);
  if (!v) { orphan++; continue; }
  rows.push({
    org_id: v.org_id,
    version_id: v.id,
    element_id: null,
    label: w.label,
    qty: w.qty,
    unit: w.unit,
    sort: w.sort,
    scale_auto: w.scale_auto,
    scale_amounts: w.scale_amounts,
    scale_units: w.scale_units,
    hide_on_print: w.hide_on_print,
    legacy_id: w.legacy_id,
    source_payload: { metadata_row: true },
  });
}
console.log(`\n${rows.length} rows to write` + (orphan ? `, ${orphan} point at no version` : ''));

// How many are already there — this is what makes a second run a no-op rather
// than a silent duplicate.
const existing = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('production_recipe_lines')
    .select('legacy_id').not('legacy_id', 'is', null).order('legacy_id').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  for (const l of data) existing.add(l.legacy_id);
  if (data.length < 1000) break;
}
const fresh = rows.filter((r) => !existing.has(r.legacy_id)).length;
console.log(`${fresh} of them are new; ${rows.length - fresh} already loaded`);

for (const r of rows.slice(0, 6)) {
  console.log(`  · ${r.label.padEnd(15)} sort ${String(r.sort).padStart(3)}  ${r.qty} ${r.unit ?? ''}` +
    (r.scale_amounts ? `  typed ${JSON.stringify(r.scale_amounts)} ${JSON.stringify(r.scale_units)}` : '  (scales)'));
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

// Upsert on the natural key so a re-run corrects rather than duplicates.
let written = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await db.from('production_recipe_lines')
    .upsert(chunk, { onConflict: 'org_id,legacy_id' });
  if (error) { console.error(error.message); process.exit(1); }
  written += chunk.length;
}
console.log(`\nWrote ${written} rows.`);
