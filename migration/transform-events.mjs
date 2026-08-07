#!/usr/bin/env node
/**
 * Restaurant Friend — FMP Events + Ratings → employee-events.json (migration 035).
 *
 *   node transform-events.mjs           # dry run: the full report, nothing written
 *   node transform-events.mjs --write   # writes ../../FMP Export/transformed/
 *
 * ONE script for TWO source tables, because the merge is the point: the kind
 * vocabulary, the `legacy_id` namespace and the duplicate check are all
 * cross-source, and only one process can catch a collision between the two
 * BEFORE the unique index does it halfway through batch 47.
 *
 * ---------------------------------------------------------------------------
 * THE THIRD FILE
 *
 * `Operations/ShiftReports.mer` is FMP's shift log — one record per (day, shop,
 * shift), which `Ratings.log_id` points at. It is not loaded here (it is the
 * unbuilt Production module's table: sales, tips, production batches and yields,
 * waste, leftovers, a task checklist) but it is READ, because it holds four
 * things Ratings does not:
 *
 *   the LOCATION   — Ratings has no location column at all
 *   the SUPERVISOR — nor any rater
 *   the SHIFT      — as a real label, where Ratings has only a 1/2/3 sort field
 *                    that cannot express Off-site
 *   the DATE       — for the 329 ratings whose own date is blank
 *
 * Measured 2026-08-06: `_log_id` is unique (13,059 of 13,059) and the join
 * covers 44,250 of 44,251 ratings — 100.0%.
 *
 * ---------------------------------------------------------------------------
 * THE VOCABULARY LIVES IN THE APP
 *
 * `normalizeEventKind`, `averageScore` and the two shift-slot readers are
 * imported from web/.fixtures-build rather than restated here, so the check
 * constraint in 035, the PickList on the employee screen and this transform are
 * literally one list instead of three that agree today. Same reasoning as
 * `transform-timesheets.mjs` importing `timeZone`.
 *
 * The OUTPUT LIVES OUTSIDE THE REPO, like every other transform: these rows
 * carry twelve years of write-ups and incident reports about named people.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/HR');
const OPS = resolve(HERE, process.env.OPS_DIR ?? '../../FMP Export/Operations');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'employee-events.json');
const APPLY = process.argv.includes('--write');

/** Between the lines of a multi-line text field, once exported. */
const VT = String.fromCharCode(0x0b);

const MODULE = resolve(HERE, '../web/.fixtures-build/src/lib/employeeEvents.js');
if (!existsSync(MODULE)) {
  console.error(`Missing ${MODULE}`);
  console.error('Run `npm run fixtures` in web/ first. This script imports the SAME kind');
  console.error('vocabulary the app and migration 035 use, rather than keeping a third copy');
  console.error('that agrees with them today and drifts tomorrow.');
  process.exit(1);
}
const { normalizeEventKind, averageScore, shiftSlotFromLabel, shiftSlotFromSortField } =
  await import(pathToFileURL(MODULE).href);

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

/**
 * Read a .mer into rows plus a resolver, with an ALLOW-LIST of candidate column
 * names that fails loudly.
 *
 * `field-map.md` warns that Ratings once carried TWO columns named
 * `Name_Full_c` (the subject and the rater), and the usual
 * `Object.fromEntries(header.map(...))` silently keeps the LAST of a duplicate
 * pair. The fresh exports have no duplicates — checked — but this builds
 * name → [indices] and reports any repeat rather than trusting that to hold.
 */
function table(path, label, fields) {
  if (!existsSync(path)) {
    console.error(`No ${path} (override the folder with MER_DIR= / OPS_DIR=)`);
    process.exit(1);
  }
  // UTF-8, NOT latin1 — these carry accented names in every text field.
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
    console.error('Resolve which is which before loading — see migration/field-map.md.');
    process.exit(1);
  }

  const F = {}, missing = [];
  for (const [key, { names, required = true }] of Object.entries(fields)) {
    const i = names.map((n) => positions.get(n.toLowerCase())?.[0]).find((v) => v !== undefined);
    if (i === undefined && required) missing.push(`${key} (tried ${names.join(', ')})`);
    F[key] = i;
  }
  if (missing.length) {
    console.error(`${label} is missing:`);
    for (const m of missing) console.error(`  · ${m}`);
    console.error(`\nColumns present: ${header.join(', ')}`);
    console.error('\nRefusing to guess. Re-export from FileMaker with File → Export Records →');
    console.error('Merge, choosing the fields EXPLICITLY, character set UTF-8.');
    process.exit(1);
  }
  return {
    rows: rows.slice(1),
    g: (row, k) => (F[k] === undefined ? '' : String(row[F[k]] ?? '').trim()),
  };
}

/** M/D/YYYY → YYYY-MM-DD, or null. */
function isoDate(raw) {
  const p = String(raw ?? '').trim().split('/');
  if (p.length !== 3) return null;
  const [m, d, y] = p.map(Number);
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Multi-line text arrives VT-separated; keep the lines, lose the control char. */
const text = (v) => {
  const s = String(v ?? '').split(VT).map((x) => x.trim()).filter(Boolean).join('\n').trim();
  return s === '' ? null : s;
};

const out = [];
const problems = [];
const note = (msg) => { if (problems.length < 4000) problems.push(msg); };

/* ========================================================================== */
/* 1. The shift reports — read for what they know, never loaded                */
/* ========================================================================== */

const S = table(resolve(OPS, 'ShiftReports.mer'), 'ShiftReports.mer', {
  log_id: { names: ['_log_id', 'log_id', 'logid'] },
  date: { names: ['date'] },
  supervisor_id: { names: ['supervisor_id', 'supervisorid'] },
  supervisor: { names: ['supervisor'] },
  shift: { names: ['Shift'] },
  location: { names: ['Location'] },
});

const reports = new Map();
for (const r of S.rows) {
  const id = S.g(r, 'log_id');
  if (!id) continue;
  reports.set(id, {
    date: isoDate(S.g(r, 'date')),
    supervisor_id: S.g(r, 'supervisor_id') || null,
    supervisor: S.g(r, 'supervisor') || null,
    shift_raw: S.g(r, 'shift') || null,
    location_code: S.g(r, 'location') || null,
  });
}
console.log(`ShiftReports: ${S.rows.length} rows → ${reports.size} keyed by _log_id.`);

/* ========================================================================== */
/* 2. Events                                                                   */
/* ========================================================================== */

const E = table(resolve(HR, 'Events.mer'), 'Events.mer', {
  legacy: { names: ['EventID', 'event_id'] },
  employee: { names: ['EmployeeID', 'employee_id'] },
  date: { names: ['Date'] },
  type: { names: ['EventType', 'event_type'] },
  summary: { names: ['EventSummary'] },
  detail: { names: ['EventDetail'] },
  action: { names: ['EventAction'] },
  supervisor_id: { names: ['SupervisorID'] },
  supervisor: { names: ['Supervisor'] },
  points: { names: ['points'], required: false },
  hard_copy: { names: ['hasHardCopy_c'], required: false },
  doc_ts: { names: ['Document_timestamp'], required: false },
});

const kindCounts = new Map();
const bump = (k) => kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
let eventsSkipped = 0;

for (const r of E.rows) {
  const legacy = E.g(r, 'legacy');
  const employee = E.g(r, 'employee');
  const occurred_on = isoDate(E.g(r, 'date'));
  const rawType = E.g(r, 'type');

  if (!employee || !occurred_on || !rawType) {
    eventsSkipped += 1;
    note(`Event ${legacy || '(no id)'}: skipped — ${[!employee && 'no employee', !occurred_on && 'no date', !rawType && 'no type'].filter(Boolean).join(', ')}`);
    continue;
  }

  let kind;
  try {
    kind = normalizeEventKind(rawType);
  } catch (err) {
    // FATAL, not a fallthrough to `note`. An unmapped type would file a decade
    // of write-ups under a bucket nobody looks at.
    console.error(`\nEvent ${legacy}: ${err.message}`);
    process.exit(1);
  }
  bump(kind);

  out.push({
    legacy_id: `E:${legacy}`,
    employee_legacy: employee,
    occurred_on,
    kind,
    location_code: null,
    score: null,
    shift: null,
    position: null,
    headline: text(E.g(r, 'summary')),
    detail: text(E.g(r, 'detail')),
    outcome: text(E.g(r, 'action')),
    author_legacy: E.g(r, 'supervisor_id') || null,
    author_name: E.g(r, 'supervisor') || null,
    source_payload: {
      source_table: 'Events',
      event_type: rawType,
      // The attendance POINTS system is deliberately not modelled (Mark,
      // 2026-08-06: "drop it"). 673 rows carry a value, and it is kept here so
      // the decision is reversible without a re-export.
      points: E.g(r, 'points') || null,
      has_hard_copy: E.g(r, 'hard_copy') === '1' ? true : E.g(r, 'hard_copy') === '0' ? false : null,
      document_timestamp: E.g(r, 'doc_ts') || null,
    },
  });
}
console.log(`Events:       ${E.rows.length} rows → ${out.length} kept, ${eventsSkipped} skipped.`);

/* ========================================================================== */
/* 3. Ratings                                                                  */
/* ========================================================================== */

const R = table(resolve(HR, 'Ratings.mer'), 'Ratings.mer', {
  log_id: { names: ['log_id', 'logid'] },
  employee: { names: ['employee_id', 'employeeid'] },
  name: { names: ['full_name'], required: false },
  date: { names: ['date'] },
  type: { names: ['event_type'] },
  position: { names: ['position'] },
  note: { names: ['Note'] },
  sort: { names: ['cShift_sortfield'], required: false },
  total: { names: ['score_TOTAL'], required: false },
  speed: { names: ['score_speed'] },
  service: { names: ['score_customerservice'] },
  cleanliness: { names: ['score_cleanliness'] },
  initiative: { names: ['score_initiative'] },
  attitude: { names: ['score_attitude'] },
  break_start: { names: ['break_start'], required: false },
  break_end: { names: ['break_end'], required: false },
  break_length: { names: ['break_length_c'], required: false },
  break_confirmed: { names: ['break_confirmed_b'], required: false },
  break_reason: { names: ['break_missed_reason'], required: false },
});

/**
 * POSITION NORMALISATION, in two passes.
 *
 * Pass one is mechanical and needs no judgement: values identical once case and
 * punctuation are stripped are the same value ("Baker"/"baker"/"BAKER",
 * "FOH"/"FoH"), and the majority spelling wins.
 *
 * Pass two is the small list of spelled-out-versus-abbreviated pairs, which IS
 * a judgement and is printed in full so it can be argued with. "Senior DF" 4,140
 * and "Sr. DF" 4,285 are one job written two ways, and leaving them apart would
 * split the biggest position in the data down the middle.
 *
 * The tail of ~90 other values is left exactly as typed and counted at the end.
 * `transform-hr.mjs`'s posture: fold what is provably the same, report the rest.
 */
const SPELLED_OUT = new Map([
  ['senior df', 'Sr. DF'],
  ['senior donut friend', 'Sr. DF'],
  ['sr donut friend', 'Sr. DF'],
  ['senior baker', 'Sr. Baker'],
  ['senior ab', 'Sr. AB'],
  ['donut friend', 'DF'],
]);
const posKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const spellingVotes = new Map();
for (const r of R.rows) {
  const v = R.g(r, 'position');
  if (!v) continue;
  const k = posKey(v);
  if (!spellingVotes.has(k)) spellingVotes.set(k, new Map());
  const m = spellingVotes.get(k);
  m.set(v, (m.get(v) ?? 0) + 1);
}
const canonical = new Map();
for (const [k, m] of spellingVotes) {
  canonical.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
}
function normalizePosition(raw) {
  if (!raw) return null;
  const k = posKey(raw);
  return SPELLED_OUT.get(k) ?? canonical.get(k) ?? raw;
}

/**
 * A "position" that is really an ABSENCE. 236 rows say some spelling of "call
 * out" and a handful say "called out", "no call/no show", or bury it in a longer
 * note ("DF- CALL OUT", "Call out/cover", "Call Out for 2/27 shift").
 *
 * A narrow /^call out$/ would have missed every one of those, so this matches
 * the phrase anywhere in the value. They become `call_out` events with no score
 * and no position: a rating for a shift nobody worked is not a rating.
 */
const CALL_OUT = /\b(call(ed)?\s*-?\s*out|no\s*call\s*[/ ]?\s*no\s*show)\b/i;

// (log_id, employee_id) is NOT unique — 44,230 distinct over 44,251, with 19
// keys used twice and one carrying a blank employee. So the key is the natural
// tuple plus an occurrence ordinal, stored READABLE rather than hashed so a
// duplicate explains itself. `transform-timesheets.mjs`'s rule and its reason.
const seenKey = new Map();

let ratingsSkipped = 0, rescued = 0, joined = 0, unjoined = 0;
let dateFromReport = 0, shiftFromSort = 0;
let scoreChecked = 0, scoreAgrees = 0;
const locCounts = new Map(), shiftCounts = new Map();

for (const r of R.rows) {
  const employee = R.g(r, 'employee');
  const logId = R.g(r, 'log_id');
  const report = reports.get(logId) ?? null;
  if (report) joined += 1; else unjoined += 1;

  // The rating's own date, falling back to its report's — 329 rows have none.
  let occurred_on = isoDate(R.g(r, 'date'));
  if (!occurred_on && report?.date) { occurred_on = report.date; dateFromReport += 1; }

  if (!employee || !occurred_on) {
    ratingsSkipped += 1;
    note(`Rating log ${logId || '(none)'}: skipped — ${!employee ? 'no employee' : 'no date anywhere'}`);
    continue;
  }

  const rawPosition = R.g(r, 'position');
  const isCallOut = CALL_OUT.test(rawPosition);
  if (isCallOut) rescued += 1;

  let kind;
  try {
    kind = isCallOut ? 'call_out' : normalizeEventKind(R.g(r, 'type'));
  } catch (err) {
    console.error(`\nRating log ${logId}: ${err.message}`);
    process.exit(1);
  }
  bump(kind);

  const components = [
    R.g(r, 'speed'), R.g(r, 'service'), R.g(r, 'cleanliness'),
    R.g(r, 'initiative'), R.g(r, 'attitude'),
  ];
  const score = isCallOut ? null : averageScore(components);

  // THE TRANSFORM'S OWN SMOKE TEST. FMP stored round(mean); if our mean rounds
  // to the same figure on ~40,618 of 40,793 rows then the five component columns
  // are the right ones. If it does not reproduce, nothing else here is
  // trustworthy either.
  const storedTotal = R.g(r, 'total');
  if (score !== null && storedTotal !== '' && !Number.isNaN(Number(storedTotal))) {
    scoreChecked += 1;
    if (Math.round(score) === Number(storedTotal)) scoreAgrees += 1;
  }

  let shift = shiftSlotFromLabel(report?.shift_raw);
  if (!shift) {
    const fallback = shiftSlotFromSortField(R.g(r, 'sort'));
    if (fallback) { shift = fallback; shiftFromSort += 1; }
  }

  const location_code = report?.location_code ?? null;
  if (location_code) locCounts.set(location_code, (locCounts.get(location_code) ?? 0) + 1);
  shiftCounts.set(shift ?? '(none)', (shiftCounts.get(shift ?? '(none)') ?? 0) + 1);

  const natural = `${logId || '-'}:${employee}`;
  const n = (seenKey.get(natural) ?? 0) + 1;
  seenKey.set(natural, n);

  out.push({
    legacy_id: `R:${natural}#${n}`,
    employee_legacy: employee,
    occurred_on,
    kind,
    location_code,
    score,
    shift,
    position: isCallOut ? null : normalizePosition(rawPosition),
    // The note IS the rating. One or two sentences, median 66 characters.
    headline: text(R.g(r, 'note')),
    detail: null,
    outcome: null,
    author_legacy: report?.supervisor_id ?? null,
    author_name: report?.supervisor ?? null,
    source_payload: {
      source_table: 'Ratings',
      // The FK the future `shift_logs` table will want. Kept rather than made a
      // column, because a column would reference a table that does not exist.
      log_id: logId || null,
      event_type: R.g(r, 'type'),
      score_total: storedTotal || null,
      scores: {
        speed: components[0] || null, customer_service: components[1] || null,
        cleanliness: components[2] || null, initiative: components[3] || null,
        attitude: components[4] || null,
      },
      position_raw: rawPosition || null,
      shift_raw: report?.shift_raw ?? null,
      // The break backstop. `backfill-break-premiums.mjs` reads these from the
      // .mer directly and writes 029 decisions; they are kept here so a reader
      // asking "why is there a not_owed on this day" has the answer on the record.
      break_start: R.g(r, 'break_start') || null,
      break_end: R.g(r, 'break_end') || null,
      break_length: R.g(r, 'break_length') || null,
      break_confirmed: R.g(r, 'break_confirmed') || null,
      break_missed_reason: text(R.g(r, 'break_reason')),
      ...(isCallOut ? { rescued_from: 'position' } : {}),
    },
  });
}

console.log(`Ratings:      ${R.rows.length} rows → ${R.rows.length - ratingsSkipped} kept, ${ratingsSkipped} skipped.`);

/* ========================================================================== */
/* 4. The report                                                               */
/* ========================================================================== */

const fatal = [];

console.log(`\n── KINDS ──`);
for (const [k, n] of [...kindCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${k}`);
}

console.log(`\n── THE SHIFT-REPORT JOIN ──`);
console.log(`  ratings matched to a report : ${joined} of ${joined + unjoined} (${(100 * joined / (joined + unjoined)).toFixed(1)}%)`);
console.log(`  dates taken from the report : ${dateFromReport}`);
console.log(`  shifts from the sort field  : ${shiftFromSort} (the label could not answer)`);
console.log(`  locations   : ${[...locCounts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('  ')}`);
console.log(`  shifts      : ${[...shiftCounts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('  ')}`);
const noLocation = out.filter((e) => e.kind !== 'note' && e.source_payload.source_table === 'Ratings' && !e.location_code).length;
if (noLocation > 10) {
  fatal.push(`${noLocation} ratings have no location. The shift-report join covers 100% of the real data, so this means the join is wrong.`);
}

console.log(`\n── THE SCORE ──`);
const pct = scoreChecked ? (100 * scoreAgrees / scoreChecked).toFixed(1) : '—';
console.log(`  our mean rounds to FMP's stored total on ${scoreAgrees} of ${scoreChecked} (${pct}%)`);
console.log(`  expected ≈ 40,618 of 40,793 (99.6%) — a lower figure means the component columns are wrong`);
if (scoreChecked > 1000 && scoreAgrees / scoreChecked < 0.98) {
  fatal.push(`The score cross-check reproduces only ${pct}% where 99.6% is expected. The five component columns are not the right ones.`);
}
const scored = out.filter((e) => e.score !== null);
console.log(`  ${scored.length} events carry a score; ${out.filter((e) => e.kind === 'shift' && e.score === null).length} shift events do not`);

console.log(`\n── THE CALL-OUT RESCUE ──`);
console.log(`  ${rescued} ratings whose POSITION was an absence became call_out events`);

console.log(`\n── POSITIONS ──`);
const folds = [];
for (const [k, m] of spellingVotes) {
  const target = SPELLED_OUT.get(k) ?? canonical.get(k);
  const variants = [...m].sort((a, b) => b[1] - a[1]);
  if (variants.length > 1 || (SPELLED_OUT.has(k) && variants[0][0] !== target)) {
    folds.push([target, variants]);
  }
}
console.log(`  ${spellingVotes.size} distinct raw values → ${new Set([...spellingVotes.keys()].map((k) => SPELLED_OUT.get(k) ?? canonical.get(k))).size} after folding`);
for (const [target, variants] of folds.slice(0, 20)) {
  console.log(`    → ${String(target).padEnd(18)} ${variants.map(([v, n]) => `"${v}"×${n}`).join('  ')}`);
}
if (folds.length > 20) console.log(`    … and ${folds.length - 20} more folds`);

/* -- identity ------------------------------------------------------------- */

const ids = out.map((e) => e.legacy_id);
const dupes = new Map();
for (const id of ids) dupes.set(id, (dupes.get(id) ?? 0) + 1);
const collisions = [...dupes].filter(([, n]) => n > 1);
console.log(`\n── IDENTITY ──`);
console.log(`  ${out.length} rows, ${new Set(ids).size} distinct legacy_id`);
if (collisions.length) {
  // Refuse the WHOLE run rather than letting the unique index reject batch 47
  // of 94 and leave the table half loaded. strip-section-prefix.mjs's precedent.
  fatal.push(`${collisions.length} legacy_id collisions, e.g. ${collisions.slice(0, 3).map(([id, n]) => `${id}×${n}`).join(', ')}`);
}

if (problems.length) {
  console.log(`\n── ${problems.length} ROW(S) SKIPPED ──`);
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

if (fatal.length) {
  console.error(`\n── REFUSING TO WRITE ──`);
  for (const f of fatal) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

/* ========================================================================== */
/* 5. Write                                                                    */
/* ========================================================================== */

console.log(`\n${out.length} events ready (${out.filter((e) => e.kind === 'shift').length} shift, ${out.length - out.filter((e) => e.kind === 'shift').length} other).`);

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --write.\n`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT}`);
console.log('That file is OUTSIDE the repo and holds twelve years of write-ups. Leave it there.\n');
