#!/usr/bin/env node
/**
 * Restaurant Friend — FMP catalog + PO history loader.
 *
 * Reads the transformed JSON produced by the Cowork transform pipeline and
 * loads it into Supabase using the service_role key (bypasses RLS).
 *
 * Run from the migration/ folder:
 *     npm install
 *     node --env-file=.env load.mjs            # first load (refuses if data exists)
 *     node --env-file=.env load.mjs --wipe     # wipe migrated tables, then load
 *
 * .env must contain:
 *     SUPABASE_URL=https://<project>.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY=<service role key — NEVER commit this>
 *
 * Data location: ../../FMP Export/transformed  (override with DATA_DIR=... )
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const WIPE = process.argv.includes('--wipe');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env load.mjs');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const J = (name) => JSON.parse(readFileSync(resolve(DATA, `${name}.json`), 'utf8'));
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
if (!existsSync(resolve(DATA, 'vendors.json'))) die('startup', new Error(`No vendors.json in ${DATA}`));

const { data: orgs, error: orgErr } = await db.from('orgs').select('id').limit(1);
if (orgErr) die('orgs', orgErr);
const ORG = orgs[0].id;

const { data: locRows } = await db.from('locations').select('id, code');
const LOC = Object.fromEntries(locRows.map((l) => [l.code, l.id]));

const { count } = await db.from('vendors').select('*', { count: 'exact', head: true });
if (count > 0 && !WIPE) die('guard', new Error(`vendors table already has ${count} rows — rerun with --wipe to replace migrated data`));

if (WIPE) {
  console.log('wiping previously migrated data…');
  // reverse dependency order; org-scoped only. Deletes are batched by id —
  // single-statement deletes of 100k+ rows hit Supabase's statement timeout.
  //
  // `purchase_reminders` and `purchase_requests` were on this list and came off
  // it (2026-08-21). They were here because nothing loaded them and nothing
  // wrote them, so wiping them cost nothing — but neither is migrated data any
  // more: reminders have had a writer since 2026-07-31 and requests since
  // migration 059. A --wipe to reload the CATALOG would have silently destroyed
  // every reminder and every open request in the system, with no export to
  // restore them from. Nothing else on this list is anything but FileMaker's.
  for (const t of ['purchase_order_attachments', 'purchase_order_items', 'purchase_orders',
                   'order_guide_entries', 'order_guide_plan_days', 'inventory_item_locations',
                   'shop_sections', 'vendor_item_location_prices', 'price_history', 'par_history',
                   'vendor_items', 'inventory_items', 'vendor_locations', 'vendors']) {
    if (t === 'vendor_item_location_prices') {
      // composite PK, tiny table — one statement is fine
      const { error } = await db.from(t).delete().eq('org_id', ORG);
      if (error) die(`wipe ${t}`, error);
      continue;
    }
    let total = 0;
    for (;;) {
      const { data: ids, error: selErr } = await db.from(t).select('id').eq('org_id', ORG).limit(1000);
      if (selErr) die(`wipe ${t} (select)`, selErr);
      if (!ids.length) break;
      const { error } = await db.from(t).delete().in('id', ids.map((r) => r.id));
      if (error) die(`wipe ${t}`, error);
      total += ids.length;
      process.stdout.write(`\rwipe ${t}: ${total}   `);
    }
    if (total) console.log();
  }
}

// 1. locations backfill --------------------------------------------------
for (const l of J('locations')) {
  if (!LOC[l.code]) continue;
  const { data: cur } = await db.from('locations').select('settings').eq('id', LOC[l.code]).single();
  const { error } = await db.from('locations').update({
    address: l.address,
    settings: { ...cur.settings, ...l.settings },
    ...(l.name ? { name: l.name } : {}),
  }).eq('id', LOC[l.code]);
  if (error) die(`locations ${l.code}`, error);
}
console.log('locations: addresses/settings backfilled');

// 2. vendors --------------------------------------------------------------
const VEND = {};
{
  const rows = J('vendors').map((v) => ({
    org_id: ORG, name: v.name, vendor_type: v.vendor_type, description: v.description,
    order_type: v.order_type, url: v.url, po_prefix: v.po_prefix, notes: v.notes,
    is_active: v.is_active, legacy_id: v.legacy_id,
  }));
  for (const r of await insertBatched('vendors', rows, 'id, legacy_id')) VEND[r.legacy_id] = r.id;
}

// 3. vendor_locations -----------------------------------------------------
await insertBatched('vendor_locations', J('vendor_locations').map((v) => ({
  org_id: ORG, vendor_id: VEND[v.vendor_legacy_id], location_id: LOC[v.location_code],
  account_number: v.account_number, minimum_order: v.minimum_order, sales_rep: v.sales_rep,
  rep_phone: v.rep_phone, rep_email: v.rep_email, order_days: v.order_days,
  delivery_days: v.delivery_days, is_active: v.is_active,
})));

// 4. inventory_items ------------------------------------------------------
const ITEM = {};
{
  const rows = J('inventory_items').map((i) => ({
    org_id: ORG, name: i.name, category: i.category, base_unit: i.base_unit,
    note: i.note, is_active: i.is_active, legacy_id: i.legacy_id,
  }));
  for (const r of await insertBatched('inventory_items', rows, 'id, legacy_id')) ITEM[r.legacy_id] = r.id;
}

// 5. vendor_items ---------------------------------------------------------
const VITEM = {};
{
  const rows = J('vendor_items').map((v) => ({
    org_id: ORG, vendor_id: VEND[v.vendor_legacy_id],
    inventory_item_id: ITEM[v.inventory_item_legacy_id] ?? null,
    product_id: v.product_id, brand: v.brand, description: v.description,
    package_desc: v.package_desc, package_content: v.package_content, price: v.price,
    url: v.url, notes: v.notes, is_active: v.is_active, legacy_id: v.legacy_id,
  }));
  for (const r of await insertBatched('vendor_items', rows, 'id, legacy_id')) VITEM[r.legacy_id] = r.id;
}

// 6. per-location price overrides ----------------------------------------
await insertBatched('vendor_item_location_prices', J('vendor_item_location_prices').map((p) => ({
  vendor_item_id: VITEM[p.vendor_item_legacy_id], location_id: LOC[p.location_code],
  org_id: ORG, price: p.price,
})));

// 7. shop sections --------------------------------------------------------
const SEC = {};
{
  const rows = J('shop_sections').map((s) => ({
    org_id: ORG, location_id: LOC[s.location_code], area: s.area, sub_area: s.sub_area,
    display_name: s.display_name, sort_order: s.sort_order,
  }));
  const back = await insertBatched('shop_sections', rows, 'id, display_name, location_id');
  const codeByLoc = Object.fromEntries(Object.entries(LOC).map(([c, id]) => [id, c]));
  for (const r of back) SEC[`${codeByLoc[r.location_id]}|${r.display_name}`] = r.id;
}

// NOTE (migration 005): tables were renamed for clarity, but the transformed
// JSON files keep their original FMP-era names (item_locations.json, …) —
// J('item_locations') below reads the FILE; insertBatched targets the TABLE.

// 8. inventory_item_locations ---------------------------------------------
const ILOC = {};
{
  const src = J('item_locations');
  const rows = src.map((i) => ({
    org_id: ORG, inventory_item_id: ITEM[i.inventory_item_legacy_id],
    location_id: LOC[i.location_code],
    shop_section_id: i.shop_section_display ? SEC[`${i.location_code}|${i.shop_section_display}`] ?? null : null,
    default_vendor_item_id: VITEM[i.default_vendor_item_legacy_id] ?? null,
    default_par: i.default_par, note: i.note, is_active: i.is_active,
  }));
  const back = await insertBatched('inventory_item_locations', rows, 'id, inventory_item_id, location_id');
  const legByUuid = Object.fromEntries(Object.entries(ITEM).map(([leg, id]) => [id, leg]));
  const codeByLoc = Object.fromEntries(Object.entries(LOC).map(([c, id]) => [id, c]));
  for (const r of back) ILOC[`${legByUuid[r.inventory_item_id]}|${codeByLoc[r.location_id]}`] = r.id;
}

// 9. order_guide_plan_days ------------------------------------------------
await insertBatched('order_guide_plan_days', J('item_order_days')
  .filter((d) => ILOC[`${d.inventory_item_legacy_id}|${d.location_code}`])
  .map((d) => ({
    org_id: ORG, item_location_id: ILOC[`${d.inventory_item_legacy_id}|${d.location_code}`],
    weekday: d.weekday, vendor_item_id: VITEM[d.vendor_item_legacy_id] ?? null,
    par_qty: d.par_qty, par_mode: d.par_mode,
  })));

// 10. purchase orders + line items ---------------------------------------
const POID = {};
{
  const src = J('purchase_orders');
  const rows = src.map((p) => ({
    org_id: ORG, po_number: p.po_number, vendor_id: VEND[p.vendor_legacy_id],
    location_id: LOC[p.location_code], status: p.status, sent_via: p.sent_via,
    order_date: p.order_date, delivery_date: p.delivery_date,
    notes: p.notes, sent_notes: p.sent_notes,
  }));
  const back = await insertBatched('purchase_orders', rows, 'id, po_number');
  const byNum = Object.fromEntries(back.map((r) => [r.po_number, r.id]));
  for (const p of src) POID[p.legacy_id] = byNum[p.po_number];
}
for (const part of ['po_items_1', 'po_items_2']) {
  await insertBatched('purchase_order_items', J(part)
    .filter((p) => POID[p.po_legacy_id])
    .map((p) => ({
      org_id: ORG, po_id: POID[p.po_legacy_id],
      vendor_item_id: VITEM[p.vendor_item_legacy_id] ?? null,
      description: p.description, brand: p.brand, product_id: p.product_id,
      package_desc: p.package_desc, qty_ordered: p.qty_ordered,
      qty_received: p.qty_received, unit_price: p.unit_price,
    })));
}

console.log('\nDONE. Sanity counts:');
for (const t of ['vendors', 'vendor_locations', 'inventory_items', 'vendor_items',
                 'vendor_item_location_prices', 'shop_sections', 'inventory_item_locations',
                 'order_guide_plan_days', 'purchase_orders', 'purchase_order_items']) {
  const { count: c } = await db.from(t).select('*', { count: 'exact', head: true });
  console.log(`  ${t}: ${c}`);
}
console.log('\nExpected: vendors 80 · vendor_locations 135 · inventory_items 790 · vendor_items 2888');
console.log('          prices 135 · sections 168 · inventory_item_locations 1237 · plan days 10462');
console.log('          purchase_orders 16814 · purchase_order_items 104669');
