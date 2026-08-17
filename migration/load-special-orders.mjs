#!/usr/bin/env node
/**
 * Restaurant Friend — load special-orders.json into migration 051's tables.
 *
 *   node --env-file=.env load-special-orders.mjs          # loads; refuses if not empty
 *   node --env-file=.env load-special-orders.mjs --wipe   # replaces the FileMaker rows
 *
 * Run `transform-special-orders.mjs --write` first.
 *
 * `--wipe` deletes only `source = 'filemaker'` orders and their children (which
 * cascade), plus FileMaker customers — so anything typed in the app survives a
 * reload. The log's `special_order_events` has NO delete policy by design, but
 * this runs as service_role, which bypasses RLS; the rows go with their order.
 *
 * APPLY MIGRATION 051 AND RUN THIS IN THE SAME SITTING. Between the two the
 * module renders an empty list, which is a false claim about twelve years of
 * orders.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS SCRIPT DOES THAT THE TRANSFORM CANNOT
 *
 * Resolve `menuItemKey_n` against the LIVE production catalog. The transform
 * checks the same join against its own JSON, but the catalog is edited in the
 * app — an item deleted since the export must land as a null link and a
 * counted line, not as a crash halfway through 47,827 inserts.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed', 'special-orders.json');
const WIPE = process.argv.includes('--wipe');
const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env load-special-orders.mjs');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`No ${IN} — run \`node transform-special-orders.mjs --write\` first.`);
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const die = (step, error) => { console.error(`FAILED at ${step}:`, error.message ?? error); process.exit(1); };

const data = JSON.parse(readFileSync(IN, 'utf8'));
console.log(`Read ${data.orders.length} orders, ${data.items.length} items, ` +
  `${data.payments.length} payments, ${data.events.length} events, ${data.customers.length} customers`);

/* -------------------------------------------------------------------------- */
/* 1. Resolve the keys                                                         */
/* -------------------------------------------------------------------------- */

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name');
if (orgErr) die('orgs', orgErr);
if (orgs.length !== 1) die('orgs', new Error(`Expected exactly one org, found ${orgs.length}.`));
const ORG = orgs[0].id;

// .limit(1) and never a HEAD count: a HEAD response has no body to carry an
// error, so a count against a MISSING table returns null and no error, and
// this would cheerfully report "ready to load". (load-events.mjs' lesson.)
for (const t of ['customers', 'special_orders', 'special_order_items',
                 'special_order_payments', 'special_order_events']) {
  const { error } = await db.from(t).select('id').limit(1);
  if (error) die(`${t} (is migration 051 applied?)`, error);
}

const { data: locRows, error: locErr } = await db.from('locations').select('id, code').eq('org_id', ORG);
if (locErr) die('locations', locErr);
const LOC = Object.fromEntries(locRows.map((l) => [l.code, l.id]));

/** Paginated, and `.order()` BEFORE `.range()` — without it the pages overlap
 *  and the map silently loses items. (The timesheets-audit lesson.) */
async function fetchAll(tableName, select, orderCol = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await db.from(tableName).select(select)
      .eq('org_id', ORG).order(orderCol).range(from, from + 999);
    if (error) die(tableName, error);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const prodItems = await fetchAll('production_items', 'id, legacy_id, name');
// Both spellings: the catalog's legacy ids are `PI:02` where the order line's
// key may be `2`. 234 of the 248 distinct keys match without this; the rest
// are a leading zero.
const ITEM = new Map();
for (const p of prodItems) {
  if (!p.legacy_id) continue;
  const raw = String(p.legacy_id).replace(/^PI:/, '');
  ITEM.set(raw, p.id);
  ITEM.set(raw.replace(/^0+/, ''), p.id);
}
console.log(`Resolved ${Object.keys(LOC).length} locations and ${prodItems.length} production items.`);

/* -------------------------------------------------------------------------- */
/* 2. Guard                                                                    */
/* -------------------------------------------------------------------------- */

const { count, error: cntErr } = await db
  .from('special_orders').select('*', { count: 'exact', head: true }).eq('org_id', ORG);
if (cntErr) die('count', cntErr);
if (count > 0 && !WIPE) {
  die('guard', new Error(`special_orders already has ${count} rows — rerun with --wipe to replace them`));
}
if (WIPE && count > 0) {
  // Orders first: items, payments, events and attachments all cascade from
  // them. Customers second, and only the FileMaker ones — a customer created
  // in the app is somebody's work, and an order pointing at a deleted customer
  // takes `on delete set null` rather than vanishing.
  const { error: e1 } = await db.from('special_orders').delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (e1) die('wipe orders', e1);
  const { error: e2 } = await db.from('customers').delete().eq('org_id', ORG).eq('source', 'filemaker');
  if (e2) die('wipe customers', e2);
  console.log(`Wiped the existing FileMaker rows (of ${count} orders).`);
}

/* -------------------------------------------------------------------------- */
/* 3. Customers                                                                */
/* -------------------------------------------------------------------------- */

async function insertAll(tableName, rows, label, select) {
  const back = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const q = db.from(tableName).insert(chunk);
    const { data: got, error } = select ? await q.select(select) : await q;
    if (error) die(`${label} insert at ${i}`, error);
    if (select) back.push(...got);
    process.stdout.write(`\r  ${label}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log('');
  return back;
}

console.log('\nInserting…');
const customerRows = data.customers.map((c) => ({ org_id: ORG, ...c }));
const insertedCustomers = await insertAll('customers', customerRows, 'customers', 'id, legacy_id');
const CUSTOMER = new Map(insertedCustomers.map((c) => [c.legacy_id, c.id]));

/* -------------------------------------------------------------------------- */
/* 4. Orders                                                                   */
/* -------------------------------------------------------------------------- */

const unknownLocation = new Map();
const orderRows = data.orders.map((o) => {
  const pick = (code) => {
    if (!code) return null;
    const id = LOC[code];
    if (!id) unknownLocation.set(code, (unknownLocation.get(code) ?? 0) + 1);
    return id ?? null;
  };
  const { customer_legacy, location_code, kitchen_code, ...rest } = o;
  return {
    org_id: ORG,
    ...rest,
    customer_id: customer_legacy ? CUSTOMER.get(customer_legacy) ?? null : null,
    location_id: pick(location_code),
    kitchen_location_id: pick(kitchen_code),
  };
});
const insertedOrders = await insertAll('special_orders', orderRows, 'orders', 'id, legacy_id, legacy_seq');
const ORDER = new Map(insertedOrders.map((o) => [`${o.legacy_id}#${o.legacy_seq}`, o.id]));

/* -------------------------------------------------------------------------- */
/* 5. Children                                                                 */
/* -------------------------------------------------------------------------- */

let linkedLines = 0, unlinkedKeys = 0;
const itemRows = [];
for (const i of data.items) {
  const order_id = ORDER.get(`${i.order_legacy}#${i.order_seq}`);
  if (!order_id) continue;                    // impossible; the transform filtered
  let production_item_id = null;
  if (i.production_item_legacy) {
    production_item_id = ITEM.get(String(i.production_item_legacy))
      ?? ITEM.get(String(i.production_item_legacy).replace(/^0+/, '')) ?? null;
    if (production_item_id) linkedLines++; else unlinkedKeys++;
  }
  const { order_legacy, order_seq, production_item_legacy, ...rest } = i;
  itemRows.push({ org_id: ORG, order_id, production_item_id, ...rest });
}
await insertAll('special_order_items', itemRows, 'items');

const paymentRows = data.payments.map((p) => {
  const { order_legacy, order_seq, ...rest } = p;
  return { org_id: ORG, order_id: ORDER.get(`${order_legacy}#${order_seq}`), ...rest };
}).filter((p) => p.order_id);
await insertAll('special_order_payments', paymentRows, 'payments');

const eventRows = data.events.map((e) => {
  const { order_legacy, order_seq, ...rest } = e;
  return { org_id: ORG, order_id: ORDER.get(`${order_legacy}#${order_seq}`), ...rest };
}).filter((e) => e.order_id);
await insertAll('special_order_events', eventRows, 'events');

/* -------------------------------------------------------------------------- */
/* 6. Verify — an insert reporting success is not the rows being right         */
/* -------------------------------------------------------------------------- */

console.log('\n── VERIFY ──');
const counts = {};
for (const t of ['customers', 'special_orders', 'special_order_items',
                 'special_order_payments', 'special_order_events']) {
  const { count: n, error } = await db.from(t).select('*', { count: 'exact', head: true }).eq('org_id', ORG);
  if (error) die(`verify ${t}`, error);
  counts[t] = n;
  console.log(`  ${t}: ${n}`);
}

const loaded = await fetchAll('special_orders',
  'id, number, kind, status, event_date, customer_id, kitchen_location_id, location_id, standing_days');
const distinct = new Set(loaded.map((r) => r.number)).size;
console.log(`  fetched ${loaded.length}, ${distinct} distinct numbers ` +
  `${distinct === loaded.length ? 'OK' : '*** PAGES OVERLAPPED ***'}`);

const tally = (fn) => {
  const m = new Map();
  for (const r of loaded) { const v = fn(r) ?? '(null)'; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ');
};
console.log(`  kinds   : ${tally((r) => r.kind)}`);
console.log(`  statuses: ${tally((r) => r.status)}`);
console.log(`  no customer: ${loaded.filter((r) => !r.customer_id).length} (expect 74 — 73 blank + 1 orphan)`);
console.log(`  no kitchen : ${loaded.filter((r) => !r.kitchen_location_id).length}`);
console.log(`  no pickup shop: ${loaded.filter((r) => !r.location_id).length} (expect ~8,147 — the field is new in FMP)`);
console.log(`  standing orders: ${loaded.filter((r) => r.standing_days?.length).length} (expect 10)`);
console.log(`  MATERIALIZED standing days: ` +
  `${loaded.filter((r) => r.kind === 'order' && r.standing_days).length} (MUST be 0 — decision 13)`);

const dates = loaded.map((r) => r.event_date).filter(Boolean).sort();
console.log(`  event dates: ${dates[0]} → ${dates[dates.length - 1]}`);

console.log(`\n  item links: ${linkedLines} resolved, ${unlinkedKeys} keyed lines whose item is not in the catalog`);
if (unknownLocation.size) {
  console.log(`  UNKNOWN LOCATION CODES (left null): ` +
    [...unknownLocation].map(([c, n]) => `${c}=${n}`).join('  '));
}

const expected = {
  customers: data.customers.length,
  special_orders: data.orders.length,
  special_order_items: itemRows.length,
  special_order_payments: paymentRows.length,
  special_order_events: eventRows.length,
};
let ok = true;
for (const [t, n] of Object.entries(expected)) {
  if (counts[t] !== n) { console.error(`\n  ✗ ${t}: expected ${n}, found ${counts[t]}`); ok = false; }
}
if (!ok) process.exit(1);
console.log(`\nLoaded ${counts.special_orders} special orders.\n`);
