#!/usr/bin/env node
/**
 * Restaurant Friend — FMP Production_Logs → batch-logs.json (046).
 *
 *   node transform-batch-logs.mjs           # dry run: the full report, nothing written
 *   node transform-batch-logs.mjs --write   # writes ../../FMP Export/transformed/
 *
 *   Production_Logs  14,103 rows → production_batch_logs (the 609 kitchen-days)
 *                               → production_batches     (the 14,103 batches)
 *
 * Production's brief says NO HISTORY MIGRATES, and that rule is about PLANS and
 * SCHEDULES — documents that say what to make next, where a stale one is worse
 * than none. A batch log says what was made. Mark asked for it directly
 * (2026-08-09), and both surfaces that read this table — the item record's
 * two-week history and the batch pane's "Previously made" column — currently
 * begin on the day we switched over.
 *
 * ---------------------------------------------------------------------------
 * THE FILE HAS NO LOG RECORD IN IT, and that is the one structural move here.
 *
 * FileMaker has batches and no header; 045 has a header keyed
 * `unique (location_id, log_date)`. So the header is DERIVED from the
 * (location, date) pairs the batches fall into — 609 of them — which is not a
 * reinterpretation of the data so much as writing down what its own unique key
 * already says. `__BatchLogID`, despite the name, is the BATCH's key: 14,103
 * distinct over 14,103 rows.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MEASURED RATHER THAN ASSUMED
 *
 * `Batch_Status` has three vocabularies — "1 TO DO" (4,437), bare "COMPLETE"
 * (95) and 2,269 BLANKS. The prefix strip is 036's "05 Topping" lesson again.
 * The blanks become `to_do` on Mark's instruction (2026-08-09: "there really
 * shouldn't be any blanks. Make them To Do"), and the original string rides in
 * `source_payload` so the choice stays reversible.
 *
 * `Batch_Order` is 99 on 9,643 rows — FileMaker's "unordered" — and carries 57
 * FRACTIONS (".25", "1.5", "10.5"). So it is the LABEL, with `sort` filled only
 * from a clean integer. 040's rule, and the reason `batch_label` is text.
 *
 * `Par` is free text: "60 ea", "4x 3 GAL", "22 QT". 13,500 filled, 12,995 parse
 * as (count ×)? size unit, and the 505 that don't are all literally "?" — which
 * is somebody typing a question mark, not a number, so they land null.
 *
 * `Batch_Size_Amount` / `Batch_Size_Unit` / `Batch_RecipeName` are EMPTY on all
 * 14,103 rows, so `batch_amount` / `batch_unit` stay null. That is honest: those
 * columns mean "what the round asked for", and FileMaker never recorded it here.
 *
 * `Batch_Temp` and `Batch_Time` are likewise empty on every row and have no
 * column to go to; they survive in `source_payload`.
 *
 * `Recipe_Variation` ("2x 3Gal", "5 QT", "1/2 Pan") is the batch SIZE that was
 * run → `scale_label`. Not `scale_index`: that is a slot number in a version's
 * own strip (042's argument) and nothing in this file names a slot.
 *
 * ---------------------------------------------------------------------------
 * `is_generated` IS FALSE ON EVERY ROW — see 046's header. In one line: 54
 * kitchen-days batch one element more than once, and 045's partial unique index
 * `(log_id, element_id) where is_generated` would refuse 58 real batches.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'batch-logs.json');
const APPLY = process.argv.includes('--write');

const VT = String.fromCharCode(0x0b);

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

/** Read a .mer with an ALLOW-LIST of candidate column names that fails loudly. */
function table(path, label, fields) {
  if (!existsSync(path)) {
    console.error(`No ${path} (override the folder with MER_DIR=)`);
    process.exit(1);
  }
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0].map((h) => h.trim());

  const positions = new Map();
  header.forEach((h, i) => {
    const k = h.toLowerCase();
    if (!positions.has(k)) positions.set(k, []);
    positions.get(k).push(i);
  });
  const repeated = [...positions].filter(([, ix]) => ix.length > 1);
  if (repeated.length) {
    console.error(`${label} has repeated column names, which a header-keyed parser drops silently:`);
    for (const [k, ix] of repeated) console.error(`  · "${k}" at positions ${ix.join(', ')}`);
    process.exit(1);
  }

  const F = {}, missing = [];
  for (const [key, names] of Object.entries(fields)) {
    const i = names.map((n) => positions.get(n.toLowerCase())?.[0]).find((v) => v !== undefined);
    if (i === undefined) missing.push(`${key} (tried ${names.join(', ')})`);
    F[key] = i;
  }
  if (missing.length) {
    console.error(`${label} is missing:`);
    for (const m of missing) console.error(`  · ${m}`);
    console.error(`\nColumns present: ${header.join(', ')}`);
    console.error('\nRefusing to guess. Re-export the whole table from FileMaker.');
    process.exit(1);
  }
  return {
    header,
    rows: rows.slice(1).filter((r) => r.length === header.length),
    ragged: rows.slice(1).filter((r) => r.length !== header.length).length,
    g: (row, k) => String(row[F[k]] ?? '').trim(),
    raw: (row) => Object.fromEntries(header.map((h, i) => [h, row[i]]).filter(([, v]) => v)),
  };
}

const text = (v) => {
  const s = String(v ?? '').split(VT).map((x) => x.trim()).filter(Boolean).join('\n').trim();
  return s === '' ? null : s;
};
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/** M/D/YYYY → YYYY-MM-DD, as STRINGS. `new Date(iso)` is UTC midnight and so
 *  the previous day everywhere west of Greenwich — `lib/productionBatches`
 *  makes the same point about its own date arithmetic. */
function isoDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * FMP's five statuses, its sort prefixes stripped, plus the blank Mark ruled on.
 *
 * A value we have never seen is REPORTED rather than mapped to something
 * plausible: 044's check constraint holds the vocabulary, and inventing a sixth
 * meaning would fail the insert 14,000 rows in with no clue why.
 */
const STATUS = {
  'TO DO': 'to_do',
  'IN PROGRESS': 'in_progress',
  COMPLETE: 'complete',
  SKIPPED: 'skipped',
  TEST: 'test',
};
function status(raw) {
  const bare = String(raw ?? '').trim().replace(/^\d+\s+/, '').toUpperCase();
  if (bare === '') return { value: 'to_do', blank: true };
  const mapped = STATUS[bare];
  return mapped ? { value: mapped, blank: false } : { value: null, blank: false, unknown: bare };
}

/**
 * "4x 3 GAL" → { count: 4, size: 3, unit: "GAL" }; "22 QT" → { size: 22 }.
 *
 * The COUNT is the optional half, which is the way round FileMaker writes it and
 * the way `describeAmount` reads it back — a lone number is the amount, not a
 * quantity of nothing. Anything that isn't a number at the front (505 rows of
 * "?") returns nulls rather than a guess.
 */
function amount(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { count: null, size: null, unit: null };
  const m = /^(?:([\d.]+)\s*[xX×]\s*)?([\d.]+)\s*(.*)$/.exec(s);
  if (!m) return { count: null, size: null, unit: null, unparsed: s };
  return { count: num(m[1]), size: num(m[2]), unit: text(m[3]) };
}

/* -------------------------------------------------------------------------- */

const logs = table(resolve(PROD, 'Production_Logs'), 'Production_Logs', {
  batchKey: ['__BatchLogID'],
  elementKey: ['__ElementID'],
  locationCode: ['__LocationID'],
  operatorKey: ['__OperatorID'],
  recipeKey: ['__RecipeID'],
  date: ['Batch_Date'],
  number: ['Batch_Number'],
  order: ['Batch_Order'],
  statusRaw: ['Batch_Status'],
  notes: ['Batch_Notes'],
  variation: ['Recipe_Variation'],
  par: ['Par'],
  yieldQty: ['Batch_Yield_Qty'],
  yieldAmount: ['Batch_Yield_Amount'],
  yieldUnit: ['Batch_Yield_Unit'],
  onHandQty: ['On_Hand_Qty'],
  onHandAmount: ['On_Hand_Amount'],
  onHandUnit: ['On_Hand_Unit'],
  created: ['_CreationTimestamp'],
});

const report = {
  read: logs.rows.length,
  ragged: logs.ragged,
  skipped: [],
  blankStatus: 0,
  unknownStatus: new Map(),
  unparsedPar: 0,
  noElement: 0,
  noOperator: 0,
  noRecipe: 0,
  duplicateBatchKey: 0,
};

const batches = [];
const byDay = new Map(); // "CODE|date" → { locationCode, log_date, earliest }
const seen = new Set();

for (const row of logs.rows) {
  const key = logs.g(row, 'batchKey');
  const date = isoDate(logs.g(row, 'date'));
  const code = logs.g(row, 'locationCode');

  // A batch with no key or no date cannot be placed OR made idempotent, which
  // are the two things this load rests on. Measured: zero of either today, so
  // this is a guard rather than a filter.
  if (!key) { report.skipped.push(`no __BatchLogID (batch ${logs.g(row, 'number')})`); continue; }
  if (!date) { report.skipped.push(`${key}: unreadable Batch_Date "${logs.g(row, 'date')}"`); continue; }
  if (!code) { report.skipped.push(`${key}: no __LocationID`); continue; }
  if (seen.has(key)) { report.duplicateBatchKey++; continue; }
  seen.add(key);

  const st = status(logs.g(row, 'statusRaw'));
  if (st.blank) report.blankStatus++;
  if (st.value === null) {
    report.unknownStatus.set(st.unknown, (report.unknownStatus.get(st.unknown) ?? 0) + 1);
    report.skipped.push(`${key}: unknown Batch_Status "${st.unknown}"`);
    continue;
  }

  const dayKey = `${code}|${date}`;
  const created = logs.g(row, 'created');
  const day = byDay.get(dayKey) ?? { locationCode: code, log_date: date, earliest: created };
  if (created && (!day.earliest || created < day.earliest)) day.earliest = created;
  byDay.set(dayKey, day);

  const par = amount(logs.g(row, 'par'));
  if (par.unparsed !== undefined) report.unparsedPar++;

  const elementKey = logs.g(row, 'elementKey');
  const operatorKey = logs.g(row, 'operatorKey');
  const recipeKey = logs.g(row, 'recipeKey');
  if (!elementKey) report.noElement++;
  if (!operatorKey) report.noOperator++;
  if (!recipeKey) report.noRecipe++;

  const orderRaw = logs.g(row, 'order');

  batches.push({
    legacy_id: `B:${key}`,
    log_legacy_id: `BL:${code}:${date}`,
    location_code: code,
    // Carried explicitly rather than picked back out of `log_legacy_id`: the
    // loader joins on (location, date) and a composed key it has to take apart
    // again is a parser waiting to be wrong.
    log_date: date,
    // The prefixes the 036 load gave these tables, so the loader can join on
    // `legacy_id` directly rather than knowing about prefixes itself.
    element_legacy_id: elementKey ? `E:${elementKey}` : null,
    // `employees.legacy_id` is the bare FileMaker id — no prefix, unlike the
    // production tables. Measured against the live database, not assumed.
    operator_legacy_id: operatorKey || null,
    recipe_version_legacy_id: recipeKey ? `RV:${recipeKey}` : null,

    batch_number: logs.g(row, 'number') || null,
    batch_label: text(orderRaw),
    sort: /^\d+$/.test(orderRaw) ? Number(orderRaw) : null,
    status: st.value,
    scale_label: text(logs.g(row, 'variation')),
    notes: text(logs.g(row, 'notes')),

    par_count: par.count,
    par_size: par.size,
    par_unit: par.unit,

    on_hand_count: num(logs.g(row, 'onHandQty')),
    on_hand_size: num(logs.g(row, 'onHandAmount')),
    on_hand_unit: text(logs.g(row, 'onHandUnit')),

    yield_count: num(logs.g(row, 'yieldQty')),
    yield_size: num(logs.g(row, 'yieldAmount')),
    yield_unit: text(logs.g(row, 'yieldUnit')),

    source_payload: logs.raw(row),
  });
}

const logRows = [...byDay.values()]
  .map((d) => ({
    legacy_id: `BL:${d.locationCode}:${d.log_date}`,
    location_code: d.locationCode,
    log_date: d.log_date,
    // A day that has been and gone is a closed document. 045's ladder is
    // open → complete and nothing else, so there is no third thing to say.
    status: 'complete',
    // NOT FileMaker's timestamp, deliberately. `generated_at` is timestamptz
    // and FMP's string carries no zone, so loading it would silently reinterpret
    // an evening batch as the next morning — and for a migrated log the stamp is
    // not a fact anybody needs to the hour. Noon UTC on the log's own date sorts
    // correctly and cannot land on the wrong day; every real timestamp survives
    // in each batch's `source_payload`.
    generated_at: `${d.log_date}T12:00:00Z`,
    source_payload: { fmp_first_created: d.earliest || null },
  }))
  .sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));

/* -------------------------------------------------------------------------- */

const byYear = {};
for (const b of logRows) byYear[b.log_date.slice(0, 4)] = (byYear[b.log_date.slice(0, 4)] ?? 0) + 1;
const byLocation = {};
for (const b of batches) byLocation[b.location_code] = (byLocation[b.location_code] ?? 0) + 1;
const byStatus = {};
for (const b of batches) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

console.log(`\nProduction_Logs: ${report.read} rows read${report.ragged ? `, ${report.ragged} ragged and dropped` : ''}`);
console.log(`  → ${logRows.length} batch logs (kitchen-days), ${batches.length} batches`);
console.log(`  logs by year:      ${Object.entries(byYear).map(([y, n]) => `${y} ${n}`).join(' · ')}`);
console.log(`  batches by shop:   ${Object.entries(byLocation).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
console.log(`  batches by status: ${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
console.log(`  blank statuses read as to_do: ${report.blankStatus}`);
console.log(`  no element key ${report.noElement} · no operator ${report.noOperator} · no recipe ${report.noRecipe}`);
console.log(`  Par unparsed (left null): ${report.unparsedPar}`);
if (report.duplicateBatchKey) console.log(`  duplicate __BatchLogID dropped: ${report.duplicateBatchKey}`);
if (report.unknownStatus.size) {
  console.log('  UNKNOWN statuses (rows skipped):');
  for (const [k, n] of report.unknownStatus) console.log(`    · "${k}" ×${n}`);
}
if (report.skipped.length) {
  console.log(`  skipped ${report.skipped.length} rows:`);
  for (const s of report.skipped.slice(0, 20)) console.log(`    · ${s}`);
  if (report.skipped.length > 20) console.log(`    … and ${report.skipped.length - 20} more`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --write to produce batch-logs.json.\n');
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ logs: logRows, batches }, null, 2));
console.log(`\nWrote ${OUT}\n`);
