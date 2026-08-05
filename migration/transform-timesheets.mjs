#!/usr/bin/env node
// ============================================================================
// transform-timesheets.mjs — FMP Timesheets → timesheets.json
//
//   node transform-timesheets.mjs           # dry run: the full report
//   node transform-timesheets.mjs --write   # writes ../../FMP Export/transformed/timesheets.json
//
// Reads `FMP Export/HR/Timesheets.mer` (44,767 rows, 2019-10-07 → 2026-08-02)
// and produces the shape migration 028 wants. Dry run by default and LOUD:
// this is payroll history, and every row it can't read is named rather than
// guessed at.
//
// ---------------------------------------------------------------------------
// IT IMPORTS THE APP'S OWN TIME-ZONE MODULE, COMPILED
//
// Converting a wall time to an instant is the highest-risk arithmetic in the
// module — a wrong answer is a wrong number of overtime hours, twice a year,
// always for the overnight crew. That code is `web/src/lib/timeZone.ts` and it
// is fixture-tested; a second copy here would be untested and would drift,
// which is migration 016's `nextDeliveryDate` trap.
//
// So this script imports the COMPILED module out of web/.fixtures-build, and
// refuses to run if it isn't there. Run `npm run fixtures` in web/ first.
//
// ---------------------------------------------------------------------------
// FIELD ALLOW-LIST, NOT A DROP-LIST
//
// The file has 117 columns. This names the ~20 it wants and ignores the rest,
// so a future re-export carrying something new can't silently start importing
// it. What is deliberately NOT read:
//
//   ts_Rate, ts_Rate_Effective, ts_RateCard, ts_Cost_*, cTotal_Earnings …
//     WAGES. Decision 1: this module exports hours and tip dollars and never
//     stores a pay rate. 53 distinct rates are sitting in the file; none is
//     read. Same allow-list reasoning that keeps SSN out of transform-hr.mjs.
//
//   ts_OTHours_OverEight / _OverForty / _OverTwelve
//     Empty on all 44,767 rows in this era — FMP stopped bucketing OT and
//     writes ts_Hours_Overtime / _Double instead.
//
//   cTimeSheetError
//     FMP's DERIVED break-violation flag, on 10,143 rows. Decision 3 is that a
//     violation is derived and never stored, so importing it would be storing
//     a stale claim about punches we are also importing. It is preserved
//     verbatim inside source_payload, where it becomes the reference to check
//     lib/breakRules.ts against in phase 5 — which the brief thought didn't
//     exist.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR', 'Timesheets.mer');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'timesheets.json');
const APPLY = process.argv.includes('--write');
const ZONE = process.env.TZ_NAME ?? 'America/Los_Angeles';

const TZ_MODULE = resolve(HERE, '../web/.fixtures-build/src/lib/timeZone.js');
if (!existsSync(TZ_MODULE)) {
  console.error(`Missing ${TZ_MODULE}`);
  console.error('Run `npm run fixtures` in web/ first. This script imports the SAME');
  console.error('time-zone module the app uses rather than keeping a second, untested');
  console.error('copy of the DST arithmetic.');
  process.exit(1);
}
const { resolveLocal, hoursBetween } = await import(pathToFileURL(TZ_MODULE).href);

if (!existsSync(MER)) {
  console.error(`No Timesheets.mer at ${MER} (override with MER_DIR=…)`);
  process.exit(1);
}

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
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// UTF-8, not latin1: this file carries accented names (López Alarcon,
// Almonte Mejía) and latin1 would mangle every one of them.
const raw = parseCSV(readFileSync(MER, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = raw.shift().map((h) => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));

const column = (...names) => {
  for (const n of names) { const i = idx[n.toLowerCase()]; if (i !== undefined) return i; }
  return null;
};

const F = {
  employee:   column('ts_EmployeeID'),
  full_name:  column('cFullName'),
  location:   column('ts_Location'),
  date_start: column('ts_Date_Start'),
  date_end:   column('ts_Date_End'),
  time_in:    column('ts_Time_Shift_Start'),
  time_out:   column('ts_Time_Shift_End'),
  break_in:   column('ts_Time_Break_Start'),
  break_out:  column('ts_Time_Break_End'),
  break_hrs:  column('ts_Hours_Break'),
  break_type: column('ts_BreakType'),
  hrs_regular: column('ts_Hours_Regular'),
  hrs_ot:      column('ts_Hours_Overtime'),
  hrs_dot:     column('ts_Hours_Overtime_Double'),
  hrs_paid:    column('ts_Hours_Paid'),
  hrs_sick:    column('ts_Hours_Sick'),
  hrs_sched:   column('ts_Hours_Scheduled'),
  position:    column('ts_Position'),
  source:      column('ts_ImportSource'),
  pay_period:  column('cPayPeriod'),
  exclude_tips: column('excludeTips'),
  note_emp:    column('ts_Note_Employee'),
  note_mgr:    column('ts_Note_Manager'),
  ts_error:    column('cTimeSheetError'),
  wage_type:   column('ts_Wage_Type'),
  leave_type:  column('ts_Leave_Type'),
};

const missing = Object.entries(F).filter(([, i]) => i === null).map(([k]) => k);
if (missing.length) {
  console.error(`Timesheets.mer is missing: ${missing.join(', ')}`);
  console.error('Refusing to guess — this is payroll history.');
  process.exit(1);
}

const get = (row, f) => String(row[F[f]] ?? '').trim();

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** M/D/YYYY → YYYY-MM-DD, round-tripped so 2/31 is refused rather than rolled. */
function toISO(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Three eras, three formats, measured over the file:
 *   12h "10:07pm"    38,534  Homebase
 *   24h "21:31:00"    6,051  Deputy (exactly the Deputy row count)
 *   hour-only "11pm"      7  hand entry
 * plus 3 with a space before the meridiem and one bare "21".
 *
 * The 2015–2019 export's hand-typed "midnig ht" literal (213 rows) does NOT
 * appear in this era — checked, zero occurrences.
 */
function toMinutes(v) {
  if (!v) return null;
  let m = /^(\d{1,2}):(\d{2})\s?(am|pm)$/i.exec(v);
  if (m) { let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + Number(m[2]); }
  m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})\s?(am|pm)$/i.exec(v);
  if (m) { let h = Number(m[1]) % 12; if (/pm/i.test(m[2])) h += 12; return h * 60; }
  return null;
}

const num = (v) => { if (v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Six spellings for three shops, measured: DF01 21,507 · DF02 17,676 ·
 * DF03 5,578 · DF2 3 · df01 2 · DF1 1. Nearly clean — the 2015–2019 era had
 * "DF Highland Park" and "Donut Friend" as separate spellings and this one
 * doesn't.
 *
 * Business data, so at RUNTIME it belongs in orgs.settings.timesheet_import
 * (design rule 2). Here it is a default the loader can override, because the
 * transform runs before anyone has configured anything.
 */
const LOCATION_ALIASES = { DF1: 'DF01', DF2: 'DF02', DF3: 'DF03' };
const normalizeLocation = (v) => {
  const up = v.trim().toUpperCase();
  if (!up) return null;
  return LOCATION_ALIASES[up] ?? up;
};

/* -------------------------------------------------------------------------- */
/* Transform                                                                   */
/* -------------------------------------------------------------------------- */

const out = [];
const rejected = [];
const counts = {
  crossing: 0, inferredCrossing: 0, endDateContradicted: 0, ambiguous: 0, nonexistent: 0,
  noClockOut: 0, noEmployee: 0, noLocation: 0, sick: 0, withBreakPunch: 0,
};
const locationTally = new Map();
const sourceTally = new Map();
const ambiguousRows = [];
/** (employee, workday) → how many rows already seen, for the occurrence ordinal. */
const seen = new Map();

for (const row of raw) {
  const employee_legacy_id = get(row, 'employee');
  const workday = toISO(get(row, 'date_start'));
  const rawIn = get(row, 'time_in');
  const rawOut = get(row, 'time_out');
  const name = get(row, 'full_name');

  if (!workday) { rejected.push({ why: 'unparsable ts_Date_Start', date: get(row, 'date_start'), name }); continue; }
  if (!employee_legacy_id) { counts.noEmployee++; }

  const minIn = toMinutes(rawIn);
  const minOut = toMinutes(rawOut);

  // A row with no clock-out is a real thing (someone forgot), not a parse
  // failure. Keep it — the shift happened — and let the screen show the gap.
  if (rawIn && minIn === null) {
    rejected.push({ why: 'unparsable clock-in', value: rawIn, date: workday, name });
    continue;
  }
  if (rawOut && minOut === null) {
    rejected.push({ why: 'unparsable clock-out', value: rawOut, date: workday, name });
    continue;
  }
  if (minOut === null) counts.noClockOut++;

  // ts_Date_End is FILLED on 38,712 rows in this era and is what makes a
  // crossing shift ONE whole row — 1,148 of 1,148 crossing rows carry
  // start + 1. (In the 2015–2019 export it was used on zero rows, which is
  // where the brief's "reassemble on import" premise came from.) Six rows wrap
  // without an end date; those get the day inferred, which is the only place
  // this script infers anything.
  // THE TIMES DECIDE, not the date. A shift crosses midnight iff its clock-out
  // wall time is earlier than its clock-in — that is what crossing MEANS, and
  // no real shift runs 24 hours or more.
  //
  // Trusting ts_Date_End instead produced a 30.58-hour shift: FMP has rows
  // dated 10/28 with ts_Date_End 10/29 whose punches are 12am → 7:05am, i.e.
  // wholly within one day with an end date that is simply wrong. FMP's own
  // stored hours say 7.58, and the times agree with FMP. So ts_Date_End is
  // corroboration, and where the two disagree the times win and it is counted.
  const dateEnd = toISO(get(row, 'date_end'));
  let outDayOffset = 0;
  if (minIn !== null && minOut !== null) {
    outDayOffset = minOut < minIn ? 1 : 0;
    if (outDayOffset === 1) {
      counts.crossing++;
      // No second date to corroborate — the day is inferred. Six rows.
      if (!dateEnd || dateEnd <= workday) counts.inferredCrossing++;
    } else if (dateEnd && dateEnd > workday) {
      // An end date a day later on a shift whose times don't wrap.
      counts.endDateContradicted++;
    }
  }

  const wall = (dateISO, minutes) => {
    const [y, mo, d] = dateISO.split('-').map(Number);
    return { year: y, month: mo, day: d, hour: Math.floor(minutes / 60), minute: minutes % 60 };
  };
  const addDay = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

  let clock_in = null, clock_out = null, ambiguity = null;
  if (minIn !== null) {
    const r = resolveLocal(ZONE, wall(workday, minIn));
    clock_in = new Date(r.instant).toISOString();
    if (r.ambiguity !== 'none') ambiguity = r.ambiguity;
  }
  if (minOut !== null) {
    const r = resolveLocal(ZONE, wall(addDay(workday, outDayOffset), minOut));
    clock_out = new Date(r.instant).toISOString();
    if (r.ambiguity !== 'none') ambiguity = ambiguity ?? r.ambiguity;
  }
  if (ambiguity === 'ambiguous') { counts.ambiguous++; }
  if (ambiguity === 'nonexistent') { counts.nonexistent++; }
  if (ambiguity && ambiguousRows.length < 40) {
    ambiguousRows.push({ name, workday, in: rawIn, out: rawOut, ambiguity });
  }

  // The punch-order constraint (028) refuses clock_out <= clock_in. A zero
  // length shift is 8 rows in the file; drop the clock-out rather than the row,
  // so the shift is still on the record as unfinished.
  if (clock_in && clock_out && new Date(clock_out) <= new Date(clock_in)) {
    clock_out = null;
    counts.noClockOut++;
  }

  const location_code = normalizeLocation(get(row, 'location'));
  if (!location_code) counts.noLocation++;
  else locationTally.set(location_code, (locationTally.get(location_code) ?? 0) + 1);

  const src = get(row, 'source') || 'FileMaker';
  sourceTally.set(src, (sourceTally.get(src) ?? 0) + 1);

  const sick = num(get(row, 'hrs_sick'));
  if (sick) counts.sick++;
  if (get(row, 'break_in')) counts.withBreakPunch++;

  // THE IDEMPOTENCY KEY. Neither this file (117 columns) nor the Homebase CSV
  // has a record id, so it is the natural tuple plus an OCCURRENCE ORDINAL
  // within (employee, workday). The ordinal is what stops the two genuinely
  // byte-identical duplicate rows in this file from collapsing into one and
  // silently losing a paid shift. Readable rather than hashed, so the DB row
  // explains itself when someone asks why two exist.
  const natural = [employee_legacy_id, workday, rawIn || '-', rawOut || '-', location_code ?? '-'].join('|');
  const n = (seen.get(natural) ?? 0) + 1;
  seen.set(natural, n);

  const breakMinutes = (() => {
    const h = num(get(row, 'break_hrs'));
    if (h === null) return null;
    // FMP stored the break in HOURS and the rounding shows: 0.52 appears on
    // hundreds of rows, which is 31.2 minutes and was nobody's intention.
    // 028 stores an integer because a meal is 30 or 45, never 0.4166.
    return Math.round(h * 60);
  })();

  out.push({
    employee_legacy_id: employee_legacy_id || null,
    employee_name: name || null,
    location_code,
    pay_period_legacy_id: get(row, 'pay_period') || null,
    workday,
    business_date: workday,
    clock_in,
    clock_out,
    source_hours_regular: num(get(row, 'hrs_regular')),
    source_hours_overtime: num(get(row, 'hrs_ot')),
    source_hours_double_ot: num(get(row, 'hrs_dot')),
    source_hours_paid: num(get(row, 'hrs_paid')),
    source_break_minutes: breakMinutes,
    // The historical load takes the source's word for it — that IS what was
    // paid — and `ot_decision: 'source'` records that nobody has re-checked.
    hours_regular: num(get(row, 'hrs_regular')),
    hours_overtime: num(get(row, 'hrs_ot')),
    hours_double_ot: num(get(row, 'hrs_dot')),
    ot_decision: 'source',
    unpaid_break_minutes: breakMinutes,
    sick_hours: sick,
    // FMP's excludeTips is a boolean-ish "1" on 359 rows. Absent means INHERIT
    // (null), not false — the tri-state's whole point.
    exclude_tips: get(row, 'exclude_tips') === '1' ? true : null,
    scheduled_hours: num(get(row, 'hrs_sched')),
    position: get(row, 'position') || null,
    employee_note: get(row, 'note_emp') || null,
    manager_note: get(row, 'note_mgr') || null,
    source: 'filemaker',
    source_row_key: `${natural}#${n}`,
    // Verbatim, so nothing is lost and a re-read is possible. cTimeSheetError
    // rides in here as the reference implementation for phase 5's break rules.
    source_payload: {
      import_source: src,
      date_start: get(row, 'date_start'),
      date_end: get(row, 'date_end'),
      time_in: rawIn,
      time_out: rawOut,
      break_start: get(row, 'break_in'),
      break_end: get(row, 'break_out'),
      break_type: get(row, 'break_type'),
      timesheet_error: get(row, 'ts_error'),
      wage_type: get(row, 'wage_type'),
      leave_type: get(row, 'leave_type'),
      occurrence: n,
      pay_period_legacy_id: get(row, 'pay_period') || null,
      ...(ambiguity ? { local_time_ambiguity: ambiguity } : {}),
    },
    stitched: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

const dates = out.map((r) => r.workday).sort();
const pct = (n) => `${((100 * n) / out.length).toFixed(1)}%`;

console.log(`\nTimesheets.mer — ${raw.length} rows → ${out.length} timesheets\n`);
console.log(`  range              ${dates[0]} → ${dates.at(-1)}`);
console.log(`  sources            ${[...sourceTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  locations          ${[...locationTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}${counts.noLocation ? ` · (none) ${counts.noLocation}` : ''}`);
console.log(`  crossing midnight  ${counts.crossing} (${pct(counts.crossing)}) — ${counts.inferredCrossing} with no ts_Date_End (day inferred), ${counts.endDateContradicted} rows whose ts_Date_End says +1 but whose times do not wrap (times win)`);
console.log(`  no clock-out       ${counts.noClockOut}`);
console.log(`  with a break punch ${counts.withBreakPunch}`);
console.log(`  sick hours         ${counts.sick}`);
console.log(`  rows with no employee id  ${counts.noEmployee}`);
console.log(`\n  DST — the hour that cannot be guessed:`);
console.log(`  ambiguous local times   ${counts.ambiguous}   (fall-back; resolved to the EARLIER instant)`);
console.log(`  nonexistent local times ${counts.nonexistent}   (spring-forward; resolved forward)`);
if (ambiguousRows.length) {
  for (const a of ambiguousRows.slice(0, 12)) {
    console.log(`     ${a.workday} ${String(a.in).padEnd(9)}→ ${String(a.out).padEnd(9)} ${a.name} [${a.ambiguity}]`);
  }
  console.log(`  Each is flagged in source_payload.local_time_ambiguity so it can be found again.`);
}

if (rejected.length) {
  console.log(`\n  REJECTED ${rejected.length} row(s) — named, never guessed at:`);
  for (const r of rejected.slice(0, 25)) console.log(`     ${JSON.stringify(r)}`);
}

// Sanity: do OUR instants agree with FMP's stored hours?
let checked = 0, agree = 0, disagree = [];
for (const r of out) {
  if (!r.clock_in || !r.clock_out || r.source_hours_paid === null) continue;
  const span = hoursBetween(new Date(r.clock_in).getTime(), new Date(r.clock_out).getTime());
  const ours = span - (r.unpaid_break_minutes ?? 0) / 60;
  checked++;
  if (Math.abs(ours - r.source_hours_paid) < 0.02) agree++;
  else if (disagree.length < 10) disagree.push({ d: r.workday, ours: +ours.toFixed(2), fmp: r.source_hours_paid, name: r.employee_name });
}
console.log(`\n  Cross-check against FMP's own stored hours:`);
console.log(`  ${agree} of ${checked} agree within 0.02h (${((100 * agree) / checked).toFixed(1)}%)`);
if (disagree.length) {
  console.log(`  Sample disagreements (expected on DST days, where FMP took the LATER instant):`);
  for (const d of disagree) console.log(`     ${d.d} ours ${d.ours} vs FMP ${d.fmp}  ${d.name}`);
}

const fatal = [];
if (!out.length) fatal.push('no rows parsed at all');
// A duplicate source_row_key would be refused by 028's unique index halfway
// through the load — strip-section-prefix.mjs's precedent: refuse the whole run.
const keys = new Set();
let dupKeys = 0;
for (const r of out) { if (keys.has(r.source_row_key)) dupKeys++; keys.add(r.source_row_key); }
if (dupKeys) fatal.push(`${dupKeys} duplicate source_row_key(s) — 028's unique index will reject these`);

if (fatal.length) {
  console.error('\nREFUSING TO WRITE:');
  for (const f of fatal) console.error(`  · ${f}`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --write.\n');
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${out.length} timesheets → ${OUT}\n`);
