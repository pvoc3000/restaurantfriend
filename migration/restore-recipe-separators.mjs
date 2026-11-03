#!/usr/bin/env node
/**
 * Restaurant Friend — put FileMaker's ingredient DIVIDERS and SPACERS back
 * (migration 222).
 *
 * FileMaker grouped a recipe's ingredients — dry, then wet, then the batch
 * details — with separator rows: lines pointing at one of two special
 * Recipe_Items, one named "---" (a rule) and one with no name (a blank row), or
 * simply empty lines. The 036 load dropped them as "presentation stored as
 * data" (`transform-production.mjs`), and the printed sheet has been guessing
 * them back from the holes they left in the Sort numbers ever since. 222 gives
 * a line a `kind`, so they can be rows again (Mark, 2026-11-03: "dividers and
 * spacers").
 *
 * This reads the export, finds every separator row with the SAME test the
 * transform used to drop it, and inserts it at its own Sort into its own
 * version: a "---" item becomes a `divider`, anything else a `spacer`. Matched
 * by the version's `legacy_id` (`RV:<FMP key>`); each line gets `RL:<FMP key>`,
 * the id it would have had, which is also what makes a second run a no-op.
 *
 * A version made in the app has no FileMaker rows and is not touched. Nor is a
 * line already holding the legacy id.
 *
 * Requires migration 222 to have been applied first.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env restore-recipe-separators.mjs            # dry run
 *     node --env-file=.env restore-recipe-separators.mjs --apply    # write
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const LINES = resolve(DIR, '_recipelements.mer');
const ITEMS = resolve(DIR, 'Recipe_Items.mer');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env restore-recipe-separators.mjs');
  process.exit(1);
}
for (const p of [LINES, ITEMS]) {
  if (!existsSync(p)) {
    console.error(`No ${p} (override the folder with MER_DIR=…)`);
    process.exit(1);
  }
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Between the repetitions of a FileMaker repeating field, once exported. */
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

function table(path, name, cols) {
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = {};
  for (const [k, col] of Object.entries(cols)) {
    const i = header.indexOf(col.toLowerCase());
    if (i < 0) {
      console.error(`${name} has no ${col} column.`);
      process.exit(1);
    }
    at[k] = i;
  }
  return { rows: rows.slice(1), g: (r, k) => String(r[at[k]] ?? '').trim() };
}
const num = (v) => {
  if (String(v ?? '').trim() === '') return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const first = (v) => String(v ?? '').split(GS)[0].trim();

// ---------------------------------------------------------------------------
// 1. The two separator items, as the transform found them
// ---------------------------------------------------------------------------
const I = table(ITEMS, 'Recipe_Items.mer', { key: '_PrimaryKey', name: 'ItemName_text' });
const separatorItem = new Map(); // key → 'divider' | 'spacer'
const knownItem = new Set();
for (const r of I.rows) {
  const k = I.g(r, 'key');
  if (!k) continue;
  knownItem.add(k);
  const name = I.g(r, 'name');
  if (!name) separatorItem.set(k, 'spacer');
  else if (name === '---') separatorItem.set(k, 'divider');
}

// ---------------------------------------------------------------------------
// 2. Every separator row in the export
// ---------------------------------------------------------------------------
const L = table(LINES, '_recipelements.mer', {
  key: '_PrimaryKey',
  recipe_key: '_RecipeKey',
  item_key: '_ItemKey',
  type: '_ElementType',
  amount: 'columnAmount_n',
  name: 'columnName_t',
  sort: 'Sort_num',
  hide: 'shouldHide_bool',
});
const found = [];
for (const r of L.rows) {
  if (L.g(r, 'type').toLowerCase() === 'procedure') continue;
  const item = L.g(r, 'item_key');
  const label = first(L.g(r, 'name'));
  const amount = num(first(L.g(r, 'amount')));
  // The transform's own test (transform-production.mjs, "FMP's literal
  // separator rows"): a separator item, or a line with nothing in it.
  const kind = item && separatorItem.has(item)
    ? separatorItem.get(item)
    : !item && !label && amount === null
      ? 'spacer'
      : null;
  if (!kind) continue;
  const sort = num(L.g(r, 'sort'));
  found.push({
    legacy: `RL:${L.g(r, 'key')}`,
    version: `RV:${L.g(r, 'recipe_key')}`,
    kind,
    sort: sort === null ? null : Math.round(sort),
    hide: /(^|\D)1(\D|$)/.test(L.g(r, 'hide')),
  });
}

// ---------------------------------------------------------------------------
// 3. Where they go, and what is already there
// ---------------------------------------------------------------------------
async function all(table, columns, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const versions = new Map(
  (await all('production_recipe_versions', 'id, org_id, legacy_id', (q) => q.not('legacy_id', 'is', null)))
    .map((v) => [v.legacy_id, v])
);
const existing = new Set(
  (await all('production_recipe_lines', 'legacy_id', (q) => q.not('legacy_id', 'is', null))).map((l) => l.legacy_id)
);

const rows = [];
let noVersion = 0, already = 0;
for (const f of found) {
  const v = versions.get(f.version);
  if (!v) { noVersion++; continue; }
  if (existing.has(f.legacy)) { already++; continue; }
  rows.push({
    org_id: v.org_id,
    version_id: v.id,
    kind: f.kind,
    sort: f.sort,
    label: null,
    hide_on_print: f.hide,
    legacy_id: f.legacy,
  });
}

const byKind = (k) => rows.filter((r) => r.kind === k).length;
console.log(`Export: ${found.length} separator rows (${found.filter((f) => f.kind === 'divider').length} dividers, ${found.filter((f) => f.kind === 'spacer').length} spacers).`);
console.log(`  ${noVersion} belong to no loaded version, ${already} are already in.`);
console.log(`To insert: ${rows.length} — ${byKind('divider')} dividers, ${byKind('spacer')} spacers, across ${new Set(rows.map((r) => r.version_id)).size} versions.`);

if (!APPLY) {
  console.log('Dry run. Re-run with --apply to write.');
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const { data, error } = await db.from('production_recipe_lines').insert(chunk).select('id');
  if (error) {
    console.error(`Stopped after ${written}: ${error.message}`);
    process.exit(1);
  }
  written += data.length;
}
console.log(`Inserted ${written}.`);
