#!/usr/bin/env node
/**
 * Restaurant Friend — fill in the location record (migration 017).
 *
 * Two jobs, one update per location:
 *
 *   1. Restore the nine FMP location fields worth having — tax rate, labor
 *      rate, register count, open days, opening/closing times, the per-weekday
 *      production location, and who this shop buys for. Most were dropped at
 *      transform time; the rest arrived as raw FileMaker text.
 *   2. Clear that raw text out of `settings`, which is left holding
 *      `email_provider` and nothing else.
 *
 * Everything is read from the raw export rather than from `settings`, because
 * `settings` never had the tax rate or the registers and its hours lost DF04's
 * missing slots. The .mer is the only complete source.
 *
 * NEVER touches code / kind / is_active / org_id — those are hand-seeded facts
 * (001) and FMP has nothing better to say about them.
 *
 * Requires migration 017 to have been applied first.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env backfill-locations.mjs            # dry run, writes nothing
 *     node --env-file=.env backfill-locations.mjs --apply    # actually write
 *
 * Idempotent: it derives everything from the .mer, so a second --apply writes
 * the same values again.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MER = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export', 'Location.mer');
const APPLY = process.argv.includes('--apply');

/** FileMaker's separators. 0x1D between repetitions of a repeating field; 0x0B
 *  between the lines of a multi-line text field (what a value list looks like
 *  once it's exported). */
const REP = String.fromCharCode(0x1d);
const VT = String.fromCharCode(0x0b);

/** The raw FMP keys this script's own columns replace. Removed from settings. */
const RETIRED_SETTINGS_KEYS = [
  'Location_OpenDays',
  'OperatingHours_Open_time',
  'OperatingHours_Close_time',
  'LaborRate_n',
  'Email_Billing',
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env backfill-locations.mjs');
  process.exit(1);
}
if (!existsSync(MER)) {
  console.error(`No Location.mer at ${MER} (override with MER_DIR=…)`);
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

const num = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** A repeating field, padded to seven slots. DF04 exports only five. */
const seven = (v) => {
  const parts = String(v ?? '').split(REP);
  return Array.from({ length: 7 }, (_, i) => (parts[i] ?? '').trim());
};

/** A multi-line text field as a list of non-empty lines. */
const lines = (v) =>
  String(v ?? '')
    .split(VT)
    .flatMap((s) => s.split('\n'))
    .map((s) => s.trim())
    .filter(Boolean);

const WEEKDAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** "MON" / "Wed" / "Sunday" → ISO weekday. Case- and length-insensitive: the
 *  export mixes all three. */
function weekday(name) {
  return WEEKDAY[String(name).trim().slice(0, 3).toLowerCase()] ?? null;
}

/**
 * "10am" / "10 AM" / "9 pm" / "10:30pm" / "13:00" → "HH:MM:00", else null.
 * The export is free text typed by hand over thirteen years, so this is
 * deliberately forgiving about spaces and case and deliberately strict about
 * anything it doesn't recognise — a misread closing time is worse than a blank.
 */
function time(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return null;
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = m[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

// ---------------------------------------------------------------------------

const rows = parseCSV(readFileSync(MER, 'latin1'));
const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
const NEEDED = [
  '__Location_ID', 'Location_TaxRate_n', 'LaborRate_n', 'NumberOfRegisters_n',
  'Location_OpenDays', 'OperatingHours_Open_time', 'OperatingHours_Close_time',
  'KitchenLocation', 'ShopForLocations_t', 'Email_Billing',
];
for (const col of NEEDED) {
  if (idx[col] === undefined) {
    console.error(`Location.mer has no ${col} column — wrong export?`);
    process.exit(1);
  }
}
const get = (r, col) => String(r[idx[col]] ?? '');

const { data: live, error: readError } = await db
  .from('locations')
  .select('id, code, name, address, settings')
  .order('code');
if (readError) { console.error('reading locations:', readError.message); process.exit(1); }

const idByCode = Object.fromEntries(live.map((l) => [l.code, l.id]));
const codeById = Object.fromEntries(live.map((l) => [l.id, l.code]));
/** Codes FMP names that we have no row for — reported, never invented. */
const unknownCodes = new Set();
const toId = (code) => {
  const c = String(code ?? '').trim();
  if (c === '') return null;
  if (!idByCode[c]) { unknownCodes.add(c); return null; }
  return idByCode[c];
};

const updates = [];
let noMerRow = 0;

for (const loc of live) {
  const row = rows.slice(1).find((r) => get(r, '__Location_ID').trim() === loc.code);
  if (!row) { noMerRow++; continue; }

  const openDays = [...new Set(lines(get(row, 'Location_OpenDays')).map(weekday).filter(Boolean))]
    .sort((a, b) => a - b);
  const openTimes = seven(get(row, 'OperatingHours_Open_time')).map(time);
  const closeTimes = seven(get(row, 'OperatingHours_Close_time')).map(time);
  const kitchen = seven(get(row, 'KitchenLocation')).map(toId);
  const shopsFor = lines(get(row, 'ShopForLocations_t')).map(toId).filter(Boolean);

  // All-null arrays say nothing; store null rather than seven nulls, which is
  // what the length constraint's "is null or 7" branch exists for.
  const someTime = openTimes.some(Boolean) || closeTimes.some(Boolean);

  const billingEmail = get(row, 'Email_Billing').trim() || null;
  const address = structuredClone(loc.address ?? {});
  if (billingEmail) {
    address.billing = { ...(address.billing ?? {}), email: billingEmail };
  }

  const settings = { ...(loc.settings ?? {}) };
  const stripped = RETIRED_SETTINGS_KEYS.filter((k) => k in settings);
  for (const k of stripped) delete settings[k];

  updates.push({
    id: loc.id,
    code: loc.code,
    strippedKeys: stripped,
    patch: {
      tax_rate: num(get(row, 'Location_TaxRate_n')),
      labor_rate: num(get(row, 'LaborRate_n')),
      register_count: num(get(row, 'NumberOfRegisters_n')),
      open_days: openDays,
      open_time_by_weekday: someTime ? openTimes : null,
      close_time_by_weekday: someTime ? closeTimes : null,
      kitchen_by_weekday: kitchen.some(Boolean) ? kitchen : null,
      shops_for: shopsFor,
      address,
      settings,
    },
  });
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (t) => (t ? t.slice(0, 5) : '—');

console.log(`Location.mer: ${rows.length - 1} rows · live locations: ${live.length}`);
if (noMerRow) console.log(`  ${noMerRow} live location(s) have no .mer row and are left alone`);
if (unknownCodes.size) {
  console.log(`  codes named by FMP with no location row (left null): ${[...unknownCodes].join(', ')}`);
}
console.log('');

for (const u of updates) {
  const p = u.patch;
  console.log(`${u.code}`);
  console.log(`  tax ${p.tax_rate ?? '—'} · labor ${p.labor_rate ?? '—'} · registers ${p.register_count ?? '—'}`);
  console.log(`  open days     ${p.open_days.length ? p.open_days.map((d) => DAYS[d - 1]).join(' ') : '—'}`);
  console.log(`  hours         ${
    p.open_time_by_weekday
      ? DAYS.map((d, i) => `${d} ${hhmm(p.open_time_by_weekday[i])}-${hhmm(p.close_time_by_weekday[i])}`).join('  ')
      : '—'
  }`);
  console.log(`  produced at   ${
    p.kitchen_by_weekday
      ? DAYS.map((d, i) => `${d} ${codeById[p.kitchen_by_weekday[i]] ?? '—'}`).join('  ')
      : '—'
  }`);
  console.log(`  shops for     ${p.shops_for.map((id) => codeById[id]).join(', ') || '—'}`);
  console.log(`  billing email ${p.address?.billing?.email ?? '—'}`);
  console.log(`  settings      ${
    u.strippedKeys.length ? `drop ${u.strippedKeys.join(', ')} → ` : 'unchanged → '
  }{${Object.keys(p.settings).join(', ') || ' '}}`);
  console.log('');
}

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

// Six rows, so one statement each: no batching to reason about, and a failure
// names the location it happened at.
let written = 0;
const failures = [];
for (const u of updates) {
  const { error } = await db.from('locations').update(u.patch).eq('id', u.id);
  if (error) failures.push({ code: u.code, message: error.message });
  else written++;
}

console.log(`written: ${written} of ${updates.length}`);
if (failures.length > 0) {
  console.log('FAILED:');
  for (const f of failures) console.log(`  ${f.code}: ${f.message}`);
  process.exit(1);
}
console.log('done.');
