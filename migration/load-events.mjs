#!/usr/bin/env node
/**
 * Restaurant Friend — load employee-events.json into `employee_events` (035).
 *
 *   node --env-file=.env load-events.mjs           # loads; refuses if not empty
 *   node --env-file=.env load-events.mjs --wipe    # replaces the FileMaker rows
 *
 * `--wipe` deletes only `source = 'filemaker'` rows, so anything typed in the
 * app survives a reload. Run `transform-events.mjs --write` first.
 *
 * APPLY MIGRATION 035 AND RUN THIS IN THE SAME SITTING. Between the two, every
 * employee record renders "No events recorded", which is 445 empty claims.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'employee-events.json');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env load-events.mjs');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-events.mjs --write\` first.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => { console.error(`FAILED at ${step}:`, error.message ?? error); process.exit(1); };

const events = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${events.length} events from ${IN}`);

/* -------------------------------------------------------------------------- */
/* 1. Resolve the keys                                                         */
/* -------------------------------------------------------------------------- */

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name');
if (orgErr) die('orgs', orgErr);
if (orgs.length !== 1) die('orgs', new Error(`Expected exactly one org, found ${orgs.length}.`));
const ORG = orgs[0].id;

// .limit(1) and never a HEAD count: a HEAD response has no body to carry an
// error, so a count against a MISSING table returns no error at all and this
// would cheerfully report "ready to load".
const { error: probeErr } = await db.from('employee_events').select('id').limit(1);
if (probeErr) die('employee_events (is migration 035 applied?)', probeErr);

const { data: locRows, error: locErr } = await db.from('locations').select('id, code').eq('org_id', ORG);
if (locErr) die('locations', locErr);
const LOC = Object.fromEntries(locRows.map((l) => [l.code, l.id]));

// Paginated even though one page suffices today — .order() before .range(),
// always, or the pages overlap and the map silently loses people.
const employees = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('employees').select('id, legacy_id').eq('org_id', ORG).order('id').range(from, from + 999);
  if (error) die('employees', error);
  employees.push(...data);
  if (data.length < 1000) break;
}
const EMP = new Map(employees.filter((e) => e.legacy_id !== null).map((e) => [String(e.legacy_id), e.id]));
console.log(`Resolved ${Object.keys(LOC).length} locations and ${EMP.size} employees by legacy id.`);

/* -------------------------------------------------------------------------- */
/* 2. Guard                                                                    */
/* -------------------------------------------------------------------------- */

const { count, error: cntErr } = await db
  .from('employee_events').select('*', { count: 'exact', head: true }).eq('org_id', ORG);
if (cntErr) die('count', cntErr);
if (count > 0 && !WIPE) {
  die('guard', new Error(`employee_events already has ${count} rows — rerun with --wipe to replace them`));
}
if (WIPE && count > 0) {
  // Only the migrated rows. Anything written in the app is somebody's work.
  const { error } = await db.from('employee_events').delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (error) die('wipe', error);
  console.log(`Wiped the existing FileMaker rows (of ${count} total).`);
}

/* -------------------------------------------------------------------------- */
/* 3. Build                                                                    */
/* -------------------------------------------------------------------------- */

const rows = [];
const skipped = new Map();
const skip = (why) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
let noAuthor = 0, noLocation = 0;

for (const e of events) {
  const employee_id = EMP.get(String(e.employee_legacy));
  if (!employee_id) { skip(`employee ${e.employee_legacy} matches nobody`); continue; }

  let location_id = null;
  if (e.location_code) {
    location_id = LOC[e.location_code] ?? null;
    if (!location_id) skip(`location code ${e.location_code} is not a location here`);
  }
  if (!location_id) noLocation += 1;

  // The author is a nice-to-have: an unresolvable supervisor id keeps the NAME
  // and loses the link, rather than losing the row.
  let author_employee_id = null;
  if (e.author_legacy) {
    author_employee_id = EMP.get(String(e.author_legacy)) ?? null;
    if (!author_employee_id) noAuthor += 1;
  }

  rows.push({
    org_id: ORG,
    employee_id,
    location_id,
    occurred_on: e.occurred_on,
    kind: e.kind,
    score: e.score,
    shift: e.shift,
    position: e.position,
    headline: e.headline,
    detail: e.detail,
    outcome: e.outcome,
    author_employee_id,
    author_name: e.author_name,
    source: 'filemaker',
    legacy_id: e.legacy_id,
    source_payload: e.source_payload,
  });
}

if (skipped.size) {
  const total = [...skipped.values()].reduce((a, b) => a + b, 0);
  console.log(`\nSKIPPED ${total} row(s):`);
  for (const [why, n] of [...skipped].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  · ${why} — ${n}`);
  }
  if (skipped.size > 20) console.log(`  … and ${skipped.size - 20} more reasons`);
  console.log('  (employee_id is NOT NULL — an event about nobody is not a record.)');
}
if (noAuthor) console.log(`\n${noAuthor} row(s) name a supervisor who matches no employee; author_name kept, link dropped.`);

/* -------------------------------------------------------------------------- */
/* 4. Insert                                                                   */
/* -------------------------------------------------------------------------- */

console.log(`\nInserting ${rows.length} events…`);
let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const { error } = await db.from('employee_events').insert(rows.slice(i, i + BATCH));
  if (error) die(`insert at ${i}`, error);
  done += Math.min(BATCH, rows.length - i);
  process.stdout.write(`\r  ${done}/${rows.length}`);
}
console.log('');

/* -------------------------------------------------------------------------- */
/* 5. Verify — an insert reporting success is not the same as the rows being    */
/*    right                                                                    */
/* -------------------------------------------------------------------------- */

const { count: finalCount, error: finalErr } = await db
  .from('employee_events').select('*', { count: 'exact', head: true }).eq('org_id', ORG);
if (finalErr) die('verify count', finalErr);
console.log(`\n── VERIFY ──`);
console.log(`  rows in the table: ${finalCount}`);

const loaded = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('employee_events')
    .select('kind, score, shift, occurred_on, location_id, author_employee_id, legacy_id')
    .eq('org_id', ORG).order('id').range(from, from + 999);
  if (error) die('verify fetch', error);
  loaded.push(...data);
  if (data.length < 1000) break;
}
// ids.size === rows.length, before believing any whole-table sweep.
const distinct = new Set(loaded.map((r) => r.legacy_id)).size;
console.log(`  fetched ${loaded.length}, ${distinct} distinct legacy_id ${distinct === loaded.length ? '✓' : '✗ PAGES OVERLAPPED'}`);

const tally = (fn) => {
  const m = new Map();
  for (const r of loaded) { const v = fn(r) ?? '(null)'; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};
console.log(`  kinds  : ${tally((r) => r.kind).map(([k, n]) => `${k}=${n}`).join('  ')}`);
console.log(`  shifts : ${tally((r) => r.shift).map(([k, n]) => `${k}=${n}`).join('  ')}`);

const dates = loaded.map((r) => r.occurred_on).sort();
console.log(`  dates  : ${dates[0]} → ${dates[dates.length - 1]}`);

const shifts = loaded.filter((r) => r.kind === 'shift');
const scored = shifts.filter((r) => r.score !== null);
const mean = scored.reduce((a, r) => a + Number(r.score), 0) / (scored.length || 1);
console.log(`  shift events: ${shifts.length}, ${scored.length} scored, mean ${mean.toFixed(3)}`);
console.log(`  (FMP's own stored average across all ratings was 4.854 — these should be close)`);
console.log(`  shift events with no location: ${shifts.filter((r) => !r.location_id).length} (expect ~1)`);
console.log(`  events with no author        : ${loaded.filter((r) => !r.author_employee_id).length}`);

if (finalCount !== rows.length) {
  console.error(`\n✗ Expected ${rows.length} rows, found ${finalCount}.`);
  process.exit(1);
}
console.log(`\nLoaded ${finalCount} employee events.\n`);
