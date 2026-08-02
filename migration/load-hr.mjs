#!/usr/bin/env node
// ============================================================================
// load-hr.mjs — employees.json → the hosted database
//
//   node --env-file=.env load-hr.mjs             # loads, refuses if not empty
//   node --env-file=.env load-hr.mjs --wipe      # replaces a previous load
//
// Run `transform-hr.mjs --write` first. Needs migration 020 applied.
//
// service_role, so RLS does not apply — this is a local-only script and the
// key must never appear in web/ or in git (design rule 1).
//
// It also LINKS MARK: his employee row gets the `user_id` of the auth account
// he already signs in with, so the employee/user split is true from the first
// day rather than being patched in later.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const WIPE = process.argv.includes('--wipe');
const LINK_ARG = process.argv.find((a) => a.startsWith('--link-owner-legacy-id='));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env load-hr.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const die = (step, error) => { console.error(`FAILED at ${step}:`, error.message ?? error); process.exit(1); };

async function insertBatched(table, rows, select = null, batch = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += batch) {
    let q = db.from(table).insert(rows.slice(i, i + batch));
    if (select) q = q.select(select);
    const { data, error } = await q;
    if (error) die(`${table} rows ${i}-${i + batch}`, error);
    if (select) out.push(...data);
    process.stdout.write(`\r${table}: ${Math.min(i + batch, rows.length)}/${rows.length}   `);
  }
  console.log();
  return out;
}

// ---------------------------------------------------------------------------
const FILE = resolve(DATA, 'employees.json');
if (!existsSync(FILE)) die('startup', new Error(`No employees.json in ${DATA} — run transform-hr.mjs --write first`));
const source = JSON.parse(readFileSync(FILE, 'utf8'));

const { data: orgs, error: orgErr } = await db.from('orgs').select('id').limit(1);
if (orgErr) die('orgs', orgErr);
const ORG = orgs[0].id;

const { data: locRows, error: locErr } = await db.from('locations').select('id, code');
if (locErr) die('locations', locErr);
const LOC = Object.fromEntries(locRows.map((l) => [l.code, l.id]));

const { count, error: countErr } = await db
  .from('employees').select('*', { count: 'exact', head: true });
// A missing table here means 020 hasn't been applied — say so plainly rather
// than reporting a count of zero and then failing 445 inserts.
if (countErr) die('employees (is migration 020 applied?)', countErr);
if (count > 0 && !WIPE) {
  die('guard', new Error(`employees already has ${count} rows — rerun with --wipe to replace them`));
}

if (WIPE) {
  console.log('wiping previously loaded employees…');
  // Documents first: they FK to employees. (Objects in Storage are left alone —
  // this wipes a bad migration run, and a re-load doesn't reattach files.)
  const { error: docErr } = await db.from('employee_documents').delete().eq('org_id', ORG);
  if (docErr) die('wipe employee_documents', docErr);
  const { error: empErr } = await db.from('employees').delete().eq('org_id', ORG);
  // employees has NO delete policy for app users (020), but service_role
  // bypasses RLS, so this works from here and only from here.
  if (empErr) die('wipe employees', empErr);
}

// --- load -------------------------------------------------------------------

const unknownCodes = new Map();
const rows = source.map((e) => {
  let main_location_id = null;
  if (e.location_code) {
    main_location_id = LOC[e.location_code] ?? null;
    if (!main_location_id) {
      unknownCodes.set(e.location_code, (unknownCodes.get(e.location_code) ?? 0) + 1);
    }
  }
  return {
    org_id: ORG,
    legacy_id: e.legacy_id,
    status: e.status,
    last_name: e.last_name,
    first_name: e.first_name,
    nickname: e.nickname,
    phone: e.phone,
    email: e.email,
    address: e.address,
    date_of_birth: e.date_of_birth,
    main_location_id,
    schedule: e.schedule,
    employment_type: e.employment_type,
    start_date: e.start_date,
    end_date: e.end_date,
    position: e.position,
    notes: e.notes,
    food_handler_expires: e.food_handler_expires,
  };
});

if (unknownCodes.size) {
  console.log('\nLocation codes in the export that this org has no location for:');
  for (const [code, n] of unknownCodes) console.log(`  ${code}  (${n} employees) — left with no location`);
  console.log();
}

const inserted = await insertBatched('employees', rows, 'id, legacy_id, email');

// --- link the owner ---------------------------------------------------------
// Mark signs in already; his employee row should point at that account.

const { data: owner, error: ownerErr } = await db
  .from('org_members').select('user_id').eq('org_id', ORG).eq('role', 'owner').maybeSingle();
if (ownerErr) die('owner lookup', ownerErr);

if (!owner) {
  console.log('\nNo owner in org_members — skipping the owner link.');
} else {
  const { data: authUser, error: authErr } = await db.auth.admin.getUserById(owner.user_id);
  if (authErr) die('owner auth user', authErr);
  const ownerEmail = (authUser?.user?.email ?? '').toLowerCase();

  let target = null;
  if (LINK_ARG) {
    const wanted = Number(LINK_ARG.split('=')[1]);
    target = inserted.find((r) => r.legacy_id === wanted);
    if (!target) die('owner link', new Error(`no employee with legacy_id ${wanted}`));
  } else {
    const matches = inserted.filter((r) => (r.email ?? '').toLowerCase() === ownerEmail);
    if (matches.length === 1) {
      target = matches[0];
    } else {
      // Loud rather than a guess: linking the wrong person would hand someone
      // else's record the owner's account.
      die(
        'owner link',
        new Error(
          `${matches.length} employees match the owner's address (${ownerEmail}). ` +
          `Re-run with --link-owner-legacy-id=<FMP employee id> to say which.`
        )
      );
    }
  }

  const { error: linkErr } = await db
    .from('employees').update({ user_id: owner.user_id }).eq('id', target.id);
  if (linkErr) die('owner link', linkErr);
  console.log(`\nowner linked: auth ${owner.user_id} → employee legacy_id ${target.legacy_id}`);
}

// --- sanity -----------------------------------------------------------------

const { count: total } = await db.from('employees').select('*', { count: 'exact', head: true });
const byStatus = {};
for (const s of ['active', 'new_hire', 'inactive']) {
  const { count: n } = await db
    .from('employees').select('*', { count: 'exact', head: true }).eq('status', s);
  byStatus[s] = n;
}

console.log(`\nemployees: ${total} total`);
for (const [s, n] of Object.entries(byStatus)) console.log(`  ${String(n).padStart(4)}  ${s}`);
console.log('\nCompare these against the transform report. If they disagree, something was dropped.\n');
