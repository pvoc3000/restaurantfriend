#!/usr/bin/env node
/**
 * Restaurant Friend — put the elements a kitchen ACTUALLY makes on its round.
 *
 *   node --env-file=.env backfill-weekly-round.mjs            # dry run, the full report
 *   node --env-file=.env backfill-weekly-round.mjs --apply    # writes
 *   …  --since=2026-05-01 --min=6                             # the window and the threshold
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM, measured rather than assumed (Mark, 2026-08-09: "when I try to
 * generate a log for DF2 just to make ice cream, only two flavors get added").
 *
 * They do, and generation is right: DF02's weekly round contains exactly two
 * ice creams, and the dialog says so before you press anything. The round is
 * `production_element_locations.on_weekly_log`, which migration 045 backfilled
 * from `production_element_days` — the table `_production.mer` loaded into.
 *
 * ONLY 2 OF THE 24 ICE CREAM ELEMENTS APPEAR IN THAT TABLE AT ALL. FileMaker's
 * ice cream round was never in that export; whatever drove it lived somewhere
 * else. So this is a gap in what we imported, not a rule that has gone wrong,
 * and no amount of fixing the generator would find the missing fourteen.
 *
 * ---------------------------------------------------------------------------
 * THE HISTORY IS THE BETTER SOURCE, and it only became available on 2026-08-09.
 *
 * Migration 046 loaded 14,066 real batches. What a kitchen made, week after
 * week, for the last three months is a far stronger statement about its round
 * than a config export that turned out to be missing most of it. Measured over
 * batches since 2026-05-01:
 *
 *   DF02 — 25 (element) pairs batched and not on the round; 14 of them ice
 *          cream, most at 14 batches each, which is one a week for a quarter.
 *   DF01 — 9 pairs, led by Chocolate Syrup and Hot Fudge at 14 apiece.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO.
 *
 * It never turns a round membership OFF. Something batched twice in May and
 * dropped is not evidence that anything else should go, and a script that
 * un-rounds elements could quietly empty a kitchen's Monday. Removing one is a
 * checkbox on the element record.
 *
 * It writes NO amounts. `weekly_amount` / `weekly_sort` / the stock trio are
 * what the round asks for and what the shop keeps, and the batch history says
 * what was MADE — which is a different number, and often a different unit. They
 * stay null and are typed in on the element record.
 *
 * A THRESHOLD, because "batched once" is not a round. The default of 6 over a
 * 90-day window is roughly fortnightly; the real data is bimodal (14, or one or
 * two), so anything between 3 and 10 selects the same set. `--min=1` takes
 * everything and is the deliberate way to say so.
 */
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SINCE = arg('since', '2026-05-01');
const MIN = Number(arg('min', '6'));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env backfill-weekly-round.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => {
  console.error(`FAILED at ${step}:`, error?.message ?? error);
  process.exit(1);
};

/** PostgREST caps every select at 1,000 rows silently — and an unordered
 *  `.range()` sweep overlaps its own pages, so both halves matter. */
async function all(table, select, order = 'id', filter = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(select))
      .order(order)
      .range(from, from + 999);
    if (error) die(`reading ${table}`, error);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name');
if (orgErr) die('reading orgs', orgErr);
if (orgs.length !== 1) die('reading orgs', `expected one org, found ${orgs.length}`);
const orgId = orgs[0].id;

const locations = await all('locations', 'id, code');
const elements = await all('production_elements', 'id, name, element_type, is_active');
const existing = await all(
  'production_element_locations',
  'id, element_id, location_id, on_weekly_log, is_active'
);
const logs = await all('production_batch_logs', 'id, location_id, log_date', 'id', (q) =>
  q.gte('log_date', SINCE)
);
const batches = await all('production_batches', 'element_id, log_id', 'id', (q) =>
  q.in('log_id', logs.map((l) => l.id))
);

const codeOf = new Map(locations.map((l) => [l.id, l.code]));
const elementOf = new Map(elements.map((e) => [e.id, e]));
const rowOf = new Map(existing.map((r) => [`${r.element_id}|${r.location_id}`, r]));
const logLoc = new Map(logs.map((l) => [l.id, l.location_id]));

/** How often each (element, kitchen) was actually batched in the window. */
const made = new Map();
for (const b of batches) {
  const loc = logLoc.get(b.log_id);
  if (!loc) continue;
  const k = `${b.element_id}|${loc}`;
  made.set(k, (made.get(k) ?? 0) + 1);
}

const toInsert = [];
const toUpdate = [];
const belowThreshold = [];
for (const [k, count] of made) {
  const [elementId, locationId] = k.split('|');
  const element = elementOf.get(elementId);
  const row = rowOf.get(k);
  // Already on the round and active — nothing to do.
  if (row?.on_weekly_log && row.is_active) continue;
  if (count < MIN) {
    belowThreshold.push({ element, code: codeOf.get(locationId), count });
    continue;
  }
  if (row) toUpdate.push({ row, element, code: codeOf.get(locationId), count });
  else toInsert.push({ orgId, elementId, locationId, element, code: codeOf.get(locationId), count });
}

const report = (label, list) => {
  if (!list.length) return;
  const byLoc = {};
  for (const x of list) (byLoc[x.code] ??= []).push(x);
  console.log(`\n${label} — ${list.length}`);
  for (const [code, xs] of Object.entries(byLoc)) {
    console.log(`  ${code} (${xs.length}):`);
    for (const x of xs.sort((a, b) => b.count - a.count)) {
      console.log(
        `    ${String(x.count).padStart(3)} batches  ${x.element?.name}` +
          `  [${x.element?.element_type ?? 'no type'}]` +
          (x.element?.is_active ? '' : '  (element is INACTIVE — it will not generate)')
      );
    }
  }
};

console.log(`Window: batches since ${SINCE} · threshold ${MIN}`);
report('NEW element-location rows, put on the round', toInsert);
report('EXISTING rows, switched on', toUpdate);
report(`Left alone (under ${MIN} batches)`, belowThreshold);

if (!toInsert.length && !toUpdate.length) {
  console.log('\nNothing to do — every element a kitchen batches is already on its round.\n');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nDry run. ${toInsert.length} to create, ${toUpdate.length} to switch on.`);
  console.log('Re-run with --apply to write.\n');
  process.exit(0);
}

// `org_id` EXPLICITLY (design rule 1) — no table defaults it, and an insert
// policy's WITH CHECK runs before the NOT NULL, so an omitted one reports as an
// RLS violation and sends you looking at roles.
for (let i = 0; i < toInsert.length; i += 500) {
  const slice = toInsert.slice(i, i + 500);
  const { error } = await db.from('production_element_locations').insert(
    slice.map((x) => ({
      org_id: x.orgId,
      element_id: x.elementId,
      location_id: x.locationId,
      on_weekly_log: true,
      is_active: true,
    }))
  );
  if (error) die(`inserting element-locations ${i}`, error);
}

for (const x of toUpdate) {
  const { data, error } = await db
    .from('production_element_locations')
    .update({ on_weekly_log: true, is_active: true })
    .eq('id', x.row.id)
    .select('id');
  if (error) die(`switching on ${x.element?.name} at ${x.code}`, error);
  // An update matching nothing changes zero rows and returns NO error.
  if (!data.length) die('switching on', `${x.element?.name} at ${x.code} matched no row`);
}

console.log(`\nCreated ${toInsert.length}, switched on ${toUpdate.length}.`);

const after = await all(
  'production_element_locations',
  'location_id, on_weekly_log, is_active'
);
const counts = {};
for (const r of after) {
  if (!r.on_weekly_log || !r.is_active) continue;
  const code = codeOf.get(r.location_id) ?? '?';
  counts[code] = (counts[code] ?? 0) + 1;
}
console.log('On the round now:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '), '\n');
