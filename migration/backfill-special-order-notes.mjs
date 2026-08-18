#!/usr/bin/env node
/**
 * Restore the double quotes `transform-special-orders.mjs` used to strip.
 *
 * WHAT WENT WRONG. Its `text()` reader removed a wrapping pair of double quotes
 * from every value, written for `Delivery_Company` — which really does read
 * `"DeliverLA"` on 357 rows. The .mer parser beside it already un-escapes CSV
 * quoting properly, so anything still wrapped at that point is a quote somebody
 * TYPED, and on a letter-cake order the quotes are the entire note: the note IS
 * `"W"`, the letter being iced onto that donut. FileMaker's own quote PDF for
 * order 9885 prints `"W"`; ours printed `W`, which reads as a stray character.
 *
 * FOUND BY RENDERING THE DOCUMENTS, not by reading the code — which is the
 * argument for phase 3's acceptance test being a render against the references.
 *
 * WHAT IT TOUCHES. Only values where the export's own text differs from the
 * stored one by EXACTLY the wrapping quotes: 4,336 line notes in the OrderItems
 * era, 295 in the repeating-field era, and a short tail of order-level fields
 * (delivery company and phone, the per-document notes, a few titles). Anything
 * a human has since edited is left alone, because the comparison is against
 * what the strip WOULD have produced — if the row no longer holds that, it is
 * not this bug's row.
 *
 *   node --env-file=.env backfill-special-order-notes.mjs           # dry run
 *   node --env-file=.env backfill-special-order-notes.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Special Orders');
const APPLY = process.argv.includes('--apply');

const GS = String.fromCharCode(0x1d);
const VT = String.fromCharCode(0x0b);

/* ---------------------------------------------------------------------- */

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

function table(name) {
  const path = resolve(SRC, name);
  if (!existsSync(path)) { console.error(`No ${path}`); process.exit(1); }
  const all = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = all[0].map((h) => h.trim());
  const rows = [];
  for (const r of all.slice(1)) {
    if (r.length !== header.length) continue;
    const o = {};
    header.forEach((h, j) => { o[h] = r[j]; });
    rows.push(o);
  }
  return rows;
}

/** What the transform reads TODAY — quotes intact. */
function text(v) {
  const s = (v ?? '').replace(new RegExp(VT, 'g'), '\n').trim();
  return s || null;
}

/** What the OLD reader produced. A row still holding this is a row the bug
 *  wrote; a row holding anything else has been edited since and is left be. */
function stripped(v) {
  let s = text(v);
  if (s === null) return null;
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s || null;
}

/* ---------------------------------------------------------------------- */

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** PostgREST caps a select at 1,000 rows and says nothing about it. */
async function fetchAll(query, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().order(order).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

console.log(APPLY ? 'APPLYING' : 'DRY RUN — pass --apply to write');

/* ---- 1. line notes ---------------------------------------------------- */
// Two eras (the brief's §"The two eras"): OrderItems rows carry FileMaker's own
// `_PrimaryKey` as `legacy_key`, and the pre-Aug-2021 repeating fields were
// loaded as `{order}#{slot}`. Both are keyed, so both can be corrected.

const wanted = new Map(); // legacy_key -> the faithful note

for (const r of table('OrderItems.mer')) {
  const key = (r._PrimaryKey ?? '').trim();
  if (key) wanted.set(key, text(r.notes_t));
}

// The v1 key is `{legacy_id}#{legacy_seq}#{slot}` — the SEQ is in it because
// `6002` occurs twice in the export as two different orders. It is positional,
// so a slot's note is found without re-deciding which slots materialized.
const seqByNumber = new Map();
for (const r of table('SpecialOrders.mer')) {
  const number = (r.OrderID ?? '').trim();
  if (!number) continue;
  const seq = (seqByNumber.get(number) ?? 0) + 1;
  seqByNumber.set(number, seq);
  if (!r.Item_Notes) continue;
  r.Item_Notes.split(GS).forEach((slot, i) => {
    wanted.set(`${number}#${seq}#${i + 1}`, text(slot));
  });
}

const lines = await fetchAll(
  () => db.from('special_order_items').select('id, legacy_key, notes').not('legacy_key', 'is', null),
  'id'
);
console.log(`  ${lines.length} migrated lines read`);

const lineFixes = [];
for (const line of lines) {
  const faithful = wanted.get(line.legacy_key);
  if (faithful === undefined) continue;
  if (faithful === line.notes) continue;
  // Only where the stored value is EXACTLY what the old reader would have made
  // of this export cell. Anything else is somebody's edit.
  if (stripped(faithful) !== line.notes) continue;
  lineFixes.push({ id: line.id, notes: faithful });
}
console.log(`  line notes to restore: ${lineFixes.length}`);
if (lineFixes.length) {
  console.log('  e.g.', lineFixes.slice(0, 3).map((f) => JSON.stringify(f.notes)).join(', '));
}

/* ---- 2. order-level text --------------------------------------------- */

const ORDER_FIELDS = {
  title: 'Event_Description',
  notes_quote: 'Notes_Quote',
  notes_production: 'Notes_Order',
  notes_invoice: 'Notes_Invoice',
  delivery_company: 'Delivery_Company',
  delivery_company_phone: 'Delivery_Company_Phone',
};

// Keyed by `{legacy_id}#{legacy_seq}`, not by the number: `6002` appears twice
// in the export as two DIFFERENT orders (the brief's correction 2), and keying
// on the number alone would hand the second one the first one's fields.
const exported = new Map();
const seqSeen = new Map();
for (const r of table('SpecialOrders.mer')) {
  const number = (r.OrderID ?? '').trim();
  if (!number) continue;
  const seq = (seqSeen.get(number) ?? 0) + 1;
  seqSeen.set(number, seq);
  exported.set(`${number}#${seq}`, r);
}

const orders = await fetchAll(
  () =>
    db
      .from('special_orders')
      .select(`id, legacy_id, legacy_seq, ${Object.keys(ORDER_FIELDS).join(', ')}`)
      .not('legacy_id', 'is', null),
  'id'
);
console.log(`  ${orders.length} migrated orders read`);

const orderFixes = [];
for (const order of orders) {
  const raw = exported.get(`${order.legacy_id}#${order.legacy_seq}`);
  if (!raw) continue;
  const patch = {};
  for (const [column, source] of Object.entries(ORDER_FIELDS)) {
    const faithful = text(raw[source]);
    if (faithful === order[column]) continue;
    if (stripped(raw[source]) !== order[column]) continue;
    patch[column] = faithful;
  }
  if (Object.keys(patch).length) orderFixes.push({ id: order.id, patch });
}
console.log(`  orders to correct: ${orderFixes.length}`);

/* ---- 3. write --------------------------------------------------------- */

if (!APPLY) {
  console.log('\nNothing written.');
  process.exit(0);
}

let done = 0;
for (const fix of lineFixes) {
  const { error } = await db
    .from('special_order_items')
    .update({ notes: fix.notes })
    .eq('id', fix.id);
  if (error) { console.error('  line', fix.id, error.message); process.exit(1); }
  if (++done % 500 === 0) console.log(`  … ${done} lines`);
}
console.log(`  ${done} line notes restored`);

let orderDone = 0;
for (const fix of orderFixes) {
  const { error } = await db.from('special_orders').update(fix.patch).eq('id', fix.id);
  if (error) { console.error('  order', fix.id, error.message); process.exit(1); }
  orderDone++;
}
console.log(`  ${orderDone} orders corrected`);
console.log('\nDone. Re-running writes 0.');
