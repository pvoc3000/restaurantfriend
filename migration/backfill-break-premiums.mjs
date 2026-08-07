#!/usr/bin/env node
/**
 * Restaurant Friend — the meal decisions FileMaker already made (migration 029).
 *
 * `lib/breakRules` flags a missing meal on ~7,691 employee-workdays that
 * FileMaker's own `cTimeSheetError` did not, and CLAUDE.md records the cause as
 * a DATA GAP rather than a rule bug: 6,374 of the 6,562 excess no-meal days are
 * six hours or less — exactly what a signed waiver or a too-short shift covers —
 * and no waiver or decision was ever loaded.
 *
 * The evidence was in the RATINGS table all along. 11,000 of its rows carry a
 * `break_missed_reason`, written by whoever ran the shift, and they read:
 *
 *     1,756  na                  1,151  under 6 hrs        687  didnt work long enough
 *     1,251  not needed            569  did not require taking a 30 minute break today
 *       523  no 30 needed          281  took a ten
 *
 * That is a decision, in 029's exact sense: `kind='meal'`, `decision='not_owed'`,
 * with the supervisor's own words as the reason.
 *
 * (CLAUDE.md says twice that FMP's 51 meal-break waivers live in its Events
 * table. They do not — `migration/field-map.md:146` has MEALBREAK WAIVER as an
 * onboarding CHECKBOX on the employee record, and the Events export has no
 * waiver among its thirteen types. So this closes the gap by a different route
 * than that note predicts: `not_owed` decisions, not waivers.)
 *
 * IT DIFFS ITS OWN ANSWER AGAINST THE APP'S LIVE RULE before writing anything,
 * which is the only thing that shows whether these reasons resolve the excess or
 * contradict it. That runs in the dry run and writes nothing.
 *
 * Run from migration/ (needs `npm run fixtures` in web/ first — it imports the
 * app's OWN break rules rather than a second copy that would agree with itself):
 *     node --env-file=.env backfill-break-premiums.mjs           # dry run
 *     node --env-file=.env backfill-break-premiums.mjs --apply   # write
 *
 * Independent of migration 035 and of the events load: it reads Ratings.mer and
 * writes to a table that has existed since 029, so its verdict is available
 * before any of that exists.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RATINGS_MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR', 'Ratings.mer');
const APPLY = process.argv.includes('--apply');

/**
 * THE CONTESTED DAYS ARE SKIPPED BY DEFAULT, and this flag is how you overrule
 * that. Read the list the dry run prints before you do.
 *
 * The first run of this script (2026-08-06) assumed every FileMaker reason was a
 * decision worth honouring. Reading the 451 it argues with says otherwise. The
 * dominant finding among them is `short_meal` (208 of 451) — and a signed waiver
 * covers SKIPPING a meal on a shift of six hours or less, not taking a
 * ten-minute one. "Only took a 10 min break left at her 5th hour" on a 5.07h
 * shift is a supervisor DESCRIBING a violation, not waiving it; "no break
 * needed" at 5.15h is the 5-hour threshold being read as six, which is the same
 * misreading CLAUDE.md already records; and a handful are simply junk ("test"
 * twice, "fgdfg", a pasted case number).
 *
 * Writing `not_owed` on those would put a legal misreading into the payroll
 * record on the side that costs the employee an hour, and it would clear the
 * finding out of the review queue so nobody ever sees it again. Skipping costs
 * nothing — every one of these days is in a closed period, so no money moves
 * either way — and the supervisor's own words survive regardless, on the shift
 * event that migration 035's load writes.
 */
const INCLUDE_CONTESTED = process.argv.includes('--include-contested');

/** Between the lines of a multi-line text field, once exported. 12 reasons carry one. */
const VT = String.fromCharCode(0x0b);

/**
 * What a backfilled reason looks like, and why it is a PREFIX rather than a
 * column.
 *
 * `break_premiums` has no `source`, so a row this script writes is otherwise
 * indistinguishable from one a manager clicked this morning. Adding a column
 * would mean an events migration altering a payroll table; the prefix costs
 * nothing, is what the worksheet already renders, and keeps the raw text —
 * including the 1,756 bare "na" rows, which 032 now permits to be blank but
 * which are the only evidence anybody looked at that day.
 */
const REASON_PREFIX = 'Recorded in FileMaker';

/* -------------------------------------------------------------------------- */
/* The app's own rule, compiled                                                */
/* -------------------------------------------------------------------------- */

const BUILD = resolve(HERE, '../web/.fixtures-build/src/lib');
for (const m of ['breakRules.js', 'payrollWorksheet.js']) {
  if (!existsSync(resolve(BUILD, m))) {
    console.error(`Missing ${resolve(BUILD, m)}`);
    console.error('Run `npm run fixtures` in web/ first. This script imports the SAME break');
    console.error('rules the app uses, so the diff below tests what will actually run rather');
    console.error('than a second copy of the rule that agrees with itself.');
    process.exit(1);
  }
}
const { assessWorkday } = await import(pathToFileURL(resolve(BUILD, 'breakRules.js')).href);
const { toBreakShift } = await import(pathToFileURL(resolve(BUILD, 'payrollWorksheet.js')).href);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env backfill-break-premiums.mjs');
  process.exit(1);
}
if (!existsSync(RATINGS_MER)) {
  console.error(`No ${RATINGS_MER} (override the folder with MER_DIR=…)`);
  process.exit(1);
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

/** M/D/YYYY → YYYY-MM-DD, or null. */
function isoDate(raw) {
  const p = String(raw ?? '').trim().split('/');
  if (p.length !== 3) return null;
  const [m, d, y] = p.map(Number);
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* 1. What FileMaker recorded                                                  */
/* -------------------------------------------------------------------------- */

// UTF-8, not latin1 — these rows carry accented names in the reason text.
const raw = parseCSV(readFileSync(RATINGS_MER, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = raw[0];

// The allow-list. Candidate names because the export shape has changed before,
// and a silently-missing column here would write nothing and report success.
const byName = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
const FIELDS = {
  employee: ['employee_id', 'employeeid', 'employee id'],
  date: ['date'],
  reason: ['break_missed_reason', 'breakmissedreason', 'break missed reason'],
  name: ['full_name', 'name_full_c', 'fullname'],
};
const F = {};
const missing = [];
for (const [k, names] of Object.entries(FIELDS)) {
  const i = names.map((n) => byName.get(n)).find((v) => v !== undefined);
  if (i === undefined) missing.push(`${k} (tried ${names.join(', ')})`);
  F[k] = i;
}
if (missing.length) {
  console.error('Ratings.mer is missing:');
  for (const m of missing) console.error(`  · ${m}`);
  console.error(`\nColumns present: ${header.join(', ')}`);
  console.error('\nRefusing to guess — this decides whether somebody is paid a premium hour.');
  process.exit(1);
}
const get = (row, k) => String(row[F[k]] ?? '').trim();

// One entry per (employee, workday). 75 keys carry two different reasons — two
// shifts on one day, each explained — and the California cap allows ONE row, so
// they are joined rather than one of them being dropped.
const fmp = new Map();
const nameByLegacy = new Map();
let reasonRows = 0, undated = 0;
for (const row of raw.slice(1)) {
  const legacy = get(row, 'employee');
  const workday = isoDate(get(row, 'date'));
  const reason = get(row, 'reason').split(VT).map((s) => s.trim()).filter(Boolean).join(' / ');
  if (!reason) continue;
  reasonRows += 1;
  if (!legacy || !workday) { undated += 1; continue; }
  if (get(row, 'name')) nameByLegacy.set(legacy, get(row, 'name'));
  const k = `${legacy}|${workday}`;
  const seen = fmp.get(k);
  if (!seen) fmp.set(k, { legacy, workday, reasons: [reason] });
  else if (!seen.reasons.includes(reason)) seen.reasons.push(reason);
}

console.log(`\nFileMaker: ${reasonRows} rating rows carry a break reason → ${fmp.size} distinct (employee, workday).`);
const doubled = [...fmp.values()].filter((e) => e.reasons.length > 1);
if (doubled.length) {
  console.log(`  ${doubled.length} of them carry TWO different reasons (two shifts, each explained); joined with " / ":`);
  for (const e of doubled.slice(0, 5)) {
    console.log(`    · ${(nameByLegacy.get(e.legacy) ?? e.legacy).padEnd(26)} ${e.workday}  ${e.reasons.join(' / ').slice(0, 70)}`);
  }
  if (doubled.length > 5) console.log(`    … and ${doubled.length - 5} more`);
}
if (undated) console.log(`  ${undated} skipped for having no employee or no date.`);

/* -------------------------------------------------------------------------- */
/* 2. What the database knows                                                  */
/* -------------------------------------------------------------------------- */

async function all(table, columns, orgId, order = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    // ORDER BY before paginating, ALWAYS: a .range() sweep with no order returns
    // pages that overlap, which once fabricated 17,000 duplicate shifts and read
    // exactly like a data-integrity catastrophe.
    const { data, error } = await db
      .from(table).select(columns).eq('org_id', orgId).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
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

// .limit(1) and never a HEAD count: a HEAD response has no body to carry an
// error, so a count against a missing table returns no error at all.
const { error: probeErr } = await db.from('break_premiums').select('id').limit(1);
if (probeErr) {
  console.error(`Cannot read break_premiums (is migration 029 applied?): ${probeErr.message}`);
  process.exit(1);
}

const employees = await all('employees', 'id, legacy_id, first_name, last_name, status', org.id);
const employeeByLegacy = new Map(
  employees.filter((e) => e.legacy_id !== null).map((e) => [String(e.legacy_id), e]),
);
const nameOf = (e) => `${e.last_name}, ${e.first_name}`;

const periods = await all('pay_periods', 'id, start_date, end_date, status', org.id, 'start_date');
const periodOn = (workday) => periods.find((p) => workday >= p.start_date && workday <= p.end_date) ?? null;

const sheets = await all(
  'timesheets',
  'id, employee_id, location_id, workday, clock_in, clock_out, unpaid_break_minutes, source_payload',
  org.id,
  'id',
);
console.log(`Database: ${employees.length} employees, ${periods.length} pay periods, ${sheets.length} timesheets.`);

// The waiver set. Returns zero rows today — FMP's 51 ticks were dropped at the
// 020 load and no card has been filed — but asked for rather than assumed,
// because a waiver changes the ANSWER and not just the presentation.
const { data: waiverRows } = await db
  .from('employee_documents').select('employee_id').eq('kind', 'meal_break_waiver');
const waivers = new Set((waiverRows ?? []).map((w) => w.employee_id));
if (waivers.size) console.log(`         ${waivers.size} employees have a signed meal-break waiver on file.`);

/* -------------------------------------------------------------------------- */
/* 3. What OUR rule says about each of those workdays                          */
/* -------------------------------------------------------------------------- */

const byDay = new Map(); // employee_id|workday → { shifts[], location_id }
for (const s of sheets) {
  const k = `${s.employee_id}|${s.workday}`;
  let e = byDay.get(k);
  if (!e) { e = { shifts: [], location_id: null }; byDay.set(k, e); }
  e.shifts.push(s);
  if (e.location_id === null) e.location_id = s.location_id;
}

/** Our finding for a workday, plus the hours it turned on. */
function ours(entry, employeeId) {
  const bs = entry.shifts.map(toBreakShift);
  const hours = bs.reduce((a, b) => a + (b.hours ?? 0), 0);
  const findings = assessWorkday(bs, { hasMealWaiver: waivers.has(employeeId) });
  return { hours, finding: findings[0] ?? null };
}

/* -------------------------------------------------------------------------- */
/* 4. The diff — does FileMaker's reason resolve our excess, or contradict it?  */
/* -------------------------------------------------------------------------- */

const planned = [];
const skipped = { noEmployee: new Map(), noPeriod: [], noTimesheet: [] };
const resolved = [];  // we flag, FMP explained, and the day is short enough to believe
const contested = []; // we flag, FMP explained, but a meal was genuinely required
const quiet = [];     // FMP explained a day we do not flag at all
const unchecked = []; // a reason, but no timesheet loaded to check it against

for (const e of fmp.values()) {
  const employee = employeeByLegacy.get(e.legacy);
  if (!employee) {
    const label = `${nameByLegacy.get(e.legacy) ?? '?'} (FMP id ${e.legacy})`;
    skipped.noEmployee.set(label, (skipped.noEmployee.get(label) ?? 0) + 1);
    continue;
  }

  const period = periodOn(e.workday);
  if (!period) { skipped.noPeriod.push({ who: nameOf(employee), workday: e.workday }); continue; }

  const key = `${employee.id}|${e.workday}`;
  const day = byDay.get(key);
  const verdict = day ? ours(day, employee.id) : null;

  const entry = {
    who: nameOf(employee), workday: e.workday, hours: verdict?.hours ?? null,
    code: verdict?.finding?.code ?? null, reason: e.reasons.join(' / '),
  };

  // `waivable` is breakRules' own word for "a signed waiver would cover this",
  // which is true exactly on the short no-meal shifts these reasons describe.
  // A non-waivable finding — a SHORT meal, a LATE meal, a missed meal on a long
  // day — is FileMaker saying "not needed" where one really was required.
  let bucket;
  if (!verdict) { bucket = 'unchecked'; unchecked.push(entry); }
  else if (!verdict.finding) { bucket = 'quiet'; quiet.push(entry); }
  else if (verdict.finding.waivable) { bucket = 'resolved'; resolved.push(entry); }
  else { bucket = 'contested'; contested.push(entry); }

  if (!day) skipped.noTimesheet.push(entry);

  planned.push({
    _bucket: bucket,
    org_id: org.id,
    employee_id: employee.id,
    location_id: day?.location_id ?? null,
    workday: e.workday,
    kind: 'meal',
    decision: 'not_owed',
    // HOURS, and ZERO is the whole point. 029 defaults this to 1.00, and
    // timesheets/page.tsx builds its worksheet Premium column by summing EVERY
    // premium's hours regardless of decision (only the Gusto file filters on
    // 'owed'). Letting the default stand would put ten thousand phantom premium
    // hours on screen. ShiftDecisions.tsx writes `decision === "owed" ? 1 : 0`;
    // this matches it.
    hours: 0,
    reason: `${REASON_PREFIX}: ${e.reasons.join(' / ')}`.slice(0, 1000),
    // Left null deliberately. Nobody made this decision in this app.
    decided_by: null,
    _who: nameOf(employee),
  });
}

console.log(`\n── WHAT OUR RULE SAYS ABOUT THOSE DAYS ──`);
console.log(`  We flag a violation, FileMaker explained it, and the shift was short
  enough that a waiver or "no meal required" is believable:  ${resolved.length}`);
console.log(`  We flag a violation FileMaker explained away on a day a meal WAS
  genuinely required:                                        ${contested.length}`);
console.log(`  FileMaker explained a day we do not flag at all:            ${quiet.length}`);
console.log(`  A reason, but no timesheet loaded to check it against:      ${unchecked.length}`);

if (contested.length) {
  const byCode = new Map();
  for (const c of contested) byCode.set(c.code, (byCode.get(c.code) ?? 0) + 1);
  console.log(`\n  THE CONTESTED DAYS — ${INCLUDE_CONTESTED ? 'WRITTEN (--include-contested)' : 'SKIPPED'}.`);
  console.log(`  By finding: ${[...byCode].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`  A waiver covers SKIPPING a meal on a short shift, not taking a ten-minute`);
  console.log(`  one, so a short_meal here is a violation the reason describes rather than`);
  console.log(`  waives. Recording these as 'not_owed' would clear them out of the review`);
  console.log(`  queue on the side that costs somebody an hour. Re-run with`);
  console.log(`  --include-contested to write them anyway.`);
  for (const c of contested.slice(0, 25)) {
    console.log(`    · ${c.who.padEnd(26)} ${c.workday}  ${(c.hours ?? 0).toFixed(2)}h  ${String(c.code).padEnd(14)} ${c.reason.slice(0, 46)}`);
  }
  if (contested.length > 25) console.log(`    … and ${contested.length - 25} more`);
}

if (skipped.noEmployee.size) {
  console.log(`\n  SKIPPED — FMP employee id matches nobody in this database:`);
  for (const [label, n] of [...skipped.noEmployee].sort((a, b) => b[1] - a[1])) {
    console.log(`    · ${label} — ${n} day(s)`);
  }
}
if (skipped.noPeriod.length) {
  console.log(`\n  SKIPPED — no pay period covers the day, so the row could never be seen`);
  console.log(`  or corrected on any screen. Load these once the period exists:`);
  for (const s of skipped.noPeriod.slice(0, 15)) console.log(`    · ${s.who.padEnd(26)} ${s.workday}`);
  if (skipped.noPeriod.length > 15) console.log(`    … and ${skipped.noPeriod.length - 15} more`);
}
if (skipped.noTimesheet.length) {
  console.log(`\n  ${skipped.noTimesheet.length} day(s) have a reason but no timesheet loaded — written anyway`);
  console.log(`  (the decision stands on its own), but our rule could not be checked against them.`);
}

const writable = planned.filter((p) => INCLUDE_CONTESTED || p._bucket !== 'contested');

console.log(`\n  ── VERDICT ──`);
console.log(`  Excess findings this resolves:      ${resolved.length}`);
console.log(`  Findings it argues with (skipped):  ${contested.length}`);
console.log(`  Rows to write:                      ${writable.length}`);
console.log(`\n  Known impurity: the 07/20–08/02 fortnight still holds 6 rows with hours`);
console.log(`  over-counted by the Homebase \`Unpaid breaks\` bug, corrected only by`);
console.log(`  re-importing that file. They are inside the numbers above.`);

/* -------------------------------------------------------------------------- */
/* 5. Write                                                                    */
/* -------------------------------------------------------------------------- */

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --apply once the diff above reads right.\n`);
  process.exit(0);
}

const existing = await all('break_premiums', 'id, employee_id, workday, kind', org.id, 'id');
const existingKey = new Set(existing.map((e) => `${e.employee_id}|${e.workday}|${e.kind}`));

// NEVER UPSERT. `ShiftDecisions` upserts on 029's cap key on purpose, so that
// recording from the second shift of a day CHANGES the decision rather than
// colliding. A BACKFILL is the opposite case: a human's answer, entered in this
// app, must never be overwritten by FileMaker's. Skip and count instead.
const fresh = writable.filter((p) => !existingKey.has(`${p.employee_id}|${p.workday}|${p.kind}`));
const held = writable.length - fresh.length;
if (held) console.log(`\n${held} day(s) already carry a decision in this app — left exactly as they are.`);

let written = 0;
for (let i = 0; i < fresh.length; i += 500) {
  const batch = fresh.slice(i, i + 500).map(({ _who, _bucket, ...row }) => row);
  const { data, error } = await db.from('break_premiums').insert(batch).select('id');
  if (error) throw new Error(`batch at ${i}: ${error.message}`);
  written += (data ?? []).length;
  process.stdout.write(`\r  written ${written}/${fresh.length}`);
}
console.log(`\n\nWrote ${written} 'not_owed' meal decisions. ${held} existing left alone.\n`);
