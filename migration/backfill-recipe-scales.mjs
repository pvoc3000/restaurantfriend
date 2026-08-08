#!/usr/bin/env node
/**
 * Restaurant Friend — restore FileMaker's AUTO flag and its typed scale columns
 * (migration 041).
 *
 * 036 loaded one amount per recipe line and computed the rest, on the
 * measurement that 96.4% of FMP's stored columns are a strict multiple of the
 * base. What it could not express was the other 3.6% — and FileMaker had
 * already said which lines those are. `_recipelements.mer` carries
 * **`AutoUpdate_bool`**, one flag per line: set on 3,350 of the 5,260 ingredient
 * lines, clear on 1,910. Clear means "these columns are typed, leave them
 * alone", which is exactly the mixer sizes, the prep times and the 29 versions
 * whose columns are formulation variants rather than scales.
 *
 * The transform never read that column, so this reads it now and matches by
 * `legacy_id` (`RL:<FMP key>`) rather than re-running the whole load. For every
 * line FileMaker marked NOT auto, it writes:
 *
 *   scale_auto   = false
 *   scale_amounts, scale_units = the per-column strip, EXCEPT slot 0
 *
 * Slot 0 is deliberately nulled: the base column lives in `qty`/`unit` and 041
 * keeps no second copy of it. Writing it would create two answers to the same
 * question and the app reads the other one.
 *
 * `hide_on_print` is NOT here — the transform already carried FMP's
 * `shouldHide_bool` into `source_payload.hidden`, so 041 backfills it in SQL.
 *
 * Requires migration 041 to have been applied first.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env backfill-recipe-scales.mjs            # dry run
 *     node --env-file=.env backfill-recipe-scales.mjs --apply    # write
 *
 * Idempotent: it compares before it writes, so a second --apply reports 0.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production', '_recipelements.mer');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env backfill-recipe-scales.mjs');
  process.exit(1);
}
if (!existsSync(MER)) {
  console.error(`No _recipelements.mer at ${MER} (override with MER_DIR=…)`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Between the repetitions of a FileMaker repeating field, once exported. */
const GS = String.fromCharCode(0x1d);
/** Between the lines of a multi-line text field — `AutoUpdate_bool` arrives as
 *  "0\x0b1" on five rows, which is FileMaker's own idea of a boolean. */
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

const rows = parseCSV(readFileSync(MER, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = rows[0].map((h) => h.trim().toLowerCase());
const at = (name) => {
  const i = header.indexOf(name.toLowerCase());
  if (i < 0) {
    console.error(`_recipelements.mer has no ${name} column. Columns: ${header.join(', ')}`);
    process.exit(1);
  }
  return i;
};
const I = {
  key: at('_PrimaryKey'),
  type: at('_ElementType'),
  auto: at('AutoUpdate_bool'),
  amount: at('columnAmount_n'),
  unit: at('columnUnit_t'),
};
const g = (r, k) => String(r[I[k]] ?? '').trim();
const reps = (v) => String(v ?? '').split(GS).map((s) => s.trim());
const num = (v) => {
  if (String(v ?? '').trim() === '') return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/** What FileMaker means by "typed, leave alone". Blank is off; so is "0". */
const isAuto = (v) => v.split(VT).some((x) => x.trim() === '1');

// ---------------------------------------------------------------------------
// 1. What the export says
// ---------------------------------------------------------------------------
const manual = new Map();   // legacy_id → { amounts, units }
let ingredients = 0, autoRows = 0;

for (const r of rows.slice(1)) {
  if (g(r, 'type').toLowerCase() !== 'ingredient') continue;
  ingredients++;
  if (isAuto(g(r, 'auto'))) { autoRows++; continue; }

  const amounts = reps(g(r, 'amount')).map(num);
  const units = reps(g(r, 'unit')).map((u) => (u === '' ? null : u));
  // Trim FileMaker's padding to 8 back to the slots that hold something, then
  // null slot 0 — the base is `qty`/`unit` and this strip must not restate it.
  let width = 0;
  for (let i = 0; i < Math.max(amounts.length, units.length); i++) {
    if (amounts[i] !== null || units[i] !== null) width = i + 1;
  }
  if (width <= 1) {
    // Not auto, and nothing but a base amount to show for it. `scale_auto` still
    // goes false — the flag is a statement about the row — but there is no strip.
    manual.set(`RL:${g(r, 'key')}`, { amounts: null, units: null });
    continue;
  }
  const a = amounts.slice(0, width);
  const u = units.slice(0, width);
  a[0] = null;
  u[0] = null;
  manual.set(`RL:${g(r, 'key')}`, { amounts: a, units: u });
}

console.log(`_recipelements.mer: ${ingredients} ingredient lines, ${autoRows} auto, ${manual.size} typed`);

// ---------------------------------------------------------------------------
// 2. What the database has
// ---------------------------------------------------------------------------
// Paginated and ORDERED. PostgREST caps a select at 1,000 rows and says nothing
// about it, and a `.range()` sweep with no ORDER BY returns pages that overlap —
// both lessons already paid for elsewhere in this folder.
const lines = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('production_recipe_lines')
    .select('id, legacy_id, scale_auto, scale_amounts, scale_units')
    .order('id')
    .range(from, from + 999);
  if (error) {
    if (/scale_auto/.test(error.message)) {
      console.error('production_recipe_lines has no scale_auto — apply migration 041 first.');
      process.exit(1);
    }
    console.error(error.message);
    process.exit(1);
  }
  lines.push(...data);
  if (data.length < 1000) break;
}
const ids = new Set(lines.map((l) => l.id));
if (ids.size !== lines.length) {
  console.error(`Paginated ${lines.length} rows holding only ${ids.size} distinct ids — the sweep overlapped.`);
  process.exit(1);
}
console.log(`database: ${lines.length} recipe lines`);

// ---------------------------------------------------------------------------
// 3. The diff
// ---------------------------------------------------------------------------
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const updates = [];
let unmatched = 0, alreadyRight = 0;
for (const line of lines) {
  const want = line.legacy_id ? manual.get(line.legacy_id) : undefined;
  if (want === undefined) continue;                  // auto, or added in the app
  const have = {
    amounts: line.scale_amounts?.map((n) => (n === null ? null : Number(n))) ?? null,
    units: line.scale_units ?? null,
  };
  if (line.scale_auto === false && same(have.amounts, want.amounts) && same(have.units, want.units)) {
    alreadyRight++;
    continue;
  }
  updates.push({ id: line.id, ...want });
}
for (const legacy of manual.keys()) {
  if (!lines.some((l) => l.legacy_id === legacy)) unmatched++;
}

console.log(
  `\n${updates.length} lines to mark typed` +
  (alreadyRight ? `, ${alreadyRight} already` : '') +
  (unmatched ? `, ${unmatched} export rows match no line (dropped at the 036 load — separators and the three magic rows)` : '')
);

for (const u of updates.slice(0, 8)) {
  console.log(`  · ${u.id} → ${JSON.stringify(u.amounts)} ${JSON.stringify(u.units)}`);
}
if (updates.length > 8) console.log(`  … and ${updates.length - 8} more`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

let written = 0;
for (const u of updates) {
  const { error } = await db
    .from('production_recipe_lines')
    .update({ scale_auto: false, scale_amounts: u.amounts, scale_units: u.units })
    .eq('id', u.id);
  if (error) {
    console.error(`${u.id}: ${error.message}`);
    process.exit(1);
  }
  written++;
}
console.log(`\nWrote ${written} lines.`);
