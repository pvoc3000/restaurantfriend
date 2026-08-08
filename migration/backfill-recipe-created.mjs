#!/usr/bin/env node
/**
 * Restaurant Friend — give each recipe version FileMaker's own creation date.
 *
 * `production_recipe_versions.created_at` defaults to now(), so after the 036
 * load every recipe in the system claimed to have been written the day the
 * migration ran. That is harmless in a database and a lie on paper: the printed
 * sheet states CREATED, and a baker reading "created yesterday" on a recipe the
 * shop has made since 2022 has been told something false about how settled it
 * is. Banana Cake Donut v10 was created 1/31/2022 and FileMaker prints so.
 *
 * MODIFIED is deliberately NOT restored, and the printed sheet no longer states
 * it. Our `updated_at` is maintained by a trigger and says when the ROW last
 * changed — which for every migrated recipe is the moment it was loaded — while
 * FileMaker's `_ModificationTimestamp` says when the RECIPE last changed. They
 * are different facts and neither can stand in for the other without a column
 * to hold both. FMP's value rides in `source_payload.fmp_modified_at` so that
 * column is a small change rather than a re-export.
 *
 * Requires migration 036. Run from the migration/ folder:
 *     node --env-file=.env backfill-recipe-created.mjs            # dry run
 *     node --env-file=.env backfill-recipe-created.mjs --apply    # write
 *
 * Idempotent: it compares before it writes, so a second --apply reports 0.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production', 'Production_Recipes.mer');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env backfill-recipe-created.mjs');
  process.exit(1);
}
if (!existsSync(MER)) {
  console.error(`No Production_Recipes.mer at ${MER} (override with MER_DIR=…)`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

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
  if (i < 0) { console.error(`Production_Recipes.mer has no ${name}`); process.exit(1); }
  return i;
};
const I = { key: at('_PrimaryKey'), created: at('_CreationTimestamp'), modified: at('_ModificationTimestamp') };

/**
 * FileMaker exports "1/31/2022 10:45:04 AM" with no zone, meaning the shop's
 * own wall clock. `new Date` reads it in the HOST's zone, which is the same one
 * — this runs on Mark's Mac. A host in another zone would shift every date by
 * its offset, so the run reports the span it produced and you can see at a
 * glance whether it looks like 2014–2026.
 */
function stamp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const fmp = new Map();
let unparseable = 0;
for (const r of rows.slice(1)) {
  const key = String(r[I.key] ?? '').trim();
  if (!key) continue;
  const created = stamp(r[I.created]);
  if (!created) { unparseable++; continue; }
  fmp.set(`RV:${key}`, { created, modified: stamp(r[I.modified]) });
}
console.log(`Production_Recipes.mer: ${fmp.size} creation dates` + (unparseable ? `, ${unparseable} unreadable` : ''));

const versions = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('production_recipe_versions')
    .select('id, legacy_id, created_at, source_payload').order('id').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  versions.push(...data);
  if (data.length < 1000) break;
}
console.log(`database: ${versions.length} versions`);

const updates = [];
let already = 0;
for (const v of versions) {
  const want = v.legacy_id ? fmp.get(v.legacy_id) : undefined;
  if (!want) continue;
  const sameDate = new Date(v.created_at).toISOString() === want.created;
  const sameNote = (v.source_payload?.fmp_modified_at ?? null) === want.modified;
  if (sameDate && sameNote) { already++; continue; }
  updates.push({
    id: v.id,
    created_at: want.created,
    source_payload: { ...(v.source_payload ?? {}), fmp_modified_at: want.modified },
  });
}

const span = [...fmp.values()].map((x) => x.created).sort();
console.log(`\n${updates.length} versions to date` + (already ? `, ${already} already` : ''));
console.log(`  span ${span[0]?.slice(0, 10)} → ${span[span.length - 1]?.slice(0, 10)}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

let written = 0;
for (const u of updates) {
  const { error } = await db.from('production_recipe_versions')
    .update({ created_at: u.created_at, source_payload: u.source_payload })
    .eq('id', u.id);
  if (error) { console.error(`${u.id}: ${error.message}`); process.exit(1); }
  written++;
}
console.log(`\nDated ${written} versions.`);
