#!/usr/bin/env node
/**
 * Restaurant Friend — restore the commuter-benefit entitlements (migration 033).
 *
 * FileMaker kept three fields on the employee: `commuterReimbAmount`,
 * `commuterReimbUnit` and `commuterReimbLocations` (a repeating field holding
 * `DF02` or `DF01<VT>DF02`). All three were dropped at transform time as part of
 * a "vestigial" set alongside COVID vaccination status and CalSavers — which was
 * wrong about this one: 17 people are configured, 4,663 shifts were stamped, and
 * $432 of it is in the Gusto file for the most recent fortnight.
 *
 * This writes one `employee_benefits` row per (employee, shop). It reads the
 * .mer directly rather than adding a field to `transform-hr.mjs`, because that
 * transform feeds `load-hr.mjs`, which has already run — a twentieth field there
 * would have no reader. Same posture as `backfill-locations.mjs`.
 *
 * IT ALSO DIFFS ITS OWN ANSWER AGAINST FILEMAKER'S 4,663 STAMPS, which is the
 * only thing that actually proves the rule before anybody is paid by it. That
 * runs in the dry run and needs neither migration 033 nor any write.
 *
 * Run from the migration/ folder (needs `npm run fixtures` in web/ first — it
 * imports the app's own compiled accrual module rather than keeping a second
 * copy of the rule):
 *     node --env-file=.env backfill-employee-benefits.mjs           # dry run
 *     node --env-file=.env backfill-employee-benefits.mjs --apply   # write
 *
 * Idempotent: existing rows are matched on (employee, benefit, location) and
 * UPDATED rather than inserted. 033's constraint is an exclusion rather than a
 * unique index, so there is no `on conflict` target to upsert against — which is
 * the one place that choice costs anything.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR');
const EMPLOYEES_MER = resolve(HR, 'Employees.mer');
const TIMESHEETS_MER = resolve(HR, 'Timesheets.mer');
const APPLY = process.argv.includes('--apply');
const BENEFIT_CODE = 'commuter';

/**
 * WHEN THE COMMUTER PROGRAM STARTED, and this is a measurement rather than a
 * guess: `ts_CommuterBenefit` is stamped on 4,663 rows, the earliest is
 * 2022-06-27, and that first day is a solid block of people rather than one
 * person's start date. There are ZERO stamps before it in seven years of data.
 *
 * FileMaker never recorded a per-person start and this does not invent one — an
 * unbounded entitlement is the honest reading of the employee record. But
 * leaving the PROGRAM unbounded backdates it over shifts nobody was ever paid
 * for: measured, Gaspar López Alarcon alone picks up 343 days between 2020-12-28
 * and 2022-06-26, and opening a 2021 pay period would show commuter dollars that
 * never existed.
 */
const PROGRAM_STARTED = '2022-06-27';

/** FileMaker's separators — 0x1D between repetitions, 0x0B between text lines.
 *  The sample shows VT, but this IS a repeating field, so both are split on: a
 *  wrong guess costs six people their DF01 row and nothing would say so. */
const REP = String.fromCharCode(0x1d);
const VT = String.fromCharCode(0x0b);

const ACCRUALS_MODULE = resolve(HERE, '../web/.fixtures-build/src/lib/payrollBenefits.js');
if (!existsSync(ACCRUALS_MODULE)) {
  console.error(`Missing ${ACCRUALS_MODULE}`);
  console.error('Run `npm run fixtures` in web/ first. This script imports the SAME');
  console.error('accrual module the app uses, so the diff below tests what will actually');
  console.error('run rather than a second copy of the rule that agrees with itself.');
  process.exit(1);
}
const { computeAccruals } = await import(pathToFileURL(ACCRUALS_MODULE).href);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env backfill-employee-benefits.mjs');
  process.exit(1);
}
for (const f of [EMPLOYEES_MER, TIMESHEETS_MER]) {
  if (!existsSync(f)) {
    console.error(`No ${f} (override the folder with MER_DIR=…)`);
    process.exit(1);
  }
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** FileMaker .mer is CSV with quoted fields and \r line endings. */
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

function table(path) {
  // UTF-8: these carry accented names (López Alarcon) and latin1 mangles them.
  const rows = parseCSV(readFileSync(path, 'utf8'));
  const idx = Object.fromEntries(rows[0].map((h, i) => [h.trim(), i]));
  return { idx, rows: rows.slice(1) };
}

const num = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** DF1 / df01 / "DF 01" all appear in thirteen years of hand-typed data. */
function normalizeLocation(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  const m = /^DF0?(\d+)$/.exec(s);
  if (m) return `DF${String(m[1]).padStart(2, '0')}`;
  return s;
}

/** m/d/yyyy → yyyy-mm-dd, which is what `workday` is. */
function isoDate(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* 1. What FileMaker's employee record says                                    */
/* -------------------------------------------------------------------------- */

const emp = table(EMPLOYEES_MER);
for (const col of ['Employee_ID', 'commuterReimbAmount', 'commuterReimbUnit', 'commuterReimbLocations', 'Name_First', 'Name_Last']) {
  if (emp.idx[col] === undefined) {
    console.error(`Employees.mer has no ${col} column — is this a LAYOUT export rather than the full table?`);
    process.exit(1);
  }
}

/** legacy_id → { name, amount, unit, codes[] } for everyone configured. */
const configured = new Map();
for (const row of emp.rows) {
  const legacy = String(row[emp.idx.Employee_ID] ?? '').trim();
  if (!legacy) continue;
  const amount = num(row[emp.idx.commuterReimbAmount]);
  const codes = String(row[emp.idx.commuterReimbLocations] ?? '')
    .split(REP).flatMap((s) => s.split(VT)).flatMap((s) => s.split('\n'))
    .map(normalizeLocation).filter(Boolean);
  if (amount === null && codes.length === 0) continue;
  configured.set(legacy, {
    name: `${row[emp.idx.Name_First]} ${row[emp.idx.Name_Last]}`.trim(),
    amount,
    unit: String(row[emp.idx.commuterReimbUnit] ?? '').trim(),
    codes: [...new Set(codes)],
  });
}

/* -------------------------------------------------------------------------- */
/* 2. What the database already knows                                          */
/* -------------------------------------------------------------------------- */

async function all(table, columns, orgId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    // ORDER BY before paginating, ALWAYS: a .range() sweep with no order
    // returns pages that overlap, which once fabricated 17,000 duplicate shifts
    // and read exactly like a data-integrity catastrophe.
    const { data, error } = await db
      .from(table).select(columns).eq('org_id', orgId).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name');
if (orgErr) throw new Error(orgErr.message);
if (orgs.length !== 1) {
  console.error(`Expected exactly one org, found ${orgs.length}. This script is not written for more.`);
  process.exit(1);
}
const org = orgs[0];

const { data: locations } = await db.from('locations').select('id, code').eq('org_id', org.id);
const locationByCode = new Map(locations.map((l) => [l.code, l.id]));

const employees = await all('employees', 'id, legacy_id, first_name, last_name, status', org.id);
const employeeByLegacy = new Map(employees.filter((e) => e.legacy_id !== null).map((e) => [String(e.legacy_id), e]));

const { data: benefits, error: benErr } = await db
  .from('payroll_benefits').select('id, code, name, gusto_column, unit, default_amount, is_active')
  .eq('org_id', org.id);

const migration033Applied = !benErr;
// PostgREST words a missing table as "Could not find the table 'public.x' in
// the schema cache", NOT "does not exist" — so match on both rather than on the
// phrase you'd expect from Postgres itself.
if (benErr && !/schema cache|does not exist/i.test(benErr.message)) throw new Error(benErr.message);

const benefit = migration033Applied ? benefits.find((b) => b.code === BENEFIT_CODE) : null;
if (migration033Applied && !benefit) {
  console.error(`Migration 033 is applied but has no '${BENEFIT_CODE}' benefit. Did the seed run?`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* 3. The entitlement rows this would write                                    */
/* -------------------------------------------------------------------------- */

const planned = [];
const skipped = { noEmployee: [], noLocations: [], unknownCode: [] };

for (const [legacy, cfg] of configured) {
  const employee = employeeByLegacy.get(legacy);
  if (!employee) { skipped.noEmployee.push(`${cfg.name} (FMP id ${legacy})`); continue; }
  if (cfg.codes.length === 0) { skipped.noLocations.push(`${cfg.name} — amount ${cfg.amount}, no shops named`); continue; }
  for (const code of cfg.codes) {
    const location_id = locationByCode.get(code);
    if (!location_id) { skipped.unknownCode.push(`${cfg.name} → ${code}`); continue; }
    planned.push({
      org_id: org.id,
      employee_id: employee.id,
      benefit_id: benefit?.id ?? null,
      location_id,
      // NULL where FMP's figure equals the benefit's default, so that changing
      // the default still moves everyone who never differed from it — which is
      // the entire point of having a default (design rule 6).
      amount: benefit && cfg.amount === Number(benefit.default_amount) ? null : cfg.amount,
      // The PROGRAM's start, not the person's — see PROGRAM_STARTED. An open
      // end, because the currently-configured people are still earning it.
      starts_on: PROGRAM_STARTED,
      ends_on: null,
      notes: `FileMaker: ${cfg.amount} per ${cfg.unit || '?'} at ${cfg.codes.join(', ')}`,
      _who: cfg.name,
      _code: code,
      _status: employee.status,
    });
  }
}

console.log(`\n=== Commuter entitlements from Employees.mer ===`);
console.log(`${configured.size} people configured in FileMaker → ${planned.length} entitlement rows over ${new Set(planned.map((p) => p._who)).size} people\n`);
for (const p of planned.sort((a, b) => a._who.localeCompare(b._who))) {
  console.log(`  ${p._who.padEnd(24)} ${p._code}  ${p.amount === null ? '(default)' : `$${p.amount}`}  ${p._status}`);
}

// NAMED, NOT GUESSED. Four people carry an amount and no shops; inventing one
// would pay somebody at a location they never worked.
for (const [label, list] of [
  ['no shops named in FileMaker — nothing written, decide by hand', skipped.noLocations],
  ['no matching employee row', skipped.noEmployee],
  ['shop code not in this org', skipped.unknownCode],
]) {
  if (list.length) {
    console.log(`\n  ${list.length} skipped — ${label}:`);
    for (const s of list) console.log(`    · ${s}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. THE DIFF — our rule against FileMaker's 4,663 stamps                     */
/* -------------------------------------------------------------------------- */
//
// `ts_CommuterBenefit` is NOT in `source_payload`: transform-timesheets.mjs is a
// field allow-list and column 62 is not on it. So this reads the .mer directly
// and joins on (employee legacy id, workday), which is the grain the answer is
// really about — the money is one flat amount per qualifying shift, and a
// per-day comparison catches both a missing entitlement and the doubling.

console.log(`\n=== Diff against FileMaker's own stamps ===`);

const ts = table(TIMESHEETS_MER);
for (const col of ['ts_CommuterBenefit', 'ts_Date_Start', 'ts_EmployeeID', 'ts_Location']) {
  if (ts.idx[col] === undefined) {
    console.error(`Timesheets.mer has no ${col} column — wrong export?`);
    process.exit(1);
  }
}

/** (legacy employee, workday) → how many shifts FileMaker stamped. */
const fmpStamps = new Map();
let fmpTotal = 0;
for (const row of ts.rows) {
  const amount = num(row[ts.idx.ts_CommuterBenefit]);
  if (!amount) continue;
  const legacy = String(row[ts.idx.ts_EmployeeID] ?? '').trim();
  const workday = isoDate(row[ts.idx.ts_Date_Start]);
  if (!legacy || !workday) continue;
  const k = `${legacy}|${workday}`;
  fmpStamps.set(k, (fmpStamps.get(k) ?? 0) + 1);
  fmpTotal += amount;
}

// Our answer, over every timesheet in the database, using the entitlements this
// script would write and the seeded benefit's own unit.
const shifts = await all('timesheets', 'id, employee_id, location_id, workday, clock_in, clock_out', org.id);

const legacyByEmployeeId = new Map(employees.map((e) => [e.id, e.legacy_id === null ? null : String(e.legacy_id)]));
const theBenefit = benefit ?? {
  // 033 not applied yet — use exactly what its seed will insert, so the dry run
  // is a preview rather than a different question.
  id: 'ben-commuter', code: BENEFIT_CODE, name: 'Commuter benefit',
  gusto_column: 'custom_earning_commuter_benefit', unit: 'per_shift',
  default_amount: 12, is_active: true,
};
const entitlements = planned.map((p, i) => ({
  id: `ent-${i}`,
  employee_id: p.employee_id,
  benefit_id: theBenefit.id,
  location_id: p.location_id,
  amount: p.amount,
  starts_on: p.starts_on,
  ends_on: p.ends_on,
}));

const accruals = computeAccruals(shifts, [theBenefit], entitlements);

const ourStamps = new Map();
let ourTotal = 0;
for (const a of accruals) {
  const legacy = legacyByEmployeeId.get(a.employee_id);
  if (!legacy) continue;
  const k = `${legacy}|${a.workday}`;
  ourStamps.set(k, (ourStamps.get(k) ?? 0) + 1);
  ourTotal += a.amount;
}

const keys = new Set([...fmpStamps.keys(), ...ourStamps.keys()]);
const both = [], onlyFmp = [], onlyUs = [], countDiff = [];
for (const k of keys) {
  const f = fmpStamps.get(k) ?? 0;
  const o = ourStamps.get(k) ?? 0;
  if (f && o) { both.push(k); if (f !== o) countDiff.push([k, f, o]); }
  else if (f) onlyFmp.push(k);
  else onlyUs.push(k);
}

const nameOf = (k) => {
  const [legacy] = k.split('|');
  const c = configured.get(legacy);
  const e = employeeByLegacy.get(legacy);
  return c?.name ?? (e ? `${e.first_name} ${e.last_name}` : `FMP id ${legacy}`);
};

console.log(`  timesheets in the database : ${shifts.length}`);
console.log(`  employee-days both stamp   : ${both.length}`);
console.log(`  only FileMaker             : ${onlyFmp.length}   <- where OUR RULE IS WRONG`);
console.log(`  only us                    : ${onlyUs.length}   <- FileMaker's known gaps`);
console.log(`  same day, different count  : ${countDiff.length}`);
console.log(`  dollars  FileMaker $${fmpTotal.toFixed(2)}   ours $${ourTotal.toFixed(2)}`);

/** name → count, plus the first and last day, so a run reads as a run. */
function byPerson(keys) {
  const m = new Map();
  for (const k of keys) {
    const who = nameOf(k);
    const day = k.split('|')[1];
    const e = m.get(who) ?? { n: 0, first: day, last: day };
    e.n += 1;
    if (day < e.first) e.first = day;
    if (day > e.last) e.last = day;
    m.set(who, e);
  }
  return [...m].sort((a, b) => b[1].n - a[1].n);
}

if (onlyFmp.length) {
  console.log(`\n  ONLY FILEMAKER — days it paid and we would not. Each one is either a`);
  console.log(`  gap in the entitlements above or a rule we have wrong:`);
  for (const [who, e] of byPerson(onlyFmp)) {
    const cfg = [...configured.values()].find((c) => c.name === who);
    const why = !cfg ? 'not configured in FMP at all'
      : cfg.codes.length === 0 ? 'CONFIGURED WITH NO SHOPS — nothing was written for them'
      : `configured ${cfg.codes.join('+')}`;
    console.log(`    · ${who.padEnd(24)} ${String(e.n).padStart(4)}   ${e.first} → ${e.last}   ${why}`);
  }
}
if (onlyUs.length) {
  console.log(`\n  ONLY US — days FileMaker's script skipped:`);
  for (const [who, e] of byPerson(onlyUs)) {
    console.log(`    · ${who.padEnd(24)} ${String(e.n).padStart(4)}   ${e.first} → ${e.last}`);
  }
}
if (countDiff.length) {
  console.log(`\n  DIFFERENT COUNTS — the same day stamped a different number of times:`);
  for (const [k, f, o] of countDiff.slice(0, 20)) {
    console.log(`    · ${nameOf(k).padEnd(24)} ${k.split('|')[1]}  FileMaker ${f}, us ${o}`);
  }
  if (countDiff.length > 20) console.log(`    … and ${countDiff.length - 20} more`);
}

// THE NUMBER THAT ACTUALLY MATTERS. A disagreement about somebody who left in
// 2023 changes no future money and cannot be fixed — their FileMaker config was
// cleared when they left, which is why the shops are missing. A disagreement
// about somebody still on the roster is a rule we have wrong, today.
const activeEmployeeIds = new Set(employees.filter((e) => e.status !== 'inactive').map((e) => String(e.legacy_id)));
const liveMisses = onlyFmp.filter((k) => activeEmployeeIds.has(k.split('|')[0]));
console.log(`\n  ── VERDICT ──`);
console.log(`  Days a CURRENTLY ACTIVE person was paid and we would not: ${liveMisses.length}`);
if (liveMisses.length) {
  for (const [who, e] of byPerson(liveMisses)) {
    console.log(`    · ${who.padEnd(24)} ${String(e.n).padStart(4)}   ${e.first} → ${e.last}`);
  }
  console.log(`  Each one is a rule to fix BEFORE this pays anybody.`);
} else {
  console.log(`  Every disagreement above is either someone inactive whose FileMaker`);
  console.log(`  config was cleared when they left, or a punchless bare-stamp row that`);
  console.log(`  carried $12 with no shift attached. The rule reproduces FileMaker for`);
  console.log(`  everyone still on the roster, and finds ${onlyUs.length} days its script missed.`);
}

/* -------------------------------------------------------------------------- */
/* 5. Write                                                                    */
/* -------------------------------------------------------------------------- */

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --apply once the diff above reads right.`);
  if (!migration033Applied) console.log(`(Migration 033 is not applied yet, so --apply would fail anyway.)`);
  process.exit(0);
}
if (!migration033Applied) {
  console.error(`\nMigration 033 is not applied — there is no employee_benefits table to write to.`);
  process.exit(1);
}

const existing = await all('employee_benefits', 'id, employee_id, benefit_id, location_id', org.id);
const existingKey = new Map(existing.map((e) => [`${e.employee_id}|${e.benefit_id}|${e.location_id}`, e.id]));

let inserted = 0, updated = 0;
for (const p of planned) {
  const { _who, _code, _status, ...row } = p;
  const k = `${row.employee_id}|${row.benefit_id}|${row.location_id}`;
  const id = existingKey.get(k);
  if (id) {
    const { error } = await db.from('employee_benefits').update(row).eq('id', id).select('id');
    if (error) throw new Error(`${_who} ${_code}: ${error.message}`);
    updated += 1;
  } else {
    const { error } = await db.from('employee_benefits').insert(row).select('id');
    if (error) throw new Error(`${_who} ${_code}: ${error.message}`);
    inserted += 1;
  }
}
console.log(`\nWrote ${inserted} new and updated ${updated} existing entitlement rows.`);
