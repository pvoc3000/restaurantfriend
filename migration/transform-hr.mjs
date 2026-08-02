#!/usr/bin/env node
// ============================================================================
// transform-hr.mjs — FMP DF-Employees → employees.json
//
//   node transform-hr.mjs              # dry run: the full report, no output
//   node transform-hr.mjs --write      # writes ../../FMP Export/transformed/employees.json
//
// Reads `FMP Export/HR/Employees.mer` and produces the shape migration 020
// wants. Dry run by default and LOUD about vocabularies — the position list
// has typo-duplicates ("Sr. DF" and "Sr.DF") that get normalised here once,
// and Mark should read that table before anything is written.
//
// The OUTPUT LIVES OUTSIDE THE REPO, like every other transform: this is the
// most sensitive data the system holds — names, home addresses, dates of
// birth. (No SSN and no pay: those are deliberately not exported at all. See
// docs/hr-access-brief.md and the field list in migration/field-map.md.)
//
// ---------------------------------------------------------------------------
// ABOUT THE FIELD NAMES
//
// The export that exists today is a LAYOUT export — 14 columns, missing the
// employee id and most of what the record actually holds — so a re-export with
// an explicit field list is required before this script is useful. Eight
// column names are KNOWN from that existing file (Status, Email, Phone,
// Position, Location, Schedule, Start_Date, FHC_Ex_Date); the rest are
// guessed from the FMP layout's labels, so each field below carries a list of
// CANDIDATE names and the script matches whichever it finds,
// case-insensitively.
//
// If it can't find one it says so by name and stops. That is the intended
// behaviour: a silently-missing column would load 445 people with no
// addresses.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR', 'Employees.mer');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'employees.json');
const APPLY = process.argv.includes('--write');

/** Between the lines of a multi-line text field, once exported. */
const VT = String.fromCharCode(0x0b);

if (!existsSync(MER)) {
  console.error(`No Employees.mer at ${MER} (override with MER_DIR=…)`);
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
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// UTF-8, NOT latin1 — backfill-locations.mjs reads latin1 because the location
// export is pure ASCII. These files carry accented names, and latin1 would
// mangle every one of them.
const rows = parseCSV(readFileSync(MER, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
if (rows.length < 2) {
  console.error('Employees.mer has no data rows.');
  process.exit(1);
}

const header = rows[0].map((h) => h.trim());
const body = rows.slice(1);

// --- field resolution -------------------------------------------------------

/** column name → index, case-insensitive. */
const byName = new Map(header.map((h, i) => [h.toLowerCase(), i]));

/**
 * Each field names the column(s) it might be exported as. `required: false`
 * means the app has a nullable column waiting and the export may simply not
 * have the field (End Date is the known case — FMP never recorded one).
 */
const FIELDS = {
  legacy_id:            { required: true,  names: ['employeeid', 'employee_id', 'employee id', 'employeeid_n', 'id_employee', 'idemployee', '_primarykey_n', 'eid'] },
  status:               { required: true,  names: ['status'] },
  last_name:            { required: true,  names: ['name_last', 'last_name', 'lastname', 'last name', 'namelast'] },
  first_name:           { required: true,  names: ['name_first', 'first_name', 'firstname', 'first name', 'namefirst'] },
  nickname:             { required: false, names: ['nicname', 'nickname', 'name_nickname', 'nick_name', 'nicname_t'] },
  phone:                { required: false, names: ['phone'] },
  email:                { required: false, names: ['email'] },
  address:              { required: false, names: ['address', 'address_full', 'address_c', 'street'] },
  date_of_birth:        { required: false, names: ['dob', 'date_of_birth', 'dateofbirth', 'birthdate', 'date_birth', 'dob_d'] },
  location_code:        { required: false, names: ['location'] },
  schedule:             { required: false, names: ['schedule'] },
  employment_type:      { required: false, names: ['employmenttype', 'employment_type', 'employment type', 'emp_type'] },
  start_date:           { required: false, names: ['start_date', 'startdate', 'date_start'] },
  end_date:             { required: false, names: ['end_date', 'enddate', 'date_end', 'termination_date'] },
  position:             { required: false, names: ['position'] },
  notes:                { required: false, names: ['notes', 'note'] },
  food_handler_expires: { required: false, names: ['fhc_ex_date', 'fhc_exp_date', 'fhcexdate', 'food_handler_expires'] },
  // Never loaded into a column — it only tells us who had FMP access, to seed
  // the invite roster.
  _fmp_user_level:      { required: false, names: ['userlevel', 'user_level', 'user level', 'level', 'privilege', 'userlevel_n'] },
};

const index = {};
const missing = [];
for (const [field, spec] of Object.entries(FIELDS)) {
  const hit = spec.names.map((n) => byName.get(n)).find((i) => i !== undefined);
  if (hit === undefined) {
    if (spec.required) missing.push(field);
    index[field] = null;
  } else {
    index[field] = hit;
  }
}

if (missing.length) {
  console.error('\nThis export is missing columns the app needs:\n');
  for (const f of missing) {
    console.error(`  ${f}  — expected one of: ${FIELDS[f].names.join(', ')}`);
  }
  console.error(`\nColumns actually present (${header.length}):\n  ${header.join(', ')}\n`);
  console.error(
    'Re-export from DF-Employees with File → Export Records → Merge, choosing\n' +
    'the fields EXPLICITLY in the dialog (not whatever the current layout shows),\n' +
    'character set UTF-8. See migration/field-map.md for the full list.\n' +
    '\n' +
    'If a field genuinely has a different name in FileMaker, add it to the\n' +
    'candidate list in FIELDS above rather than renaming it in FMP.\n'
  );
  process.exit(1);
}

const get = (row, field) => {
  const i = index[field];
  return i === null ? '' : (row[i] ?? '').trim();
};

// --- coercers ---------------------------------------------------------------

const problems = [];
const note = (row, message) => problems.push(`row ${row}: ${message}`);

/** In-field line breaks come across as 0x0b. */
const text = (v) => {
  const s = String(v ?? '').split(VT).join('\n').trim();
  return s === '' ? null : s;
};

/**
 * FMP dates are unpadded M/D/YYYY. One row in the existing export uses dashes
 * instead of slashes, so both separators are accepted.
 */
function date(v, rowNo, field) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) {
    note(rowNo, `${field} is not a date I understand: "${s}" — left empty`);
    return null;
  }
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const STATUS = {
  'active': 'active',
  'new hire': 'new_hire',
  'newhire': 'new_hire',
  'inactive': 'inactive',
};

const SCHEDULE = {
  'part time': 'part_time',
  'part time +': 'part_time_plus',
  'full time': 'full_time',
  'full time +': 'full_time_plus',
  // FMP's own "not applicable" spellings, all of which mean null.
  'n/a': null, 'n-a': null, 'na': null,
};

/**
 * Position is free text with typo-duplicates. Collapse whitespace, then fold
 * the known variants. Everything else is passed through as typed — this is a
 * vocabulary, not a closed set, and inventing canonical forms for values Mark
 * hasn't seen would be worse than leaving them.
 */
const POSITION_FIXES = new Map([
  ['sr.df', 'Sr. DF'],
  ['sr. df', 'Sr. DF'],
  ['sr.ab', 'Sr. AB'],
  ['sr. ab', 'Sr. AB'],
  ['sr.baker', 'Sr. Baker'],
  ['sr. baker', 'Sr. Baker'],
  // A Schedule value that leaked into the Position column on one row.
  ['part time', null],
  // A bare honorific, which says nothing.
  ['sr.', null],
]);

function position(v) {
  const raw = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (raw === '') return null;
  const key = raw.toLowerCase();
  if (POSITION_FIXES.has(key)) return POSITION_FIXES.get(key);
  return raw;
}

// --- transform --------------------------------------------------------------

const employees = [];
const seenLegacy = new Map();
const positionsBefore = new Map();
const positionsAfter = new Map();
const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

body.forEach((row, i) => {
  const rowNo = i + 2; // 1-based, and the header is row 1.

  const first = text(get(row, 'first_name'));
  const last = text(get(row, 'last_name'));
  if (!first || !last) {
    note(rowNo, 'no first or last name — SKIPPED (both are NOT NULL)');
    return;
  }

  const rawStatus = get(row, 'status').toLowerCase();
  const status = STATUS[rawStatus];
  if (status === undefined) {
    note(rowNo, `unknown Status "${get(row, 'status')}" — SKIPPED`);
    return;
  }

  const rawSchedule = get(row, 'schedule').toLowerCase();
  let schedule = null;
  if (rawSchedule !== '') {
    if (!(rawSchedule in SCHEDULE)) {
      note(rowNo, `unknown Schedule "${get(row, 'schedule')}" — left empty`);
    } else {
      schedule = SCHEDULE[rawSchedule];
    }
  }

  const legacyRaw = get(row, 'legacy_id');
  const legacy_id = legacyRaw === '' ? null : Number(legacyRaw);
  if (legacy_id !== null && !Number.isInteger(legacy_id)) {
    note(rowNo, `employee id "${legacyRaw}" is not a whole number — left empty`);
  }
  const cleanLegacy = Number.isInteger(legacy_id) ? legacy_id : null;
  if (cleanLegacy !== null) {
    if (seenLegacy.has(cleanLegacy)) {
      note(rowNo, `employee id ${cleanLegacy} also used by row ${seenLegacy.get(cleanLegacy)}`);
    } else {
      seenLegacy.set(cleanLegacy, rowNo);
    }
  }

  const rawPosition = get(row, 'position');
  if (rawPosition.trim() !== '') tally(positionsBefore, rawPosition.trim());
  const cleanPosition = position(rawPosition);
  if (cleanPosition) tally(positionsAfter, cleanPosition);

  const start = date(get(row, 'start_date'), rowNo, 'Start date');
  const end = date(get(row, 'end_date'), rowNo, 'End date');
  if (start && end && end < start) {
    note(rowNo, `end date ${end} is before start date ${start} — both kept, worth a look`);
  }

  const dob = date(get(row, 'date_of_birth'), rowNo, 'Date of birth');
  if (dob && dob > new Date().toISOString().slice(0, 10)) {
    note(rowNo, `date of birth ${dob} is in the future — kept, worth a look`);
  }

  employees.push({
    legacy_id: cleanLegacy,
    status,
    last_name: last,
    first_name: first,
    nickname: text(get(row, 'nickname')),
    phone: text(get(row, 'phone')),
    email: text(get(row, 'email')),
    address: text(get(row, 'address')),
    date_of_birth: dob,
    // Carried as a CODE; load-hr.mjs resolves it against the real locations
    // table, so an unknown code is caught there against live data rather than
    // guessed at here.
    location_code: text(get(row, 'location_code')),
    schedule,
    employment_type: text(get(row, 'employment_type')),
    start_date: start,
    end_date: end,
    position: cleanPosition,
    notes: text(get(row, 'notes')),
    food_handler_expires: date(get(row, 'food_handler_expires'), rowNo, 'Food handler expiry'),
    _fmp_user_level: text(get(row, '_fmp_user_level')),
  });
});

// --- report -----------------------------------------------------------------

const count = (rows, key) => {
  const m = new Map();
  for (const r of rows) tally(m, r[key] ?? '(none)');
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\nEmployees.mer — ${body.length} rows in, ${employees.length} transformed\n`);

console.log('Status');
for (const [k, n] of count(employees, 'status')) console.log(`  ${String(n).padStart(4)}  ${k}`);

console.log('\nSchedule');
for (const [k, n] of count(employees, 'schedule')) console.log(`  ${String(n).padStart(4)}  ${k}`);

console.log('\nLocation');
for (const [k, n] of count(employees, 'location_code')) console.log(`  ${String(n).padStart(4)}  ${k}`);

console.log('\nPosition — as exported → as loaded');
const changed = [];
for (const [raw, n] of [...positionsBefore.entries()].sort((a, b) => b[1] - a[1])) {
  const after = position(raw);
  const same = after === raw;
  console.log(`  ${String(n).padStart(4)}  ${raw}${same ? '' : `   →   ${after ?? '(cleared)'}`}`);
  if (!same) changed.push(raw);
}
console.log(
  `  ${positionsBefore.size} distinct in the export → ${positionsAfter.size} after normalising` +
  (changed.length ? ` (${changed.length} changed)` : '')
);

const withUserLevel = employees.filter((e) => e._fmp_user_level);
if (withUserLevel.length) {
  console.log(`\nFMP user levels (who had access — for the invite roster, not loaded)`);
  for (const [k, n] of count(withUserLevel, '_fmp_user_level')) {
    console.log(`  ${String(n).padStart(4)}  level ${k}`);
  }
}

const filled = (key) => employees.filter((e) => e[key] !== null && e[key] !== '').length;
console.log('\nFill rate');
for (const key of ['legacy_id', 'email', 'phone', 'address', 'date_of_birth',
                   'start_date', 'end_date', 'employment_type', 'notes',
                   'food_handler_expires']) {
  const n = filled(key);
  console.log(`  ${String(n).padStart(4)}/${employees.length}  ${key}`);
}

if (problems.length) {
  console.log(`\n${problems.length} thing${problems.length === 1 ? '' : 's'} worth reading:`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Read the position table above, then re-run with --write.\n`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(employees, null, 2));
console.log(`\nWrote ${employees.length} employees to ${OUT}`);
console.log('That file is OUTSIDE the repo and holds personal data — leave it there.\n');
