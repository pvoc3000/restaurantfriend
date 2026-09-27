#!/usr/bin/env node
/**
 * Restaurant Friend — does the payments ledger (migration 140) still say what
 * the old `special_order_payments` table said?
 *
 * 140 carried every old payment row into `customer_payments` +
 * `payment_applications`, keeping each row's id as its application's id, and
 * proved parity inside the migration before committing. This is the same
 * proof, re-runnable from outside, for the two weeks before 144 drops the old
 * table. READ-ONLY: it selects and prints; it writes nothing.
 *
 * For every order the old table knew about, it compares the paid total and the
 * HELD total (money on no live invoice) against the ledger's rows with the same
 * ids; for every live invoice, what it collected. Payments recorded AFTER 140
 * live only in the ledger and are reported as a count, not a mismatch. An old
 * payment whose AMOUNT somebody edited or removed since 140 does show as a
 * mismatch — expected, and the line names the order to look at.
 *
 * Paged past PostgREST's silent 1,000-row cap — both tables hold ~6,500 rows.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env check-ledger-parity.mjs
 * Exit code 0 = parity; 1 = a mismatch (listed).
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const cents = (v) => Math.round(Number(v) * 100);

const [old, apps, invoices] = await Promise.all([
  all("special_order_payments", "id, order_id, customer_invoice_id, amount"),
  all("payment_applications", "id, special_order_id, customer_invoice_id, amount"),
  all("customer_invoices", "id, number, voided_at"),
]);

const voided = new Set(invoices.filter((i) => i.voided_at).map((i) => i.id));
const oldIds = new Set(old.map((p) => p.id));
const carried = apps.filter((a) => oldIds.has(a.id));
const since = apps.length - carried.length;

function byOrder(rows, orderKey) {
  const m = new Map();
  for (const r of rows) {
    const o = r[orderKey];
    if (!o) continue;
    const e = m.get(o) ?? { paid: 0, held: 0 };
    e.paid += cents(r.amount);
    if (!r.customer_invoice_id || voided.has(r.customer_invoice_id)) e.held += cents(r.amount);
    m.set(o, e);
  }
  return m;
}

function byInvoice(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.customer_invoice_id || voided.has(r.customer_invoice_id)) continue;
    m.set(r.customer_invoice_id, (m.get(r.customer_invoice_id) ?? 0) + cents(r.amount));
  }
  return m;
}

const problems = [];

if (carried.length !== old.length) {
  problems.push(`${old.length} old rows, but ${carried.length} applications carry their ids`);
}

const oldO = byOrder(old, "order_id");
const newO = byOrder(carried, "special_order_id");
for (const id of new Set([...oldO.keys(), ...newO.keys()])) {
  const a = oldO.get(id) ?? { paid: 0, held: 0 };
  const b = newO.get(id) ?? { paid: 0, held: 0 };
  if (a.paid !== b.paid || a.held !== b.held) {
    problems.push(`order ${id}: paid ${a.paid / 100} → ${b.paid / 100}, held ${a.held / 100} → ${b.held / 100}`);
  }
}

const oldI = byInvoice(old);
const newI = byInvoice(carried);
const number = new Map(invoices.map((i) => [i.id, i.number]));
for (const id of new Set([...oldI.keys(), ...newI.keys()])) {
  if ((oldI.get(id) ?? 0) !== (newI.get(id) ?? 0)) {
    problems.push(`invoice ${number.get(id) ?? id}: collected ${(oldI.get(id) ?? 0) / 100} → ${(newI.get(id) ?? 0) / 100}`);
  }
}

console.log(`old rows ${old.length} · carried ${carried.length} · recorded since 140 ${since}`);
console.log(`orders compared ${new Set([...oldO.keys(), ...newO.keys()]).size} · live invoices compared ${new Set([...oldI.keys(), ...newI.keys()]).size}`);
if (problems.length) {
  console.log(`\n${problems.length} MISMATCH${problems.length === 1 ? "" : "ES"}:`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("parity holds");
