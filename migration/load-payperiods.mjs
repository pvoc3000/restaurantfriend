#!/usr/bin/env node
// ============================================================================
// load-payperiods.mjs — pay_periods.json → the hosted database
//
//   node --env-file=.env load-payperiods.mjs           # loads, refuses if not empty
//   node --env-file=.env load-payperiods.mjs --wipe    # replaces a previous load
//
// Run `transform-payperiods.mjs --write` first. Needs migration 027 applied.
//
// service_role, so RLS does not apply — this is a local-only script and the
// key must never appear in web/ or in git (design rule 1). Note that 027 gives
// pay_periods NO delete policy at all, so --wipe works from here and ONLY from
// here; the app cannot undo this load, which is the intended asymmetry.
//
// Every row lands `closed`. There is deliberately no open period afterwards —
// the export ends at the last paid fortnight, and opening the next one is the
// app's job (`nextPeriodAfter` in web/src/lib/payPeriods.ts). See the header of
// transform-payperiods.mjs for why that arithmetic lives in exactly one place.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const WIPE = process.argv.includes('--wipe');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env load-payperiods.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const die = (step, error) => { console.error(`FAILED at ${step}:`, error.message ?? error); process.exit(1); };

// ---------------------------------------------------------------------------
const FILE = resolve(DATA, 'pay_periods.json');
if (!existsSync(FILE)) die('startup', new Error(`No pay_periods.json in ${DATA} — run transform-payperiods.mjs --write first`));
const source = JSON.parse(readFileSync(FILE, 'utf8'));

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name').limit(1);
if (orgErr) die('orgs', orgErr);
const ORG = orgs[0].id;
console.log(`org: ${orgs[0].name}`);

// A HEAD count against a MISSING table returns no error through supabase-js —
// a HEAD response has no body to carry one — so this probe uses .limit(1) and
// checks the error. Getting that wrong reports "0 rows, ready to load" for a
// table that does not exist, and then fails 178 inserts. Same family as the
// silent no-op a policy-less delete returns.
const { error: probeErr } = await db.from('pay_periods').select('id').limit(1);
if (probeErr) die('pay_periods (is migration 027 applied?)', probeErr);

const { count, error: countErr } = await db
  .from('pay_periods').select('*', { count: 'exact', head: true });
if (countErr) die('pay_periods count', countErr);
if (count > 0 && !WIPE) {
  die('guard', new Error(`pay_periods already has ${count} rows — rerun with --wipe to replace them`));
}

if (WIPE) {
  console.log('wiping previously loaded pay periods…');
  // If 028 is already applied, timesheets reference these rows with
  // `on delete restrict` — so this fails loudly rather than orphaning a decade
  // of paid hours. That is the constraint doing its job; wipe timesheets first.
  const { error } = await db.from('pay_periods').delete().eq('org_id', ORG);
  if (error) die('wipe pay_periods', error);
}

// --- load -------------------------------------------------------------------
const rows = source.map((p) => ({
  org_id: ORG,
  legacy_id: p.legacy_id,
  start_date: p.start_date,
  end_date: p.end_date,
  status: p.status,
  notes: p.notes,
}));

const { data: inserted, error } = await db.from('pay_periods').insert(rows).select('id, start_date, end_date, status');
if (error) die('insert pay_periods', error);

// --- verify against what we asked for ---------------------------------------
// The insert reporting success is not the same as the rows being right, and
// this is the table every timesheet will hang off.
const { data: check, error: checkErr } = await db
  .from('pay_periods')
  .select('legacy_id, start_date, end_date, status')
  .eq('org_id', ORG)
  .order('start_date');
if (checkErr) die('verify', checkErr);

const byStatus = check.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] ?? 0) + 1 }), {});
const mismatched = source.filter((s) => {
  const got = check.find((c) => c.legacy_id === s.legacy_id);
  return !got || got.start_date !== s.start_date || got.end_date !== s.end_date;
});

console.log(`\ninserted ${inserted.length} of ${source.length}`);
console.log(`in the database: ${check.length} periods, ${check[0]?.start_date} → ${check.at(-1)?.end_date}`);
console.log(`status: ${Object.entries(byStatus).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
console.log(`round-trip mismatches: ${mismatched.length}`);
if (mismatched.length) {
  for (const m of mismatched.slice(0, 10)) console.log(`  ${m.legacy_id} ${m.start_date}→${m.end_date} did not come back intact`);
  process.exit(1);
}

console.log(`\nNo open period exists yet — that is expected. Open the next fortnight`);
console.log(`in the app (/pay-periods → New pay period), which proposes`);
console.log(`${check.at(-1)?.end_date} + 1 day for 14 days.\n`);
