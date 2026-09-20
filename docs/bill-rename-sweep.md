# Bill rename sweep — what migration 110 changed, and what it did not

Migrations `supabase/migrations/110_bills_not_invoices.sql` and
`111_restore_discount_lock.sql`, decided with Mark 2026-09-20. The naming rule
is now recorded in CLAUDE.md → Conventions → "Table naming", beside migration
005's, whose ceremony this followed.

Mark: *"Invoices as currently implemented should really be called Bills. Bills
are documents we have to pay. An invoice, by contrast, is a document our
customers have to pay."* The point of the rename is to free the word for a
customer-facing Invoices feature on Special Orders — weekly wholesale billing,
where seven standing orders become one invoice. **None of that is built.**

## The map

| old | new |
|---|---|
| `vendor_invoices` | `vendor_bills` |
| `vendor_invoice_lines` | `vendor_bill_lines` |
| `vendor_bill_lines.invoice_id` | `bill_id` |
| `purchase_order_attachments.invoice_id` | `bill_id` |
| `location_tasks.vendor_invoice_id` | `vendor_bill_id` |
| `set_vendor_invoice_approval(p_invoice, …)` | `set_vendor_bill_approval(p_bill, …)` |
| `record_accounting_push(p_invoice, …)` | `record_accounting_push(p_bill, …)` |
| `enforce_vendor_invoice_financials_lock()` | `enforce_vendor_bill_financials_lock()` |
| `enforce_vendor_invoice_line_financials_lock()` | `enforce_vendor_bill_line_financials_lock()` |
| `touch_vendor_invoice_financials_from_line()` | `touch_vendor_bill_financials_from_line()` |
| `/invoices` | `/bills` |
| `lib/invoices` | `lib/bills` |
| `lib/invoiceQueries` · `lib/invoiceFilters` · `lib/invoiceFromExtraction` | `lib/billQueries` · `lib/billFilters` · `lib/billFromExtraction` |
| `Invoice{List,Detail,Actions,BatchActions,CommandMenu,Summary}` · `NewInvoice` · `VendorInvoices` | `Bill…` · `NewBill` · `VendorBills` |
| `BillInvoice` | `PushableBill` |
| `invoice_id` / `invoice_ids` on `qbo-sync`'s wire | `bill_id` / `bill_ids` |
| `rf.invoice.view` · `rf.invoices.columnWidths.v1` · `rf.invoiceLines.columnWidths.v1` · `rf.vendorInvoices.v2` | `rf.bill.view` · `rf.bills.columnWidths.v1` · `rf.billLines.columnWidths.v1` · `rf.vendorBills.v2` |

The saved column widths and the remembered list view reset once, deliberately —
a read-old-write-new shim would be permanent code paying for a one-time cost.

## What KEPT the word, and why

**"Invoice" still means something precise in this app: the VENDOR'S PRINTED
PAPER.** Everything below names that, not our record, and renaming it would
make the name lie.

- **`invoice_number`, `invoice_date`** — transcriptions of what is printed.
  QuickBooks draws the same line: a Bill carries the vendor's own `DocNumber`.
- **All of `lib/invoiceExtraction.ts` and `lib/invoiceMatch.ts`** — the reading
  of a photographed document and the join of its lines to a purchase order.
  `lib/bills.ts`' own header states the seam: *"The record and the READING are
  deliberately different things."*
- **The edge function `extract-invoice`** — a deployed URL, and it reads a
  document that says Invoice at the top. Its stored extraction keys
  (`invoice_number`, `invoice_date`, `invoice_total`) live inside existing
  `purchase_order_attachments.extraction` jsonb, so renaming them would be a
  backfill, not a deploy.
- **The attachment kind value `'invoice'`** (001's check constraint) — what
  somebody says a document IS when they attach it, and the behavioural trigger
  for auto-read on attach.
- **The storage key segment `{org_id}/invoices/{id}/…`** — a KEY, not a name.
  Every document already in the bucket was written under it and
  `purchase_order_attachments.storage_path` records where each one went;
  changing it orphans them all and buys nothing, because 018's policies read
  only the FIRST segment. `billOwner()` in `lib/attachments.ts` says so on the
  spot.
- **The column headers "Invoice" and "Invoiced"** on both bill lists — they
  render `invoice_number` and `invoice_date`.
- **User-facing copy about the paper**: "Read invoice", "Drop the invoice
  here", "Also file invoice 73535581 as a bill", "the invoice reads …", "where
  the invoice says $190.95", `invoice.pdf`.

## Do NOT touch

- **Applied migrations 001–109.** Never edited; 005's precedent.
- **Everything in `docs/history/`** and the two files carrying the "Moved
  verbatim from CLAUDE.md" banner elsewhere. They are the record of what was
  decided when, and `docs/history/04d-invoices.md` keeps its filename. CLAUDE.md
  carries the translation map so they stay readable as written.
- **`docs/purchasing-spec.md`** — frozen at v0.10, exactly as it was left out of
  005's sweep.
- **The A/R side.** `special_orders.status = 'invoice'`, `invoice_sent_at`,
  `invoice_paid_at`, `notes_invoice`, `invoice_footer`, `invoice_item_ref`,
  `INVOICE_SHEET_KEY`, `buildInvoicePayload`, `invoicePushRefusals`,
  `invoiceSplit`, `push_invoice`, and everything under
  `components/specialOrders/`. This is the half the rename exists to make room
  for.
- **QuickBooks' own entity strings** — `QboEntity = "Bill" | "VendorCredit" |
  "Invoice"`. Not ours to rename. `lib/quickbooks.ts:49–58` records the day a
  missing member here mislabelled a customer invoice "Bill 8797".
- **The edge modes** `push_bill`, `find_bills`, `refresh_status` — already
  correct before this.

## Order of operations — DONE 2026-09-20

The app 404'd on two screens between 005's SQL and its code ship. This one broke
three deployables, so the order was tighter:

1. Code on `main` (`39ac16b`, `ba4b256`, `37fb535`).
2. Mark ran **110** then **111** in the Supabase SQL editor. *From there
   `/bills`, the QuickBooks push and the realm-change clear were all broken
   until step 3.*
3. `supabase functions deploy qbo-sync` and `supabase functions deploy qbo-oauth`.
4. Restart `next dev`.

The edge deploy **cannot** be separated from the SQL — both name the table
literally — which is why 3 follows 2 immediately. Nothing was in production use,
so no dual-name compatibility shim was written.

## Verified 2026-09-20, after both migrations were applied

1. `npx tsc --noEmit`, `npm run lint`, `npm run fixtures` — clean, 1,916 cases.
2. `grep -rn "vendor_invoice" web/src supabase/functions` and
   `grep -rn "/invoices" web/src` — no hits.
3. **Dry run before Mark touched the hosted DB.** 110 is not rerunnable, so both
   migrations were applied first to a throwaway Postgres 15 loaded with a
   condensed fixture carrying the real object names. Everything renamed, nothing
   left over, `anon` still refused both definer functions.
4. **Live schema:** 87 bills, 697 lines, 88 attachments — counts unchanged.
   `vendor_invoices` / `vendor_invoice_lines` gone (`PGRST205`); all three old
   columns gone (`42703`); `set_vendor_invoice_approval` gone (`PGRST202`);
   `set_vendor_bill_approval` and `record_accounting_push(p_bill, …)` both
   answer and refuse with zero rows.
5. **Live lock**, on a throwaway bill created and deleted for the purpose (count
   back to 87): on an approved bill `total` and `discount` are both REFUSED with
   *"This bill is approved — withdraw approval before editing its figures."*,
   `notes` is still editable, and after reopening, `discount` saves and stamps
   `financials_touched_at`. **The `discount` refusal is 111 working — it
   succeeded before.**
6. **Live edge function**, the part `tsc` cannot see because Deno imports
   nothing from `web/src`. A one-off magic-link session on the owner account
   (read-only `find_bills` only, signed out after) returned `{"candidates":[]}`
   for `bill_ids` with a non-matching uuid — the renamed field and
   `vendor_bills` both cross the wire.
   **Sharp edge found: the OLD field name does not error, it silently means "no
   filter"**, so `find_bills` with `invoice_ids` returns candidates for every
   unpushed bill. Pre-existing (the field was always optional), harmless now
   that client and function deploy together, but it is how a stale client would
   look like it was working.
7. **Live UI:** `/bills` lists and filters (Bill / Credit Memo); the detail
   screen keeps `INVOICE NUMBER`, `INVOICE DATE`, the `Invoiced` column and the
   attachment kind `Invoice`; the command menu reads Approve for Payment · Send
   to QuickBooks · Void Bill · Delete Bill…; the nav tab and the vendor record's
   fourth tab both read Bills and `?tab=bills` resolves.
8. **A/R untouched:** the special-order status filter still offers Invoice, and
   the stage legend still reads Lead · Quote sent · Quote returned · Invoice
   sent · Invoice paid · Printed & scheduled.

**Not done, deliberately:** nobody pressed Approve or Void on a real bill.
`set_vendor_bill_approval` writes `approved_by = auth.uid()`, and an approval is
a claim about who said so — it must not say a session that was minted for
testing.

## The bug found on the way

091 added `vendor_invoices.discount` and locked it against edits on an approved
bill. 109 replaced that function to add `is_credit`, writing its body from
090's, and the `discount` clause went with it — silently, because a `create or
replace` cannot notice a line the new body lacks. **An approved bill's discount
has been editable ever since**, and `financials_touched_at` was not stamped when
it changed. Migration 111 restores it, separately from 110 so the rename stays
reviewable as a rename.
