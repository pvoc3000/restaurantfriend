#!/usr/bin/env node
// ============================================================================
// load-timesheets.mjs — timesheets.json → the hosted database
//
//   node --env-file=.env load-timesheets.mjs          # loads, refuses if not empty
//   node --env-file=.env load-timesheets.mjs --wipe   # replaces a previous load
//
// Run `transform-timesheets.mjs --write` first. Needs migrations 027 and 028
// applied, and the pay periods already loaded (load-payperiods.mjs).
//
// service_role, so RLS does not apply. That matters more here than usual: 028's
// write policies refuse any row whose pay period isn't open, and EVERY period
// this load touches is closed. Through the app these inserts would all match
// zero rows and PostgREST would report success — the silent no-op. From here
// they land, which is the intended asymmetry: history is loaded once, by a
// local script, and is read-only thereafter by construction (decision 8).
//
// ---------------------------------------------------------------------------
// IT RESOLVES THREE FOREIGN KEYS AND CHECKS THE THIRD AGAINST ITSELF
//
//   employee   ts_EmployeeID → employees.legacy_id. 198 of 203 ids match,
//              covering 44,722 of 44,767 rows. The five that don't are named
//              rather than dropped silently.
//   location   ts_Location → locations.code, after the alias map.
//   period     NOT resolved here. 028's trigger fills pay_period_id from the
//              workday, which 027's exclusion constraint makes a total
//              function. FileMaker's own cPayPeriod is carried along and
//              COMPARED afterwards — two independent answers to "which
//              fortnight owns this shift", and a disagreement is worth seeing.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env load-timesheets.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => { console.error(`\nFAILED at ${step}:`, error.message ?? error); process.exit(1); };

const FILE = resolve(DATA, 'timesheets.json');
if (!existsSync(FILE)) die('startup', new Error(`No timesheets.json in ${DATA} — run transform-timesheets.mjs --write first`));
const source = JSON.parse(readFileSync(FILE, 'utf8'));
console.log(`read ${source.length} rows from timesheets.json`);

// --- context ----------------------------------------------------------------
const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name').limit(1);
if (orgErr) die('orgs', orgErr);
const ORG = orgs[0].id;
console.log(`org: ${orgs[0].name}`);

// .limit(1), never a HEAD count: a HEAD response has no body to carry an error,
// so a count against a MISSING table returns no error at all and this would
// report "ready to load" for a table that doesn't exist.
const { error: probeErr } = await db.from('timesheets').select('id').limit(1);
if (probeErr) die('timesheets (is migration 028 applied?)', probeErr);

const { data: locRows, error: locErr } = await db.from('locations').select('id, code');
if (locErr) die('locations', locErr);
const LOC = Object.fromEntries(locRows.map((l) => [l.code, l.id]));

// 445 employees, so one page is enough — but paginate anyway rather than
// silently truncating at PostgREST's default 1000 if the roster ever grows.
const employees = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('employees').select('id, legacy_id, first_name, last_name').range(from, from + 999);
  if (error) die('employees', error);
  employees.push(...data);
  if (data.length < 1000) break;
}
const EMP = new Map(employees.filter((e) => e.legacy_id !== null).map((e) => [String(e.legacy_id).trim(), e.id]));
console.log(`resolved ${employees.length} employees, ${EMP.size} with a FileMaker id`);

const { data: periods, error: perErr } = await db
  .from('pay_periods').select('id, legacy_id, start_date, end_date').eq('org_id', ORG);
if (perErr) die('pay_periods', perErr);
if (periods.length === 0) die('pay_periods', new Error('no pay periods loaded — run load-payperiods.mjs first'));
const PERIOD_BY_LEGACY = new Map(periods.filter((p) => p.legacy_id).map((p) => [String(p.legacy_id), p.id]));
console.log(`resolved ${periods.length} pay periods`);

// --- guard ------------------------------------------------------------------
const { count, error: countErr } = await db.from('timesheets').select('*', { count: 'exact', head: true });
if (countErr) die('timesheets count', countErr);
if (count > 0 && !WIPE) {
  die('guard', new Error(`timesheets already has ${count} rows — rerun with --wipe to replace them`));
}
if (WIPE) {
  console.log('wiping previously loaded timesheets…');
  const { error } = await db.from('timesheets').delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (error) die('wipe timesheets', error);
}

// --- map --------------------------------------------------------------------
const unmatchedEmployees = new Map();
const unmatchedLocations = new Map();
const rows = [];

for (const t of source) {
  const employee_id = t.employee_legacy_id ? EMP.get(t.employee_legacy_id) ?? null : null;
  if (!employee_id) {
    const k = `${t.employee_legacy_id ?? '(blank)'} · ${t.employee_name ?? '(no name)'}`;
    unmatchedEmployees.set(k, (unmatchedEmployees.get(k) ?? 0) + 1);
    // employee_id is NOT NULL on the table: a shift with nobody attached is not
    // a payroll record. Named above and skipped, never invented.
    continue;
  }
  const location_id = t.location_code ? LOC[t.location_code] ?? null : null;
  if (t.location_code && !location_id) {
    unmatchedLocations.set(t.location_code, (unmatchedLocations.get(t.location_code) ?? 0) + 1);
  }

  rows.push({
    org_id: ORG,
    employee_id,
    location_id,
    workday: t.workday,
    business_date: t.business_date,
    // pay_period_id and workweek_start are left to 028's trigger, deliberately.
    clock_in: t.clock_in,
    clock_out: t.clock_out,
    source_hours_regular: t.source_hours_regular,
    source_hours_overtime: t.source_hours_overtime,
    source_hours_double_ot: t.source_hours_double_ot,
    source_hours_paid: t.source_hours_paid,
    source_break_minutes: t.source_break_minutes,
    hours_regular: t.hours_regular,
    hours_overtime: t.hours_overtime,
    hours_double_ot: t.hours_double_ot,
    ot_decision: t.ot_decision,
    unpaid_break_minutes: t.unpaid_break_minutes,
    sick_hours: t.sick_hours,
    exclude_tips: t.exclude_tips,
    scheduled_hours: t.scheduled_hours,
    position: t.position,
    employee_note: t.employee_note,
    manager_note: t.manager_note,
    source: t.source,
    source_row_key: t.source_row_key,
    source_payload: t.source_payload,
    stitched: t.stitched,
    // `legacy_id` stays NULL: Timesheets.mer has 117 columns and not one is a
    // record id, which is exactly why source_row_key is a natural tuple plus an
    // occurrence ordinal. The column is here for a future re-export that has
    // one. FileMaker's pay-period claim is NOT stashed here — it is raw source
    // data and rides in source_payload, where it is compared below.
  });
}

if (unmatchedEmployees.size) {
  const total = [...unmatchedEmployees.values()].reduce((a, b) => a + b, 0);
  console.log(`\nSKIPPED ${total} row(s) whose ts_EmployeeID matches no employee:`);
  for (const [k, n] of [...unmatchedEmployees].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('  (employee_id is NOT NULL — a shift with nobody attached is not a payroll record.)');
}
if (unmatchedLocations.size) {
  console.log('\nLocation codes with no matching location (loaded with no shop):');
  for (const [k, n] of unmatchedLocations) console.log(`  ${String(n).padStart(5)}  ${k}`);
}

// --- load -------------------------------------------------------------------
console.log(`\ninserting ${rows.length} timesheets…`);
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  const { error } = await db.from('timesheets').insert(slice);
  if (error) die(`timesheets rows ${i}–${i + slice.length}`, error);
  inserted += slice.length;
  process.stdout.write(`\r  ${inserted}/${rows.length}   `);
}
console.log();

// --- verify -----------------------------------------------------------------
// An insert reporting success is not the same as the rows being right, and this
// is a decade of paid hours.
const { count: finalCount, error: fcErr } = await db
  .from('timesheets').select('*', { count: 'exact', head: true }).eq('org_id', ORG);
if (fcErr) die('verify count', fcErr);

const { count: noPeriod } = await db
  .from('timesheets').select('*', { count: 'exact', head: true })
  .eq('org_id', ORG).is('pay_period_id', null);
const { count: noWeek } = await db
  .from('timesheets').select('*', { count: 'exact', head: true })
  .eq('org_id', ORG).is('workweek_start', null);

console.log(`\nin the database: ${finalCount} timesheets`);
console.log(`  with no pay period (trigger found none): ${noPeriod}`);
console.log(`  with no workweek_start:                  ${noWeek}`);

// The cross-check: 028's trigger picked a period from the workday, FileMaker
// recorded one on the row. Two independent answers to the same question.
const check = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('timesheets').select('pay_period_id, workday, source_payload')
    .eq('org_id', ORG).range(from, from + 999);
  if (error) die('verify periods', error);
  check.push(...data);
  if (data.length < 1000) break;
}
let agree = 0, disagreeCount = 0, noClaim = 0;
const samples = [];
for (const r of check) {
  const claim = r.source_payload?.pay_period_legacy_id ?? null;
  if (!claim) { noClaim++; continue; }
  const fmp = PERIOD_BY_LEGACY.get(String(claim)) ?? null;
  if (fmp === r.pay_period_id) agree++;
  else {
    disagreeCount++;
    if (samples.length < 10) samples.push({ workday: r.workday, claim });
  }
}
console.log(`\n  pay period: FileMaker's cPayPeriod vs the trigger's answer from the workday`);
console.log(`  agree ${agree} · disagree ${disagreeCount} · FMP made no claim ${noClaim}`);
for (const d of samples) {
  console.log(`     workday ${d.workday} — FMP said period #${d.claim}`);
}

if (finalCount !== rows.length) {
  console.error(`\nRow count mismatch: inserted ${rows.length}, table holds ${finalCount}.`);
  process.exit(1);
}
console.log('\nDone.\n');
