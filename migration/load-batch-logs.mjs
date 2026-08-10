#!/usr/bin/env node
/**
 * Restaurant Friend — load batch-logs.json into migration 046's history columns.
 *
 *   node --env-file=.env load-batch-logs.mjs           # loads (idempotent)
 *   node --env-file=.env load-batch-logs.mjs --wipe    # removes the FileMaker rows first
 *
 * Run `transform-batch-logs.mjs --write` first, and run this AFTER
 * `load-production.mjs` — every batch points at an element and most at a recipe
 * version, both of which phase 1 loaded.
 *
 * ---------------------------------------------------------------------------
 * IT ADOPTS AN EXISTING DAY RATHER THAN COMPETING WITH IT.
 *
 * 045 keys `production_batch_logs` on `unique (location_id, log_date)`, so a day
 * has exactly one log whoever made it. If the app already has one for a day the
 * export also covers, this attaches the historical batches to THAT row and
 * leaves its own fields alone — it does not restamp somebody's open log as
 * complete, and it does not give it a `legacy_id` it did not come from.
 *
 * That last point is what keeps `--wipe` safe: wipe deletes logs that CARRY a
 * legacy_id (pure history, cascading their batches) and then any remaining
 * batches that carry one (the ones attached to an adopted day). An app log
 * survives with its own batches intact.
 *
 * ---------------------------------------------------------------------------
 * UNRESOLVED KEYS ARE NULLED AND COUNTED, never dropped.
 *
 * A batch whose element we cannot find is still a batch that happened, but
 * `element_id` is NOT NULL in 044 — so those rows are skipped and NAMED, which
 * is the only case here that loses anything. An operator or recipe version we
 * cannot find is nullable, so the row loads with an em dash where the name would
 * be. Measured before writing this: elements resolve 99.9%, versions 100.0%,
 * locations 100%, and operators 81.5% — the misses being one FileMaker employee
 * id, `001`, that matches nobody and failed the events load the same way.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'batch-logs.json');
const WIPE = process.argv.includes('--wipe');
const CHUNK = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env load-batch-logs.mjs');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-batch-logs.mjs --write\` first.`);
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => {
  console.error(`FAILED at ${step}:`, error?.message ?? error);
  process.exit(1);
};

/**
 * POSTGREST RETURNS AT MOST 1,000 ROWS AND SAYS NOTHING ABOUT IT, and every
 * lookup below is over a table well past that. The `.order()` is not optional
 * either: a `.range()` sweep with no ORDER BY returns rows in whatever order
 * Postgres likes, so pages overlap and rows go missing — the timesheets-audit
 * lesson, which measured 44,661 rows fetched holding 27,795 distinct ids.
 */
async function all(table, select, orderBy = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select)
      .order(orderBy).range(from, from + 999);
    if (error) die(`reading ${table}`, error);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const data = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${data.logs.length} batch logs and ${data.batches.length} batches from ${IN}`);

/* -------------------------------------------------------------------------- */
/* 1. Resolve the keys                                                         */
/* -------------------------------------------------------------------------- */

const { data: orgs, error: orgError } = await db.from('orgs').select('id, name');
if (orgError) die('reading orgs', orgError);
if (orgs.length !== 1) die('reading orgs', `expected one org, found ${orgs.length}`);
const orgId = orgs[0].id;
console.log(`Org: ${orgs[0].name}`);

const locations = await all('locations', 'id, code');
const elements = await all('production_elements', 'id, legacy_id');
const employees = await all('employees', 'id, legacy_id');
const versions = await all('production_recipe_versions', 'id, legacy_id, version_label');

/**
 * EVERY KEY IS STRINGIFIED, and that is not defensive tidying.
 *
 * `employees.legacy_id` is an INTEGER column while the production tables' are
 * text — so `new Map([[625, id]]).get("625")` misses, silently, for every row.
 * The first run of this loader resolved 12 operators out of 14,066 and reported
 * it as "unresolved and nulled", which reads exactly like FileMaker not having
 * recorded who made things. It had: 81.5% of rows name somebody.
 *
 * What hid it was the probe that measured the rate beforehand — it built its
 * map with `String(e.legacy_id)` and so reported the true 81.5%, while the
 * loader used the raw value. Two pieces of code, one of them accidentally
 * right. Stringify at the boundary and the question cannot come up again.
 */
const legacyKey = (v) => (v === null || v === undefined ? null : String(v));

const locationByCode = new Map(locations.map((l) => [l.code, l.id]));
const elementByLegacy = new Map(
  elements.filter((e) => e.legacy_id).map((e) => [legacyKey(e.legacy_id), e.id])
);
const employeeByLegacy = new Map(
  employees.filter((e) => e.legacy_id).map((e) => [legacyKey(e.legacy_id), e.id])
);
// The id AND the label, because 044 stores both: the id is the link and
// `recipe_version_label` is the SNAPSHOT — 038's rule, so renaming a version
// never rewrites what a finished batch says it followed. Loading the link
// without the label leaves the batch pane's Ver column empty on every
// historical row, which is where you read a yield change against a recipe
// change. FileMaker prints it, so we do.
const versionByLegacy = new Map(
  versions.filter((v) => v.legacy_id).map((v) => [legacyKey(v.legacy_id), v])
);

console.log(`Resolvers: ${locationByCode.size} locations · ${elementByLegacy.size} elements · ` +
  `${employeeByLegacy.size} employees · ${versionByLegacy.size} recipe versions`);

/* -------------------------------------------------------------------------- */
/* 2. Wipe, if asked                                                           */
/* -------------------------------------------------------------------------- */

if (WIPE) {
  // Batches FIRST, so the ones attached to an adopted app log go too — deleting
  // the logs alone would cascade only the history's own days.
  const { error: bErr, count: bCount } = await db.from('production_batches')
    .delete({ count: 'exact' }).eq('org_id', orgId).not('legacy_id', 'is', null);
  if (bErr) die('wiping migrated batches', bErr);
  const { error: lErr, count: lCount } = await db.from('production_batch_logs')
    .delete({ count: 'exact' }).eq('org_id', orgId).not('legacy_id', 'is', null);
  if (lErr) die('wiping migrated batch logs', lErr);
  console.log(`Wiped ${bCount ?? 0} migrated batches and ${lCount ?? 0} migrated logs.`);
}

/* -------------------------------------------------------------------------- */
/* 3. The logs — insert the missing days, adopt the ones already there         */
/* -------------------------------------------------------------------------- */

const existingLogs = await all('production_batch_logs', 'id, location_id, log_date, legacy_id');
const logIdByDay = new Map(existingLogs.map((l) => [`${l.location_id}|${l.log_date}`, l.id]));
const adopted = [];

const toInsert = [];
for (const log of data.logs) {
  const locationId = locationByCode.get(log.location_code);
  if (!locationId) {
    console.warn(`  ! ${log.legacy_id}: no location "${log.location_code}" — skipped`);
    continue;
  }
  const dayKey = `${locationId}|${log.log_date}`;
  if (logIdByDay.has(dayKey)) {
    // Already there: either a previous run of this loader, or a day the app has
    // its own log for. Either way the batches join it and nothing is restamped.
    adopted.push(`${log.location_code} ${log.log_date}`);
    continue;
  }
  toInsert.push({
    org_id: orgId,
    location_id: locationId,
    log_date: log.log_date,
    status: log.status,
    generated_at: log.generated_at,
    legacy_id: log.legacy_id,
    source_payload: log.source_payload,
  });
}

for (let i = 0; i < toInsert.length; i += CHUNK) {
  const slice = toInsert.slice(i, i + CHUNK);
  const { data: rows, error } = await db.from('production_batch_logs')
    .insert(slice).select('id, location_id, log_date');
  if (error) die(`inserting batch logs ${i}–${i + slice.length}`, error);
  for (const r of rows) logIdByDay.set(`${r.location_id}|${r.log_date}`, r.id);
}
console.log(`Batch logs: ${toInsert.length} inserted, ${adopted.length} already present.`);
if (adopted.length && adopted.length <= 12) console.log(`  adopted: ${adopted.join(' · ')}`);

/* -------------------------------------------------------------------------- */
/* 4. The batches                                                              */
/* -------------------------------------------------------------------------- */

const missing = { element: 0, operator: 0, version: 0, log: 0 };
const skipped = [];
const rows = [];

for (const b of data.batches) {
  const locationId = locationByCode.get(b.location_code);
  const logId = locationId ? logIdByDay.get(`${locationId}|${b.log_date}`) : null;
  if (!locationId || !logId) { missing.log++; skipped.push(`${b.legacy_id}: no log for ${b.location_code} ${b.log_date}`); continue; }

  const elementId = b.element_legacy_id ? elementByLegacy.get(b.element_legacy_id) : null;
  if (!elementId) {
    // 044 makes `element_id` NOT NULL — a batch is a making OF something — so
    // this is the one unresolved key that costs a row rather than a name.
    missing.element++;
    skipped.push(`${b.legacy_id}: element ${b.element_legacy_id ?? '(none)'} not found`);
    continue;
  }

  const operatorId = b.operator_legacy_id ? employeeByLegacy.get(b.operator_legacy_id) ?? null : null;
  if (b.operator_legacy_id && !operatorId) missing.operator++;
  const version = b.recipe_version_legacy_id
    ? versionByLegacy.get(b.recipe_version_legacy_id) ?? null : null;
  if (b.recipe_version_legacy_id && !version) missing.version++;

  rows.push({
    org_id: orgId,
    log_id: logId,
    location_id: locationId,
    element_id: elementId,
    // FALSE ON EVERY MIGRATED ROW — see 046's header. 045's partial unique index
    // `(log_id, element_id) where is_generated` would refuse the 58 batches that
    // are a second making of one element on one day.
    is_generated: false,
    legacy_id: b.legacy_id,
    batch_number: b.batch_number,
    batch_label: b.batch_label,
    sort: b.sort,
    status: b.status,
    operator_employee_id: operatorId,
    recipe_version_id: version?.id ?? null,
    recipe_version_label: version?.version_label ?? null,
    scale_label: b.scale_label,
    par_count: b.par_count,
    par_size: b.par_size,
    par_unit: b.par_unit,
    on_hand_count: b.on_hand_count,
    on_hand_size: b.on_hand_size,
    on_hand_unit: b.on_hand_unit,
    yield_count: b.yield_count,
    yield_size: b.yield_size,
    yield_unit: b.yield_unit,
    notes: b.notes,
    source_payload: b.source_payload,
  });
}

let written = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  const { error, count } = await db.from('production_batches')
    .upsert(slice, { onConflict: 'org_id,legacy_id', count: 'exact' });
  if (error) die(`upserting batches ${i}–${i + slice.length}`, error);
  written += count ?? slice.length;
  if (i % (CHUNK * 10) === 0) console.log(`  … ${i + slice.length} / ${rows.length}`);
}

console.log(`\nBatches: ${written} written.`);
console.log(`  unresolved and nulled — operator ${missing.operator} · recipe version ${missing.version}`);
if (skipped.length) {
  console.log(`  SKIPPED ${skipped.length} (element not found, and 044 requires one):`);
  for (const s of skipped.slice(0, 25)) console.log(`    · ${s}`);
  if (skipped.length > 25) console.log(`    … and ${skipped.length - 25} more`);
}

/* -------------------------------------------------------------------------- */
/* 5. Prove it landed                                                          */
/* -------------------------------------------------------------------------- */

const counts = {};
for (const [label, table, filter] of [
  ['batch logs (migrated)', 'production_batch_logs', (q) => q.not('legacy_id', 'is', null)],
  ['batch logs (total)', 'production_batch_logs', (q) => q],
  ['batches (migrated)', 'production_batches', (q) => q.not('legacy_id', 'is', null)],
  ['batches (total)', 'production_batches', (q) => q],
]) {
  const { count, error } = await filter(
    db.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId)
  );
  if (error) die(`counting ${label}`, error);
  counts[label] = count;
}
console.log('\nIn the database now:');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log('');
