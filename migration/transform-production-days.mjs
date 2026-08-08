#!/usr/bin/env node
/**
 * Restaurant Friend — FMP element production schedule → production-days.json (040).
 *
 *   node transform-production-days.mjs           # dry run: the full report, nothing written
 *   node transform-production-days.mjs --write   # writes ../../FMP Export/transformed/
 *
 *   _production.mer  1,201 rows → production_element_days
 *                              → production_element_locations (stock-up par only)
 *
 * This is the LAST of the seven Production config exports, and the only one no
 * transform had ever read. Phase 1 loaded `_elementpars.mer` (60 rows) instead,
 * which is a sixth of this and carries neither shift nor batch. Without it the
 * AB and Weekly element sheets have nothing to print.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FILE ACTUALLY IS, measured rather than read off the column names
 *
 * A row is ONE BATCH, not one element-day. Raised Dough at DF01 on a Monday
 * morning is four rows labelled 1 · 2 · 3 · 5 — four batches to make that
 * morning. The natural key needs the batch in it (1,080 groups without,
 * 1,184 with).
 *
 * `batchOrder_n` IS NOT A NUMBER. Its 17 values include "Blueberry", "Caramel",
 * "Chocolate", "Maple", "Strawberry", "Vanilla", "1 Bag", "x1", "x2" — element
 * 1109's batches are FLAVOURS. Reading it as an integer takes the numeric ones
 * and drops the rest without a word, which is why 040 has `batch_label text`.
 *
 * `WeeklyPar` is CONSTANT per (element, kitchen) — 197 groups, zero varying —
 * so it is a stock-up par and belongs on `production_element_locations`, whose
 * `stock_count` / `stock_size` / `stock_unit` columns 036 created and left
 * empty. It parses with the same reader `_elementpars` used.
 *
 * `batchAmount_n` VARIES within an (element, kitchen) pair on 13 of 184, so it
 * stays on the batch. `shift_t` varies on 28 of 159, likewise.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY THROWN AWAY
 *
 * Every `_c` calculation: `batchPar_c`, `_currentPar_c`, `batchExtended_c`,
 * `yieldExpected_c`, `onProductionSchedule_c`, `shiftNum_c`, `shortDayName_c`.
 * They resolve from data we already hold, and a calculation copied into a
 * column is a second answer waiting to drift — the disease the brief names in
 * its own "what it got wrong" list. Every `_g` global and `gFormOrList` /
 * `gLastSort` / `isSelected_b` are UI state from whoever last had the file
 * open. The raw row survives in `source_payload` either way.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'production-days.json');
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
  for (const [key, { names, required = true }] of Object.entries(fields)) {
    const i = names.map((n) => positions.get(n.toLowerCase())?.[0]).find((v) => v !== undefined);
    if (i === undefined && required) missing.push(`${key} (tried ${names.join(', ')})`);
    F[key] = i;
  }
  if (missing.length) {
    console.error(`${label} is missing:`);
    for (const m of missing) console.error(`  · ${m}`);
    console.error(`\nColumns present: ${header.join(', ')}`);
    console.error('\nRefusing to guess. Re-export from FileMaker per the brief\'s export procedure.');
    process.exit(1);
  }
  return {
    header,
    rows: rows.slice(1),
    g: (row, k) => (F[k] === undefined ? '' : String(row[F[k]] ?? '').trim()),
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
const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

const fatal = [];
const problems = [];
const note = (msg) => { if (problems.length < 4000) problems.push(msg); };

/**
 * "6x 1.5 GAL" → { count: 6, size: 1.5, unit: 'GAL' }
 * "10 BAGS"    → { count: 10, size: null, unit: 'BAGS' }
 * "2x 4QT Pan" → { count: 2, size: 4, unit: 'QT' }
 * "?"          → null, and the caller reports it.
 *
 * The same forms `_elementpars` carries, because it is the same field wearing
 * a different name — kept here rather than imported so this transform runs
 * without loading the 40 MB recipe-lines file next door.
 */
export function parseStockPar(raw) {
  const s = String(raw ?? '').trim().replace(/\.$/, '');
  if (!s || s === '?') return null;
  let m = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:#\s*)?([A-Za-z.]+)?/i.exec(s);
  if (m) return { count: Number(m[1]), size: Number(m[2]), unit: blank(m[3]) };
  m = /^(\d+(?:\.\d+)?)\s*x\s*([A-Za-z.]+)/i.exec(s);
  if (m) return { count: Number(m[1]), size: null, unit: blank(m[2]) };
  m = /^(\d+(?:\.\d+)?)\s*(?:#\s*)?([A-Za-z.]+)?$/i.exec(s);
  if (m) return { count: Number(m[1]), size: null, unit: blank(m[2]) };
  return null;
}

/* ========================================================================== */
/* 1. Read                                                                     */
/* ========================================================================== */

const S = table(resolve(PROD, '_production.mer'), '_production.mer', {
  element_id: { names: ['_id_element_t'] },
  kitchen: { names: ['kitchen_t'] },
  location: { names: ['location_t'] },
  day: { names: ['dayNum_n'] },
  shift: { names: ['shift_t'] },
  batch_label: { names: ['batchOrder_n'] },
  amount: { names: ['batchAmount_n'] },
  portion: { names: ['batchPortion_t'] },
  exclude: { names: ['batchShouldExclude_b'] },
  note: { names: ['note_t'] },
  weekly_par: { names: ['WeeklyPar'] },
});

console.log(`_production.mer: ${S.rows.length} rows`);

/* ========================================================================== */
/* 2. Vocabularies, reported rather than normalised                            */
/* ========================================================================== */

const tally = (get) => {
  const m = new Map();
  for (const r of S.rows) { const v = get(r) || '(blank)'; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};

console.log('\n── VOCABULARIES (loaded verbatim; normalising them would be guessing) ──');
console.log(`  shift        ${tally((r) => S.g(r, 'shift')).map(([v, n]) => `${v} ${n}`).join(' · ')}`);
console.log(`  batch label  ${tally((r) => S.g(r, 'batch_label')).map(([v, n]) => `${v} ${n}`).join(' · ')}`);
console.log(`  batch unit   ${tally((r) => S.g(r, 'portion')).map(([v, n]) => `${v} ${n}`).join(' · ')}`);
console.log(`  kitchen      ${tally((r) => S.g(r, 'kitchen')).map(([v, n]) => `${v} ${n}`).join(' · ')}`);

/* ========================================================================== */
/* 3. The batches                                                              */
/* ========================================================================== */

const days = [];
const occurrences = new Map();  // natural tuple → how many we have seen
const weeklyPar = new Map();    // element|kitchen → { raw, parsed }
let noKitchen = 0, noDay = 0, repeated = 0;

for (const r of S.rows) {
  const elementId = blank(S.g(r, 'element_id'));
  if (!elementId) { note('a row names no element at all'); continue; }

  // `location_t` is empty in every row of the real file; kept as a fallback
  // because the DDR lists both and a re-export could fill either.
  const code = blank(S.g(r, 'kitchen')) ?? blank(S.g(r, 'location'));
  if (!code) {
    noKitchen++;
    note(`element ${elementId}: a batch with no kitchen — skipped (nowhere to make it)`);
    continue;
  }

  const day = num(S.g(r, 'day'));
  if (day === null || day < 1 || day > 7) {
    noDay++;
    note(`element ${elementId} at ${code}: a batch with no weekday — skipped`);
    continue;
  }

  const label = blank(S.g(r, 'batch_label'));
  // Ordinal ONLY when the label really is one. "Caramel" keeps its label and
  // gets a null sort; it must not become 0 and lead the sheet.
  const ordinal = label !== null && /^\d+$/.test(label) ? Number(label) : null;

  const shift = blank(S.g(r, 'shift'));
  const tuple = `${elementId}|${code}|${day}|${shift ?? ''}|${label ?? ''}`;

  // `_production.mer` HAS NO PRIMARY KEY — not one column of it — so a batch's
  // identity is its natural tuple plus an occurrence ordinal (028's
  // `source_row_key` lesson). This is NOT a merge: element 1126 has six
  // unlabelled Tuesday batches at DF01 carrying amounts 8, 4 and 2, and folding
  // them into one would silently throw five real batches away. The ordinal is
  // stored readable, in the legacy_id, so a duplicate explains itself.
  const seen = (occurrences.get(tuple) ?? 0) + 1;
  occurrences.set(tuple, seen);
  if (seen > 1) repeated++;

  days.push({
    legacy_id: `PD:${tuple}#${seen}`,
    element_legacy_id: elementId,
    location_code: code,
    weekday: day,
    shift,
    batch_label: label,
    sort: ordinal,
    occurrence: seen,
    batch_amount: num(S.g(r, 'amount')),
    batch_unit: blank(S.g(r, 'portion')),
    is_excluded: S.g(r, 'exclude') === '1',
    note: text(S.g(r, 'note')),
    source: 'filemaker',
    source_payload: S.raw(r),
  });

  // The stock-up par. Constant per (element, kitchen) — measured, 197 groups,
  // zero varying — so it is a fact about the element at that shop and belongs
  // on `production_element_locations`, not repeated across seven weekdays here.
  const raw = blank(S.g(r, 'weekly_par'));
  if (raw) {
    const pair = `${elementId}|${code}`;
    const seen = weeklyPar.get(pair);
    if (seen && seen.raw !== raw) {
      note(`element ${elementId} at ${code}: two different weekly pars ("${seen.raw}" vs "${raw}") — kept the first`);
    } else if (!seen) {
      const parsed = parseStockPar(raw);
      if (!parsed) note(`element ${elementId} at ${code}: weekly par "${raw}" does not parse — loaded as text only`);
      weeklyPar.set(pair, { raw, parsed });
    }
  }
}

const elementLocations = [...weeklyPar].map(([pair, { raw, parsed }]) => {
  const [elementId, code] = pair.split('|');
  return {
    element_legacy_id: elementId,
    location_code: code,
    stock_count: parsed?.count ?? null,
    stock_size: parsed?.size ?? null,
    stock_unit: parsed?.unit ?? null,
    stock_raw: raw,
  };
});

/* ========================================================================== */
/* 4. Report                                                                   */
/* ========================================================================== */

const distinctElements = new Set(days.map((d) => d.element_legacy_id)).size;
const distinctPairs = new Set(days.map((d) => `${d.element_legacy_id}|${d.location_code}`)).size;
const labelled = days.filter((d) => d.batch_label && d.sort === null);

console.log('\n── WHAT LANDED ──');
console.log(`  ${days.length} batches over ${distinctElements} elements and ${distinctPairs} (element, kitchen) pairs`);
console.log(`  ${elementLocations.length} stock-up pars, ${elementLocations.filter((e) => e.stock_count === null).length} of which did not parse`);
console.log(`  ${labelled.length} batches carry a NON-NUMERIC label (${[...new Set(labelled.map((d) => d.batch_label))].join(', ') || 'none'})`);

console.log('\n── DROPPED ──');
console.log(`  ${noKitchen} rows with no kitchen · ${noDay} with no weekday`);
console.log(`  (${repeated} batches share a natural tuple with another and are kept apart by their occurrence ordinal)`);

// The legacy_id is the natural key plus nothing, so a collision here means the
// merge above failed — refuse the whole run rather than half-loading.
const ids = days.map((d) => d.legacy_id);
if (new Set(ids).size !== ids.length) {
  fatal.push(`${ids.length - new Set(ids).size} legacy_id collisions survived the merge`);
}
if (days.some((d) => d.weekday < 1 || d.weekday > 7)) {
  fatal.push('a weekday outside 1–7 survived');
}
// The trap this transform exists to avoid, asserted rather than assumed.
if (days.some((d) => d.batch_label !== null && d.sort !== null && String(d.sort) !== d.batch_label)) {
  fatal.push('a batch label was coerced into a different number');
}

if (problems.length) {
  console.log(`\n── ${problems.length} NOTE(S) ──`);
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

if (fatal.length) {
  console.error('\n── REFUSING TO WRITE ──');
  for (const f of fatal) console.error(`  x ${f}`);
  console.error('');
  process.exit(1);
}

/* ========================================================================== */
/* 5. Write                                                                    */
/* ========================================================================== */

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --write.\n');
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ element_days: days, element_locations: elementLocations }));
console.log(`\nWrote ${OUT}\n`);
