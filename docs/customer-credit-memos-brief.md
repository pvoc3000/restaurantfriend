# Customer credit memos — design brief

**Status: DESIGNED 2026-10-31, NOT BUILT.** Read `CLAUDE.md` (the customer
invoices thread), then `docs/history/04g-special-orders.md` from "THE TEXTBOOK
A/R MODEL" on, then this. The decisions marked **ASK** are Mark's to make
before any migration is written.

---

## Why

Mark, 2026-10-31:

> we accidentally shorted Knotted some donuts this morning (518 when it should
> have been 560). Since they paid in advance, I think I need to create a credit
> memo for them that we can apply to their next invoice.

What the app could do that day:

- **SO-10137** (Sat 10/31): 560 Knotted Bismarks at $1.55, untaxed, pickup, a
  $50 delivery charge. Billed on **INV-10025-2**, a QuickBooks invoice, paid
  10/22. The short is **42 × $1.55 = $65.10**.
- **INV-10033** (Nov 2–8) was paid 10/30 too, so "the next invoice" is the one
  for the week of Nov 9, starting with SO-10168. It has not been created yet.
- **Revise…** is refused: "a QuickBooks invoice with money on it cannot be
  revised here — its payment is QuickBooks'" (143).
- **Credit** (143) exists but never reaches a QuickBooks invoice: Apply Credit
  refuses one, and an automatic apply skips it. QuickBooks would not know about
  the credit and would ask for the full amount.
- **Changing SO-10137 to 518 loses the $65.10 without saying so.** The paid
  invoice is frozen, and `customer_balances` counts only orders that owe MORE
  than their invoices ask, so an over-billed order shows nothing. Putting it
  on a new invoice makes a "Less invoice" line, which
  `customer_invoice_send_problems` refuses on QuickBooks ("cannot go on a
  QuickBooks invoice yet").
- 176's history names the gap: "A decrease on a paid QuickBooks invoice has no
  clean path — that is a credit memo, on the not-built list."

The only credit memos in the app before this were VENDOR ones
(`vendor_bills.is_credit`, pushed as a QuickBooks `VendorCredit`).

---

## The model in one paragraph

A **credit memo** is a document we issue, like an invoice, that says what we
owe the customer back and why. It has its own number ("CM-1000"), its own
lines, and is frozen once issued. Its total is **credit**, which is applied to
the customer's next invoice the way 143's credit already is: automatically on
send, or by hand. A credit memo is **not money received**. Nothing that adds
up `customer_payments` as cash has to learn to skip it. In QuickBooks it is a
`CreditMemo`, applied to the next invoice by a zero-total `Payment`, which is
QuickBooks' own way of applying a credit. That is the piece that makes credit
on a QuickBooks invoice possible: QuickBooks now knows about it.

---

## Decisions (recommended)

### 1. A credit memo usually comes from the ORDER being corrected

The app's rule since 141 is that the order is the truth and documents copy it:
an invoice copies an order's lines, and 176 makes a later invoice bill only
what was ADDED. A credit memo is the reverse: **it credits what was taken
away.**

So for Knotted: change SO-10137's quantity to 518, as it really was. The order
now asks $852.90 and its invoices bill $918.00. The order screen says so, with
a button:

> Billed $65.10 more than the order now comes to. **Issue Credit Memo…**

The memo's lines are copied the way 176 copies additions, in reverse. For each
item, the quantity billed and no longer on the order is credited at the price
it was billed at ("Knotted Bismark — 42 short", −42 × $1.55). Any decrease in
delivery, rush, discount or tax gets its own line.

After it is issued, the order is **billed exactly what it now asks**:
`special_order_billed` and `order_item_billing` subtract memo lines, so the
order is not over-billed and is never re-invoiced by mistake. If the 42 are
delivered later (a make-good), the order goes back to 560 and the next invoice
bills "42 in addition", as 176 already does.

**Free lines** cover credits that change nothing on the order, such as a
goodwill credit or "quality issues" on donuts that were delivered. They have no
order, just like an invoice's other charges: a description and an amount,
untaxed. They must never carry a `special_order_id`, or the order would look
under-billed and be invoiced again.

**ASK: does an order's quantity mean ORDERED or DELIVERED?** This design
assumes delivered, the quantity we bill. If the kitchen needs "ordered 560"
kept, the memo needs its own quantity, not the order's, and the order stays
over-billed on paper.

### 2. Where you start from

- **The order** (the banner above, or Actions → Issue Credit Memo…). This is
  the usual path.
- **A sent invoice** (Actions → Issue Credit Memo…). It opens the same dialog,
  showing every order on that invoice that is over-billed, plus free lines.
- **The customer record** (Credit section → New Credit Memo…). Free lines only.

The dialog asks for: the lines (prefilled from the decrease, editable down but
not past it), a **reason** that prints on the memo ("Shorted 42 at pickup"),
and the date. Then **Issue**, or **Issue and Email**.

### 3. Its credit uses 143's machinery, with a second source

Today `payment_applications.payment_id` is the only source of credit. Add
`credit_memo_id` beside it, with exactly one of the two set. Then:

- `customer_credit` lists unapplied memos alongside unapplied payments, oldest
  first.
- `apply_credit_to_invoice` uses them in the same oldest-first walk, before
  payments. **ASK** whether a memo goes first. Recommended: yes, because a
  memo can't be refunded through Square and a payment can.
- `customer_invoice_paid` already adds up applications, so an invoice's
  balance includes the credit. Its label becomes "Payments and credits".
- `customer_balances.credit`, `customer_account_entries` and the statement
  include memos. The statement prints a memo as a credit line on its own date.
- `check-ledger-parity.mjs` learns the new source.

**Rejected: storing the memo as a fake `customer_payments` row** ("Credit
Memo", $65.10). It would reuse more code, but every cash reader (receipts, the
"Payment received" email, deposits, the Payments tab, refunds) would have to
learn to skip it, and the first one that didn't would be wrong.

**Rejected: storing the memo as a negative `customer_invoices` row**, the way
vendor credits are `vendor_bills.is_credit`. Every invoice path assumes a
positive total: the pay link, send problems, Revise, the QuickBooks push, the
Invoices list. A separate table costs less than teaching each of those.

### 4. Applying it to the next invoice, for both processors

The credit is applied **automatically when the next invoice is SENT**, the rule
143 already has for Square, and now for QuickBooks too:

- **Square:** unchanged. The applications are written and the pay link asks
  for the balance.
- **QuickBooks:** `push_customer_invoice` pushes the invoice as now, then posts
  `Payment { TotalAmt: 0, Line: [ {Amount: 65.10, LinkedTxn: Invoice},
  {Amount: 65.10, LinkedTxn: CreditMemo} ] }`. The QuickBooks invoice then
  shows the credit and its pay link asks for $65.10 less. The Payment's id is
  stored on the application, so it is never recorded twice.

The paper invoice prints the credit as its own line under the total: "Credit
CM-1000 (10/31) −$65.10 · Balance due". The application exists before the PDF
is rendered.

**Apply Credit by hand** stops refusing QuickBooks invoices, for memo credit
only. Payment credit on a QuickBooks invoice is still refused, because that
money is Square's or QuickBooks' own and has no QuickBooks document to link.

### 5. THE TWO QUICKBOOKS TRAPS (both must be fixed in the same release)

**(a) Our own credit applications would be recorded as cash.**
`sync_qbo_payments` and `qbo-webhook` both read each QuickBooks Payment and
record **every line linked to an Invoice** as a QuickBooks Payments receipt,
through `record_qbo_invoice_payment`, and send the shop's "paid online" notice.
The zero-total Payment from §4 would come back as $65.10 of cash, counting the
credit twice and telling the shop Knotted paid. A customer paying $5,000 cash
plus $65.10 credit in one QuickBooks Payment would be recorded as $5,065.10.
**Fix:** the cash for an invoice is its Invoice-linked amount less the
Payment's CreditMemo-linked amounts. A Payment with `TotalAmt = 0` is skipped,
as is one whose id is already stored on a memo application. A Payment
spreading credit over several invoices is listed as a problem and not guessed
at.

**(b) QuickBooks may apply the credit itself.** QuickBooks has a company
setting, *Automatically apply credits* (Preferences →
`SalesFormsPrefs.AutoApplyCredit`, **UNVERIFIED for this company file**). If
it is on, QuickBooks applies the CreditMemo to the next Invoice the moment it
is created, before §4's Payment. **Fix:** after creating the invoice, the push
reads the invoice's `LinkedTxn`. If QuickBooks already applied the memo, it
records that Payment's id on the application and posts nothing. Otherwise it
posts the Payment. Either way the app and QuickBooks agree. Probe the setting
read-only before building, and tell Mark which way it is set.

### 6. The QuickBooks CreditMemo itself

Pushed when the memo is **issued** (not when it is applied), so the credit is
in QuickBooks the same day. A new `qbo-sync` mode, `push_credit_memo`, mirrors
`push_customer_invoice`:

- The same customer link (refused if the customer has none).
- The same items, class and location as the invoice lines it reverses (165:
  the kitchen's Class and Location), so **the revenue comes back out of the
  account it went into**. This is why it must be a CreditMemo and not a
  journal entry or a refund.
- Free lines go to the same item the invoice's other charges use.
- The tax code is chosen by the memo's rate, through `applyTaxCode`, as for
  invoices.
- `DocNumber` is the memo's number with its prefix.
- `external_ref.qbo` stores `{ id, sync_token, doc_number, entity:
  "CreditMemo" }`, written before anything else can fail, as the invoice push
  does.

A memo for a **Square-collected** customer is NOT pushed. Square's sales go
into QuickBooks by the nightly journal entry, and a CreditMemo against revenue
QuickBooks never saw as an invoice would reverse it twice. Same rule as
invoices: **whether the app pushes depends on who collects.** **ASK** whether
a Square customer's memo should carry a note for whoever does the books, or
nothing. Its credit simply lowers what the pay link collects, which the journal
entry then books correctly.

### 7. Number, document, email

- **Number:** its own series, `customer_credit_memos.first_number` and
  `prefix` in `orgs.settings`, beside the invoice settings (design rule 2).
  **ASK** about the prefix and first number. Proposed: "CM-", from 1000. A
  separate series keeps QuickBooks' duplicate-number warning quiet and never
  makes an invoice number look skipped.
- **PDF:** a new form, "Credit memo", in `components/forms/formCatalog.ts`. It
  uses the invoice's layout and parts: the customer, the memo number and date,
  "Credits invoice INV-10025-2" (or "Account credit" for free lines), the
  reason, the lines, the total, and "This credit will be applied to your next
  invoice."
- **Email:** sent the way invoices are, from the order's conversation when the
  memo comes from one order (167/210), using a template in `orgs.settings`
  with `{employee_name}`. **Issue and Email** is the default button.

### 8. Changing one after it is issued

- **Frozen once issued**, like a sent invoice.
- **Void…** while nothing of it is applied. It is voided in QuickBooks first
  (refused there, and so here, if QuickBooks has applied it), and the order
  goes back to over-billed.
- **Once applied**, it is changed only by voiding the invoice it was applied
  to, which releases the application (140's void trigger, taught the new
  source), then voiding the memo. A second memo is never the way to undo the
  first.
- **Refunding memo credit** (paying the customer back instead) is NOT in v1.
  The money never came from Square, so `square-refund` can't do it. **ASK** if
  it should be in v1. It would be "record a check or cash refund", a negative
  entry against the memo, plus a QuickBooks `RefundReceipt` for a QuickBooks
  customer.

### 9. Who may issue one

**ASK.** Recommended: **manager and up** (owner, admin). A memo gives money
away, which matches refunds (`payment_credit_refundable` is owner/admin) rather
than Revise (supervisor+). It goes into `lib/pageAccess.ts` as a write on the
special orders and customers pages, not inline.

---

## What it touches

**Schema (one migration):**

- `customer_credit_memos`: org, customer, number, issued_on, reason,
  location_id (the collecting shop, as for invoices), document_path,
  external_ref, sent_at, voided_at, created_by. Unique (org, number).
- `customer_credit_memo_lines`: memo_id, special_order_id,
  special_order_item_id, line_type (item · delivery · rush · discount · tax),
  description, qty, unit_price, amount, taxable, tax_rate, sort. Check: a line
  with no order is item or delivery, as 141 checks for invoices.
- `payment_applications.credit_memo_id`, `payment_id` made nullable, a check
  that exactly one is set, and the QuickBooks Payment id that applied it.
- New functions: `order_credit_lines(order)` (the decrease, in reverse of 176's
  `order_invoice_lines`), `issue_credit_memo`, `void_credit_memo`,
  `next_credit_memo_number`.
- Changed: `special_order_billed`, `special_order_unbilled`,
  `order_item_billing`, `customer_credit`, `apply_credit_to_invoice`,
  `apply_customer_credit`, `customer_balances`, `customer_account_entries`,
  the void-releases-payments trigger, `trg_log_payment_application`, and the
  order's event log ("Credit memo CM-1000 issued, $65.10").
- RLS on both tables (org-scoped read, writes only through the definer
  functions). Every new function is revoked from `anon` by name.
  **EVERY INSERT PASSES `org_id`.**

**Edge functions:** `qbo-sync` (`push_credit_memo`, `void_credit_memo`, the
apply step in `push_customer_invoice`, and §5's fix in `sync_qbo_payments`),
`qbo-webhook` (§5's fix), and `send-special-order-email` (the memo document).
Each `--no-verify-jwt` flag is checked against the live function before
deploying.

**Web:** the order's over-billed banner and command, the Issue dialog, a credit
memo record screen (`/credit-memos/[id]`, walking the customer's found set),
the customer record's Credit section listing memos, the invoice's "Credit
CM-…" line, the statement row, the PDF and its specimen in
`components/forms/formSamples.ts`, and fixtures for `order_credit_lines`' JS
mirror if there is one.

---

## Build phases

1. **Ledger.** The migration, with memo credit applied to SQUARE invoices
   only. Harness-tested on PG15 against the scenarios below, rehearsed on the
   live DB in a transaction that never commits, then applied by Mark.
2. **QuickBooks.** First the read-only probe of `AutoApplyCredit`. Then
   `push_credit_memo`, the apply step, and §5's fix in both `sync_qbo_payments`
   and `qbo-webhook`, deployed together. Then apply credit on QuickBooks
   invoices is switched on. Checked against one real memo, by Mark.
3. **Paper.** The PDF, the email, the invoice's credit line and the statement.
4. **Screens.** The banner, the dialog, the record and the customer's section,
   checked in the browser pane.

Phases 1 and 2 must ship together for QuickBooks customers. Phase 1 alone must
not let memo credit reach a QuickBooks invoice.

**Scenarios to test:** the Knotted case (560 → 518 on a paid QuickBooks
invoice, memo $65.10, next invoice $65.10 less in the app and in QuickBooks, no
cash recorded); a make-good back to 560 billed "in addition"; a free-line
credit; a memo larger than the next invoice (the rest stays credit); two memos
oldest first; void before apply; void refused after apply; voiding the invoice
it was applied to brings the credit back; a Square customer (no push, the pay
link asks less); a QuickBooks Payment of cash plus credit recorded as the cash
only; `AutoApplyCredit` on and off; staff and supervisor refused.

---

## Open questions for Mark (the ASKs above)

1. Does an order's quantity mean ordered or delivered? (§1)
2. Prefix and first number: "CM-" from 1000? (§7)
3. Who may issue a memo: manager and up? (§9)
4. Does memo credit go before payment credit? (§3)
5. Refunding memo credit: v1 or later? (§8)
6. A Square customer's memo: no QuickBooks trace, or a note? (§6)

---

## Knotted, before this exists

The next Knotted invoice (week of Nov 9) will be made before this is built.
Two choices:

- **The FileMaker way, now:** add a line to SO-10168, "Short 42 Bismarks,
  SO-10137 10/31", quantity −42 at $1.55, before that week's invoice is
  created. The database allows a negative quantity (that is how FileMaker
  credited shorts, history (f)). Not checked: whether the item editor accepts
  the minus sign, and how the QuickBooks push renders the line. Check the total
  before sending. Leave SO-10137 at 560, with a note.
- **Wait** and issue the memo once this ships. It would go on the invoice after
  next.

**Do not** create the CreditMemo by hand in QuickBooks. QuickBooks would apply
it, the app would not know, Knotted would pay $65.10 less than the app's
invoice, and the app would show them owing it.
