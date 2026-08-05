#!/usr/bin/env node
// ============================================================================
// transform-payperiods.mjs — FMP PayPeriods → pay_periods.json
//
//   node transform-payperiods.mjs            # dry run: the full report
//   node transform-payperiods.mjs --write    # writes ../../FMP Export/transformed/pay_periods.json
//
// Reads `FMP Export/HR/PayPeriods.mer` and produces the shape migration 027
// wants. Dry run by default, and LOUD about the calendar's shape — the brief
// (decision 9) rests on a claim about these 178 rows, and this script is where
// that claim is re-checked against the file rather than taken on trust.
//
// The output follows the house pattern and lands OUTSIDE the repo, beside
// employees.json. Nothing here is sensitive — a pay period is two dates and a
// status — but the loader reads one directory and mixing conventions is how
// you end up with two.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It does not invent the CURRENT pay period. The export ends at the last
// CLOSED fortnight (2026-08-02), so after this load there is no open period —
// which is correct: this script loads HISTORY, and every row it writes is
// `closed` and therefore read-only by construction (decision 8).
//
// Opening the next fortnight is the app's job, through `nextPeriodAfter` in
// web/src/lib/payPeriods.ts. Putting that arithmetic here as well would be
// migration 016's `nextDeliveryDate` trap — two implementations of one rule,
// drifting the moment either is touched.
//
// It also carries no COLUMNS from the file beyond four. PayPeriods.mer has 25,
// and the other 21 are FileMaker globals (gStartDate, gPrintReport), unstored
// calculations over the timesheets (cTotalHours, cTotalLabor, cTotalSales), or
// rate-card fields. The totals are derivable from the timesheets we're about to
// load and would go stale the moment anyone edits one; the rate cards are
// wages, which decision 1 refuses outright. Field allow-list, not a drop-list —
// the same design as transform-hr.mjs, and the reason a re-export carrying new
// sensitive columns can't silently start importing them.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR', 'PayPeriods.mer');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'pay_periods.json');
const APPLY = process.argv.includes('--write');

if (!existsSync(MER)) {
  console.error(`No PayPeriods.mer at ${MER} (override with MER_DIR=…)`);
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

// UTF-8, matching transform-hr.mjs. This file is pure ASCII today, but reading
// it as latin1 would silently mangle a note someone types with an accent.
const rows = parseCSV(readFileSync(MER, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = rows.shift().map((h) => h.trim());
const idx = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));

/** Match a column case-insensitively against candidate names; null if absent. */
const column = (...candidates) => {
  for (const c of candidates) {
    const i = idx[c.toLowerCase()];
    if (i !== undefined) return i;
  }
  return null;
};

const FIELDS = {
  legacy_id:  column('PayPeriodID'),
  start_date: column('Start Date', 'StartDate'),
  end_date:   column('End Date', 'EndDate'),
  notes:      column('Note', 'Notes'),
};

const missing = Object.entries(FIELDS).filter(([, i]) => i === null).map(([k]) => k);
if (missing.length) {
  console.error(`PayPeriods.mer is missing: ${missing.join(', ')}`);
  console.error(`Columns present: ${header.join(', ')}`);
  console.error('Refusing to guess — a silently-missing column loads a calendar with no dates.');
  process.exit(1);
}

const get = (row, field) => String(row[FIELDS[field]] ?? '').trim();

/** M/D/YYYY → YYYY-MM-DD, or null. A round trip, never a regex alone: */
/*  new Date("2026-02-31") does not fail, it rolls over to March 2nd.        */
const toISO = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};
const dayMs = 86400000;
const asDate = (iso) => new Date(`${iso}T00:00:00Z`).getTime();

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
const periods = [];
const rejected = [];

for (const row of rows) {
  const legacy_id = get(row, 'legacy_id');
  const startRaw = get(row, 'start_date');
  const endRaw = get(row, 'end_date');
  const start_date = toISO(startRaw);
  const end_date = toISO(endRaw);

  if (!legacy_id) { rejected.push({ why: 'no PayPeriodID', startRaw, endRaw }); continue; }
  if (!start_date || !end_date) {
    rejected.push({ why: 'unparsable date', legacy_id, startRaw, endRaw });
    continue;
  }
  if (asDate(end_date) < asDate(start_date)) {
    rejected.push({ why: 'ends before it starts', legacy_id, start_date, end_date });
    continue;
  }

  periods.push({
    legacy_id,
    start_date,
    end_date,
    // Every row in this file is a fortnight that has already been paid.
    // Decision 8: historical loads land in already-closed periods and are
    // read-only by construction, so 028's write policies refuse them without
    // needing a flag of their own.
    status: 'closed',
    notes: get(row, 'notes') || null,
  });
}

periods.sort((a, b) => asDate(a.start_date) - asDate(b.start_date));

// ---------------------------------------------------------------------------
// Re-check the brief's claim about the calendar
// ---------------------------------------------------------------------------
const lengths = new Map();
const startDows = new Map();
const gaps = [];
const overlaps = [];
const dupIds = [];

const seenId = new Set();
let prev = null;
for (const p of periods) {
  const len = (asDate(p.end_date) - asDate(p.start_date)) / dayMs + 1;
  lengths.set(len, (lengths.get(len) ?? 0) + 1);
  const dow = new Date(`${p.start_date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const iso = dow === 0 ? 7 : dow;
  startDows.set(iso, (startDows.get(iso) ?? 0) + 1);

  if (seenId.has(p.legacy_id)) dupIds.push(p.legacy_id);
  seenId.add(p.legacy_id);

  if (prev) {
    const delta = (asDate(p.start_date) - asDate(prev.end_date)) / dayMs;
    if (delta > 1) gaps.push({ after: prev.legacy_id, from: prev.end_date, to: p.start_date, days: delta - 1 });
    // OVERLAP is the only one of these the database itself refuses
    // (027's pay_periods_no_overlap), so it is the only one that must be fatal.
    if (delta <= 0) overlaps.push({ a: prev.legacy_id, b: p.legacy_id, aEnd: prev.end_date, bStart: p.start_date });
  }
  prev = p;
}

const WEEKDAY = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
const pct = (n) => `${((100 * n) / periods.length).toFixed(1)}%`;

console.log(`\nPayPeriods.mer — ${rows.length} rows → ${periods.length} periods\n`);
console.log(`  range            ${periods[0]?.start_date} → ${periods.at(-1)?.end_date}`);
console.log(`  lengths          ${[...lengths].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} days ×${n} (${pct(n)})`).join(', ')}`);
console.log(`  starts on        ${[...startDows].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${WEEKDAY[d]} ×${n} (${pct(n)})`).join(', ')}`);
console.log(`  gaps             ${gaps.length}`);
console.log(`  overlaps         ${overlaps.length}`);
console.log(`  duplicate ids    ${dupIds.length}`);
console.log(`  with a note      ${periods.filter((p) => p.notes).length}`);
console.log(`  status           closed ×${periods.length}  (history; the app opens the next one)`);

if (gaps.length) {
  console.log('\n  GAPS — not fatal (the schema forbids overlap, not gaps), but each is a');
  console.log('  fortnight with no home for its timesheets:');
  for (const g of gaps.slice(0, 20)) console.log(`    ${g.days} day(s) between ${g.from} and ${g.to}`);
}

if (rejected.length) {
  console.log(`\n  REJECTED ${rejected.length} row(s):`);
  for (const r of rejected.slice(0, 20)) console.log(`    ${JSON.stringify(r)}`);
}

// ---------------------------------------------------------------------------
// Refuse rather than write something the database will reject halfway through
// ---------------------------------------------------------------------------
// strip-section-prefix.mjs set this precedent: a half-applied run is worse than
// no run. 027's exclusion constraint would reject an overlapping period, and it
// would do so AFTER the rows before it had already committed.
const fatal = [];
if (overlaps.length) fatal.push(`${overlaps.length} overlapping period(s) — 027's exclusion constraint will reject these`);
if (dupIds.length) fatal.push(`${dupIds.length} duplicate PayPeriodID(s) — the unique index will reject these`);
if (!periods.length) fatal.push('no periods parsed at all');

if (fatal.length) {
  console.error('\nREFUSING TO WRITE:');
  for (const f of fatal) console.error(`  · ${f}`);
  for (const o of overlaps.slice(0, 10)) console.error(`    overlap: ${o.a} ends ${o.aEnd}, ${o.b} starts ${o.bStart}`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --write.\n');
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(periods, null, 2));
console.log(`\nWrote ${periods.length} periods → ${OUT}\n`);
