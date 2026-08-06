#!/usr/bin/env node
/**
 * Restaurant Friend — fill `employees.gusto_id` from Gusto's own employee
 * summary export.
 *
 * Migration 028 added the column and nothing ever wrote it: exactly ONE of the
 * 445 employees carries a Gusto id (Anthony Aguirre, hand-entered), which is
 * why `exportReadiness` has been reporting "N people have no Gusto id" and why
 * the payroll file matches Gusto on NAME — the thing that makes payroll-name
 * overrides necessary in the first place.
 *
 *     node --env-file=.env backfill-gusto-ids.mjs [path/to.csv]           # dry run
 *     node --env-file=.env backfill-gusto-ids.mjs [path/to.csv] --apply   # write
 *
 * THE FILE IS A FIELD ALLOW-LIST, and here that is not a stylistic preference.
 * Gusto's employee summary carries SSN, date of birth, home address, bank
 * status and the full W-4 detail for every person. This reads THREE columns —
 * Last, First, Gusto Employee ID — and never looks at another. Keep the file
 * itself outside the repo; the default path is ~/Downloads and nothing copies
 * it anywhere.
 *
 * MATCHING IS EXACT (last, first) FIRST, and only then by surname, because
 * Gusto holds people's legal names while we hold what they are called at work:
 * `Oye, Marissa` is our Mars and `Hjelmeset, Samuel` is our Sam. A surname
 * match is taken only when the surname is unique on BOTH sides among what is
 * still unmatched — the same rule `lib/invoiceMatch` uses for a SKU, and for
 * the same reason: an ambiguous pair is left unmatched rather than paired
 * arbitrarily. Every surname match is printed as one, so a wrong one is
 * visible before --apply.
 *
 * Idempotent. A row that already holds the right id is left alone; one holding
 * a DIFFERENT id is reported and never overwritten — that is a question, not a
 * backfill.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const CSV = resolve(
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
    process.env.GUSTO_CSV ??
    `${homedir()}/Downloads/donut-friend-inc-employees-summary.csv`
);

/** The only three columns this script is allowed to see. */
const WANTED = ['Last', 'First', 'Gusto Employee ID'];

/** RFC 4180 enough for Gusto's export: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Trim, fold case, and drop accents — `López` and `Lopez` are one person. */
const key = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function readGusto() {
  if (!existsSync(CSV)) {
    console.error(`Gusto export not found: ${CSV}`);
    console.error('Pass the path as the first argument, or set GUSTO_CSV.');
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  // Gusto prints a title, the company and a "Printed on" line before the
  // header, so the header is FOUND rather than assumed to be row 1.
  const headerAt = rows.findIndex((r) => r[0]?.trim() === 'Last');
  if (headerAt < 0) {
    console.error('No header row starting with "Last" — is this the employee summary?');
    process.exit(1);
  }
  const header = rows[headerAt].map((h) => h.trim());
  const at = Object.fromEntries(WANTED.map((w) => [w, header.indexOf(w)]));
  const missing = WANTED.filter((w) => at[w] < 0);
  if (missing.length) {
    console.error(`Export is missing ${missing.join(', ')}.`);
    process.exit(1);
  }
  return rows
    .slice(headerAt + 1)
    .map((r) => ({
      last: (r[at.Last] ?? '').trim(),
      first: (r[at.First] ?? '').trim(),
      gusto_id: (r[at['Gusto Employee ID']] ?? '').trim(),
    }))
    .filter((p) => p.last && p.first && p.gusto_id);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (node --env-file=.env).');
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const gusto = readGusto();
console.log(`Gusto export: ${gusto.length} people  (${CSV})`);

const { data: employees, error } = await db
  .from('employees')
  .select('id, last_name, first_name, nickname, status, gusto_id')
  .order('last_name');
if (error) {
  console.error('Could not read employees:', error.message);
  process.exit(1);
}
console.log(`Database: ${employees.length} employees\n`);

const byFull = new Map();
const bySurname = new Map();
for (const e of employees) {
  const full = `${key(e.last_name)}|${key(e.first_name)}`;
  if (!byFull.has(full)) byFull.set(full, []);
  byFull.get(full).push(e);
  const sur = key(e.last_name);
  if (!bySurname.has(sur)) bySurname.set(sur, []);
  bySurname.get(sur).push(e);
}

const matched = [];   // { person, employee, how }
const unmatched = []; // gusto rows with nobody

// Pass 1 — exact (last, first).
const leftover = [];
for (const p of gusto) {
  const hits = byFull.get(`${key(p.last)}|${key(p.first)}`) ?? [];
  if (hits.length === 1) matched.push({ p, e: hits[0], how: 'name' });
  else leftover.push({ p, ambiguous: hits.length > 1 });
}

// Pass 2 — surname, only where it is unique on BOTH sides among the leftovers.
const takenIds = new Set(matched.map((m) => m.e.id));
for (const { p, ambiguous } of leftover) {
  if (ambiguous) { unmatched.push({ p, why: 'more than one employee with that exact name' }); continue; }
  const sameSurnameInFile = leftover.filter((l) => key(l.p.last) === key(p.last));
  const hits = (bySurname.get(key(p.last)) ?? []).filter((e) => !takenIds.has(e.id));
  if (sameSurnameInFile.length === 1 && hits.length === 1) {
    matched.push({ p, e: hits[0], how: 'surname' });
    takenIds.add(hits[0].id);
  } else {
    unmatched.push({
      p,
      why: hits.length === 0 ? 'no employee with that surname'
        : `${hits.length} employees share that surname`,
    });
  }
}

const toWrite = matched.filter((m) => !m.e.gusto_id);
const already = matched.filter((m) => m.e.gusto_id === m.p.gusto_id);
const conflicting = matched.filter((m) => m.e.gusto_id && m.e.gusto_id !== m.p.gusto_id);

const label = (m) =>
  `${m.p.last}, ${m.p.first}`.padEnd(30) +
  m.p.gusto_id.padEnd(9) +
  (m.how === 'surname' || key(m.p.first) !== key(m.e.first_name)
    ? `  (we call them ${m.e.first_name}${m.e.nickname ? ` / ${m.e.nickname}` : ''})`
    : '');

console.log(`To write (${toWrite.length}):`);
for (const m of toWrite) console.log('  ' + label(m));

if (already.length) {
  console.log(`\nAlready correct (${already.length}):`);
  for (const m of already) console.log('  ' + label(m));
}
if (conflicting.length) {
  console.log(`\nCONFLICTING — not touched (${conflicting.length}):`);
  for (const m of conflicting) console.log(`  ${m.p.last}, ${m.p.first}: db ${m.e.gusto_id} vs export ${m.p.gusto_id}`);
}
if (unmatched.length) {
  console.log(`\nIn Gusto, no employee record (${unmatched.length}):`);
  for (const u of unmatched) console.log(`  ${u.p.last}, ${u.p.first} (${u.p.gusto_id}) — ${u.why}`);
}

// The other direction: someone we pay who Gusto's export doesn't list. Only
// worth naming for people who aren't gone — 417 former employees would drown it.
const inFile = new Set(matched.map((m) => m.e.id));
const missingFromGusto = employees.filter((e) => e.status !== 'inactive' && !inFile.has(e.id));
if (missingFromGusto.length) {
  console.log(`\nCurrent employees NOT in the Gusto export (${missingFromGusto.length}):`);
  for (const e of missingFromGusto) console.log(`  ${e.last_name}, ${e.first_name} [${e.status}]`);
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to write ${toWrite.length} ids.`);
  process.exit(0);
}

let written = 0;
for (const m of toWrite) {
  // .select() its own result: an update matching nothing returns no error.
  const { data, error: e } = await db
    .from('employees')
    .update({ gusto_id: m.p.gusto_id })
    .eq('id', m.e.id)
    .select('id');
  if (e) console.error(`  FAILED ${m.p.last}, ${m.p.first}: ${e.message}`);
  else if (!data?.length) console.error(`  FAILED ${m.p.last}, ${m.p.first}: matched no row`);
  else written += 1;
}
console.log(`\nWrote ${written} of ${toWrite.length}.`);
