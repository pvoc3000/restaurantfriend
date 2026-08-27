// One-off: fold the duplicate vendor_invoices the old auto-filer produced, and
// re-vendor the one record that was filed against the wrong vendor entirely.
//
//   node --env-file=.env cleanup-duplicate-invoices.mjs            # dry run
//   node --env-file=.env cleanup-duplicate-invoices.mjs --apply    # write
//
// WHY THIS EXISTS. Until 2026-08-27 the auto-filer's only guard was the
// attachment's own `invoice_id`, which is per-FILE: it could not see a second
// copy of an invoice, a second PAGE of one, or the same invoice read on a
// second order. Measured before the fix: 7 numbers on file more than once, so
// 49 filings had produced 49 records where they should have produced 41.
//
// IT USES THE APP'S OWN RULES, imported from the compiled build rather than
// restated here — `filedInvoiceFor` decides what is a duplicate, `unfiledLines`
// which lines a survivor is missing, `blankHeaderFields` which of its blanks a
// duplicate can fill, `linePrint` how two printed lines are paired. A cleanup
// that decided any of those for itself would leave the database in a state the
// fixed app would not have produced, which is the only thing that makes a
// cleanup worth doing. Run `npm run fixtures` in web/ first — this reads
// web/.fixtures-build.
//
// THE VESTA RECORD. One record numbered 96490390 sits under Vesta Foodservice
// carrying Dawn Foods' lines (DAWN BAL VEGAN, DAWN EXC, BUNGE) and Dawn's
// $1,985.99 total: a Dawn invoice was attached to a Vesta order, and the filer
// takes the vendor from the ORDER and never from the page. It is re-vendored
// FIRST, so the ordinary duplicate pass then folds it into the Dawn record it
// has always been a copy of. That underlying bug is not fixed here.

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  blankHeaderFields,
  filedInvoiceFor,
  linePrint,
  unfiledLines,
} from "../web/.fixtures-build/src/lib/invoices.js";

const APPLY = process.argv.includes("--apply");
const db = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const say = (s = "") => console.log(s);
/** The already-matched twin a link could not land on — for the report only. */
const twin_po = (twins, line) =>
  (twins.get(linePrint(line)) ?? []).find((t) => t.purchase_order_id)?.purchase_order_id;
const fail = (s) => {
  console.error(`REFUSED: ${s}`);
  process.exit(1);
};

/** Every row, in pages — PostgREST truncates a select at 1,000 and says nothing. */
async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) fail(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  if (new Set(out.map((r) => r.id)).size !== out.length) fail(`${table}: pagination overlap`);
  return out;
}

const invoices = (await all("vendor_invoices", "*")).sort((a, b) =>
  a.created_at.localeCompare(b.created_at)
);
const lines = await all("vendor_invoice_lines", "*");
const attachments = await all("purchase_order_attachments", "id, file_name, invoice_id");
const vendors = await all("vendors", "id, name");
const vName = new Map(vendors.map((v) => [v.id, v.name]));
// Paginated like everything else: there are 16,900 purchase orders, and a
// single select would return the first 1,000 and say nothing, so every PO
// number in the report below would read "undefined".
const poNumber = new Map((await all("purchase_orders", "id, po_number")).map((p) => [p.id, p.po_number]));
const linesOf = (id) => lines.filter((l) => l.invoice_id === id);

say(`${invoices.length} invoices, ${lines.length} lines, ${APPLY ? "APPLYING" : "dry run"}`);
say();

// ---------------------------------------------------------------------------
// 1. The mis-vendored record
// ---------------------------------------------------------------------------
const dawn = vendors.find((v) => v.name === "Dawn Foods");
if (!dawn) fail("no vendor named Dawn Foods");
const misfiled = invoices.filter(
  (i) => i.invoice_number === "96490390" && vName.get(i.vendor_id) === "Vesta Foodservice"
);
if (misfiled.length > 1) fail(`expected one mis-vendored 96490390, found ${misfiled.length}`);

if (misfiled.length === 1) {
  const bad = misfiled[0];
  // Prove it before touching it: the lines have to be Dawn's.
  const dawnish = linesOf(bad.id).filter((l) => /DAWN|BUNGE|BARCL/i.test(l.description ?? "")).length;
  if (dawnish === 0) fail(`${bad.id} does not carry Dawn lines — not the record this expected`);
  say(`Vesta → Dawn Foods: ${bad.id.slice(0, 8)} #${bad.invoice_number} $${bad.total} (${dawnish} Dawn lines of ${linesOf(bad.id).length})`);
  if (APPLY) {
    const { data, error } = await db
      .from("vendor_invoices")
      .update({ vendor_id: dawn.id })
      .eq("id", bad.id)
      .select("id");
    if (error) fail(error.message);
    if (!data?.length) fail("re-vendoring changed no rows");
  }
  bad.vendor_id = dawn.id; // so the fold below sees it under its real vendor
}
say();

// ---------------------------------------------------------------------------
// 2. Fold the duplicates
// ---------------------------------------------------------------------------
const kept = [];
const folds = [];
for (const invoice of invoices) {
  const survivor = filedInvoiceFor(
    { vendor_id: invoice.vendor_id, invoice_number: invoice.invoice_number, is_credit: invoice.is_credit },
    kept
  );
  if (!survivor) {
    kept.push(invoice);
    continue;
  }
  folds.push({ duplicate: invoice, survivor: kept.find((k) => k.id === survivor.id) });
}

if (folds.some((f) => f.duplicate.approved_at || f.survivor.approved_at)) {
  fail("an approved invoice is involved — approving is a person's act and this must not discard one");
}

say(`${folds.length} records fold into ${new Set(folds.map((f) => f.survivor.id)).size} survivors:`);

// Deleting an invoice takes its lines with it (025 cascades) and there is no
// undo, so everything this run can destroy is written out first — the records,
// their lines and the documents pointing at them, as they stand right now.
// Outside the repo, beside the other exports: it names vendors and money.
if (APPLY) {
  const at = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${process.env.HOME}/rf-invoice-cleanup-${at}.json`;
  const touched = new Set(folds.flatMap((f) => [f.duplicate.id, f.survivor.id]));
  writeFileSync(
    path,
    JSON.stringify(
      {
        takenAt: at,
        note: "Pre-cleanup state of every invoice this run touches, plus its lines and documents.",
        invoices: invoices.filter((i) => touched.has(i.id)),
        lines: lines.filter((l) => touched.has(l.invoice_id)),
        attachments: attachments.filter((a) => touched.has(a.invoice_id)),
      },
      null,
      2
    )
  );
  say(`backup: ${path}`);
}
say();

let movedLines = 0, carriedLinks = 0, unmovedLinks = 0, repointed = 0, patched = 0;
/** Orders whose match is dropped, so the report can name them. */
const droppedMatches = new Set();

for (const { duplicate, survivor } of folds) {
  const held = linesOf(survivor.id);
  const mine = linesOf(duplicate.id);
  const fresh = unfiledLines(held, mine);
  const freshIds = new Set(fresh.map((l) => l.id));

  say(`#${duplicate.invoice_number} ${vName.get(duplicate.vendor_id)}  ${duplicate.id.slice(0, 8)} → ${survivor.id.slice(0, 8)}`);
  say(`   ${mine.length} lines: ${fresh.length} move, ${mine.length - fresh.length} already held`);

  // (a) Lines the survivor lacks — re-parented, keeping their own rows so any
  //     PO link on them travels with them.
  for (const line of fresh) {
    if (APPLY) {
      const { error } = await db
        .from("vendor_invoice_lines")
        .update({ invoice_id: survivor.id, line_no: line.line_no })
        .eq("id", line.id);
      if (error) fail(error.message);
    }
    held.push({ ...line, invoice_id: survivor.id });
    movedLines++;
  }

  // (b) A link on a line the survivor ALREADY holds. Paired by `linePrint`, the
  //     same key `unfiledLines` uses, each twin claimed once. Fill an empty
  //     link, never replace one — the rule `linkMatchedLines` follows, so the
  //     result matches what the fixed app would have written. A link that
  //     cannot land is reported rather than forced: a line holds one PO item,
  //     and a consolidated invoice read on two orders genuinely has more
  //     matches than places to put them.
  const twins = new Map();
  for (const line of held) {
    const key = linePrint(line);
    if (!twins.has(key)) twins.set(key, []);
    twins.get(key).push(line);
  }
  for (const line of mine) {
    if (freshIds.has(line.id) || !line.purchase_order_id) continue;
    const twin = (twins.get(linePrint(line)) ?? []).find((t) => !t.purchase_order_id);
    if (!twin) {
      unmovedLinks++;
      droppedMatches.add(poNumber.get(line.purchase_order_id) ?? line.purchase_order_id);
      say(`   · line ${line.line_no} (${line.product_id ?? (line.description ?? "").slice(0, 24)}) was matched to PO ${poNumber.get(line.purchase_order_id)}; the survivor's line is matched to PO ${poNumber.get(twin_po(twins, line))} and keeps it`);
      continue;
    }
    if (APPLY) {
      const { error } = await db
        .from("vendor_invoice_lines")
        .update({
          purchase_order_id: line.purchase_order_id,
          purchase_order_item_id: line.purchase_order_item_id,
        })
        .eq("id", twin.id);
      if (error) fail(error.message);
    }
    twin.purchase_order_id = line.purchase_order_id;
    twin.purchase_order_item_id = line.purchase_order_item_id;
    carriedLinks++;
  }

  // (c) Header blanks the duplicate can fill.
  const patch = blankHeaderFields(survivor, duplicate);
  delete patch.id;
  delete patch.created_at;
  delete patch.updated_at;
  if (Object.keys(patch).length > 0) {
    say(`   · fills blanks: ${Object.keys(patch).join(", ")}`);
    if (APPLY) {
      const { error } = await db.from("vendor_invoices").update(patch).eq("id", survivor.id);
      if (error) fail(error.message);
    }
    Object.assign(survivor, patch);
    patched++;
  }

  // (d) Documents that named the duplicate now name the survivor.
  for (const a of attachments.filter((x) => x.invoice_id === duplicate.id)) {
    say(`   · ${a.file_name} → the survivor`);
    if (APPLY) {
      const { error } = await db
        .from("purchase_order_attachments")
        .update({ invoice_id: survivor.id })
        .eq("id", a.id);
      if (error) fail(error.message);
    }
    repointed++;
  }

  // (e) Gone. Any line still on it is one the survivor already holds; they
  //     cascade (025's FK is `on delete cascade`).
  if (APPLY) {
    const { data, error } = await db
      .from("vendor_invoices")
      .delete()
      .eq("id", duplicate.id)
      .select("id");
    if (error) fail(error.message);
    // A delete matching no policy removes nothing and returns NO error.
    if (!data?.length) fail(`${duplicate.id} was not deleted — check permissions`);
  }
  say();
}

say(`${folds.length} records folded · ${movedLines} lines moved · ${carriedLinks} PO links carried · ${unmovedLinks} left behind · ${repointed} documents repointed · ${patched} headers filled in`);
say(`invoices: ${invoices.length} → ${kept.length}`);

// THE ONE THING THIS COSTS, stated rather than buried. An invoice line holds ONE
// purchase-order item, so where a duplicate matched the same printed lines to a
// DIFFERENT order than the survivor did, only one match survives — and the
// survivor's, being older, is the one kept.
//
// These are not consolidated invoices: on a genuinely consolidated bill the
// lines SPLIT between the orders, where here every line of the duplicate
// matched order A and every line of the survivor matched order B. That is the
// signature of one invoice being read against two orders, which is how the
// duplicate came to exist in the first place — the same vendor delivers the
// same products every week, so the matcher pairs them against either order
// happily. One of the two matches was always wrong; which one is a judgement
// about which delivery the bill covers, and this script does not make it.
//
// Nothing is stranded: each order keeps its own attachment and the reading on
// it, so its receiving screen still shows the invoice; what it loses is the
// FILED link. "Link to PO…" on invoice detail is how to put one back.
if (droppedMatches.size > 0) {
  say();
  say(`Orders whose filed match is dropped — worth checking which delivery each bill really covers:`);
  for (const po of [...droppedMatches].sort()) say(`   ${po}`);
}
if (!APPLY) say(`\nDry run. Re-run with --apply to write.`);
