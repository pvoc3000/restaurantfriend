# Customer credit memos — design brief

**Status: DESIGNED 2026-10-31, NOT BUILT. Revised the same day** around a
DELIVERY RECORD (Mark: "I want whatever we design for credit memos to follow
world class accounting standards and do things the proper way"). Mark's
answers so far are at the end; the questions marked **ASK** are still open.
Read `CLAUDE.md` (the customer invoices thread), then
`docs/history/04g-special-orders.md` from "THE TEXTBOOK A/R MODEL" on, then
this.

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
- **Nothing records what was delivered.** An order goes to `order` (or
  `invoice`) and stays there; no status, stamp or quantity says it went out,
  or how much of it.
- 176's history names the gap: "A decrease on a paid QuickBooks invoice has no
  clean path — that is a credit memo, on the not-built list."

The only credit memos in the app before this were VENDOR ones
(`vendor_bills.is_credit`, pushed as a QuickBooks `VendorCredit`).

---

## The standard this follows

Order-to-cash in any system built on standard accounting (NetSuite, SAP,
QuickBooks' larger editions) keeps **three quantities, each with its own
document**:

1. **Ordered**: the sales order. Here, the special order. **It is never
   changed to say what happened** (Mark, 2026-10-31: the quantity means
   ordered).
2. **Delivered**: the fulfillment record (a packing slip, a delivery ticket,
   a proof of delivery). **This app has none, and this brief adds one.**
3. **Invoiced**: what was billed. The invoice lines (141).

When invoiced exceeds delivered, the correction is a **credit memo** that:

- **gets its quantity from the delivery record**, never from a number typed in
  on its own;
- **names the invoice it corrects**;
- **carries a reason code**;
- **is approved by someone with the authority** (manager and up, §10).

Standard practice also separates two kinds of credit, and so does this design:

- **Short shipment** (and, later, returns): there is a quantity, and the
  delivery record proves it. It reverses the sale, so it goes back through the
  same revenue item.
- **Allowance**: a price concession with no quantity behind it (quality, a
  late delivery, a pricing error, goodwill). It also gets a reason code and
  approval. Most charts of accounts book it to a contra-revenue account
  ("Sales Returns and Allowances") so the concessions can be seen rather than
  netted invisibly out of sales (§7).

**The first draft of this brief got this wrong.** It let the Issue dialog take
a typed short quantity with nothing behind it, which is exactly the step
standard practice doesn't allow.

---

## Decisions

### 1. The delivery record: a delivered quantity on every order line

**New:** `special_order_items.delivered_qty`, with a stamp on the order
(`delivered_at`, `delivered_by`) once the order's delivery is recorded. Null
means **not recorded**, never "delivered in full". A short needs a **reason**
(`delivery_note`), which the event log keeps ("Delivered 518 of 560 Knotted
Bismark — dropped a rack. Recorded by …").

**Recorded at the handover**, by whoever gives the order to the customer or
the driver. That is where the Knotted short was actually noticed, and it is
what a delivery ticket records. **ASK: where.** The candidates:

- **(a) the order screen**: a **Record Delivery…** command;
- **(b) a tablet tile** on `/start`: today's orders at this shop, tap one,
  confirm;
- **(c) the shift report**: a page listing the shift's special orders.

Recommended: (a) now, plus (b) when the floor needs it. (c) comes too late in
the day: it is the closer, often the next morning, recording what someone
else handed over.

**The two answers it asks for:** **Delivered in full** (one tap), or **Short…**
(enter each line's delivered quantity and a reason). Delivered-in-full being
one tap is deliberate, since it is nearly always the answer, but it is an act
somebody takes and is stamped with their name. It is **not a prefilled box**:
the shift report's `→` copies the planned amount for the same reason, and §2
shows what that does to a record.

**ASK: is it required?** An order that is past its date with no delivery
recorded could appear on the To-do list (161's flags), so a short can't simply
go unmentioned. Recommended: a To-do flag, not a block on anything.

### 2. The premade sheet's "made" count is a CROSS-CHECK, not the record

Mark asked whether the shift report's **made** column could generate credit
memos. It is the right kind of data, and it is not the delivery record.
Measured 2026-10-31, special-order lines on schedules since 2026-09-01:

| | lines |
|---|---|
| On a schedule | 281 |
| Counted | 228 |
| **Made = planned** | **227** |
| Made less | **0** |
| Made more | 1 |
| Never counted | 53 |

All 15 Knotted days from 10/17 to 10/30 read made = planned, with nothing
left. The shop's own premade lines vary normally (176 under, 210 over, out of
2,385), so supervisors do count those. On special orders the `→`, which takes
the planned amount, looks like the habit: "we made what we were asked to".
As the record stands, a short like Knotted's would not appear in it. And even
counted honestly:

- **made is not handed over**: a rack can be dropped after counting, or a box
  can go out short at pickup;
- it is entered **by the closer, the next day**;
- it is keyed by **production item**, not order line, so an order with two
  lines of the same donut is ambiguous;
- not every order goes through a schedule (53 lines were never counted).

So the two records stay separate, as production and shipping records are in
any business, and the app **reconciles** them: when an order's
made − left over is less than ordered, the order and its To-do say so ("Made
518 of 560 — delivery recorded in full"). That catches a short that nobody
recorded at the handover. **ASK** whether this check is wanted. It is only
worth having if the made count is honest, which means retraining the `→`
habit on special-order pages, or removing the `→` there.

### 3. The credit memo comes FROM the delivery record

When delivered < billed on an order an invoice has billed, the order says so:

> Delivered 518 of 560 Knotted Bismark. INV-10025-2 billed all 560.
> **Issue Credit Memo…**

The dialog is **prefilled and capped by the record**, not typed:

- each short item: billed quantity − delivered − already credited, at the
  price it was **billed** at ("Knotted Bismark — short 42, delivered 518 of
  560", 42 × $1.55);
- **tax** on a taxed item, at the rate it was billed at, as its own line;
- the **delivery charge is not credited by a short**: the delivery still
  happened. If one should be refunded, that is an allowance (§4);
- reason code **Short shipment**, and the record's note;
- it **names the invoice** ("Credits INV-10025-2").

A manager can credit **less** than the record supports, never more. To credit
more, correct the delivery record first, which leaves its own trace.

**The order is never edited.** `special_order_billed`, `special_order_unbilled`
and `order_item_billing` are left alone, and must stay that way: if memo lines
lowered an order's billed amount, a 560-donut order would look under-billed by
$65.10 and be invoiced again. The order shows **Ordered · Delivered · Billed ·
Credited** side by side.

**A make-good** (the 42 delivered later, on another day) is recorded as
delivered on the order it goes out with. If that order is a new one, it is
billed as usual. If the memo is still unapplied, it can be voided instead.

**If delivery is recorded BEFORE the order is invoiced**, nothing needs a
memo. **ASK** whether the invoice should then bill what was delivered. That is
how billing in arrears works, and it is the bookkeeper's question below. Not
in v1: today every Knotted order is invoiced a week or more before it goes
out.

### 4. Allowances: a credit with a reason and no quantity

From the order, the invoice or the customer record: **New Allowance…**, which
takes an amount, a **reason code** (from a list in `orgs.settings`; proposed
**Quality · Late delivery · Pricing error · Goodwill**) and a note. It may name
an order and an invoice, for the record, and that changes nothing about how
the order is billed. Untaxed in v1. A taxed allowance reduces the tax
collected, which needs the bookkeeper's view first.

Same document, numbering, approval, application and QuickBooks path as a short
shipment memo. Only the reason and the posting account (§7) differ.

### 5. Its credit uses 143's machinery, with a second source

Today `payment_applications.payment_id` is the only source of credit. Add
`credit_memo_id` beside it, with exactly one of the two set. Then:

- `customer_credit` lists unapplied memos alongside unapplied payments.
- `apply_credit_to_invoice` uses **memos first**, oldest first, **then**
  payments, oldest first (Mark, 2026-10-31). Payment credit can still be
  refunded through Square; memo credit can't.
- `customer_invoice_paid` already adds up applications, so an invoice's
  balance includes the credit. Its label becomes "Payments and credits".
- `customer_balances.credit`, `customer_account_entries` and the statement
  include memos. The statement prints a memo as a credit line on its own date.
- `check-ledger-parity.mjs` learns the new source.

**Rejected: storing the memo as a fake `customer_payments` row** ("Credit
Memo", $65.10). It would reuse more code, but every cash reader (receipts, the
"Payment received" email, deposits, the Payments tab, refunds) would have to
learn to skip it, and the first one that didn't would be wrong. A memo is not
money received.

**Rejected: storing the memo as a negative `customer_invoices` row**, the way
vendor credits are `vendor_bills.is_credit`. Every invoice path assumes a
positive total: the pay link, send problems, Revise, the QuickBooks push, the
Invoices list. A separate table costs less than teaching each of those.

### 6. Applying it to the next invoice, for both processors

The credit is applied **automatically when the next invoice is SENT**, the rule
143 already has for Square, and now for QuickBooks too:

- **Square:** unchanged. The applications are written and the pay link asks
  for the balance.
- **QuickBooks:** `push_customer_invoice` pushes the invoice as now, then posts
  `Payment { TotalAmt: 0, Line: [ {Amount: 65.10, LinkedTxn: Invoice},
  {Amount: 65.10, LinkedTxn: CreditMemo} ] }`, which is QuickBooks' own way of
  applying a credit. The QuickBooks invoice then shows the credit and its pay
  link asks for $65.10 less. The Payment's id is stored on the application, so
  it is never recorded twice.

The paper invoice prints the credit as its own line under the total: "Credit
CM-10000 (10/31) −$65.10 · Balance due". The application exists before the PDF
is rendered.

**Apply Credit by hand** stops refusing QuickBooks invoices, for memo credit
only. Payment credit on a QuickBooks invoice is still refused, because that
money is Square's or QuickBooks' own and has no QuickBooks document to link.

### 7. The QuickBooks CreditMemo itself

Pushed when the memo is **issued** (not when it is applied), so the credit is
in QuickBooks the same day. A new `qbo-sync` mode, `push_credit_memo`, mirrors
`push_customer_invoice`:

- The same customer link (refused if the customer has none).
- **A short shipment** uses the same items, class and location as the invoice
  lines it reverses (165: the kitchen's Class and Location), so **the revenue
  comes back out of the account it went into**. This is why it must be a
  CreditMemo and not a journal entry or a refund.
- **An allowance** uses one QuickBooks item per reason, mapped in settings the
  way delivery and rush are (165). **ASK the bookkeeper** which account each
  maps to: a contra-revenue "Sales Returns and Allowances" (standard), or the
  sales account itself.
- The tax code is chosen by the memo's rate, through `applyTaxCode`, as for
  invoices.
- `DocNumber` is the memo's number with its prefix. The reason and note go in
  the memo's customer message, and "Credits INV-10025-2" in its private note.
- `external_ref.qbo` stores `{ id, sync_token, doc_number, entity:
  "CreditMemo" }`, written before anything else can fail, as the invoice push
  does.

A memo for a **Square-collected** customer is NOT pushed. Square's sales go
into QuickBooks by the nightly journal entry, and a CreditMemo against revenue
QuickBooks never saw as an invoice would reverse it twice. Same rule as
invoices: **whether the app pushes depends on who collects.** It leaves no
trace in QuickBooks at all (Mark, 2026-10-31). Its credit lowers what the pay
link collects, and the journal entry books the smaller sale correctly.

### 8. THE TWO QUICKBOOKS TRAPS (both must be fixed in the same release)

**(a) Our own credit applications would be recorded as cash.**
`sync_qbo_payments` and `qbo-webhook` both read each QuickBooks Payment and
record **every line linked to an Invoice** as a QuickBooks Payments receipt,
through `record_qbo_invoice_payment`, and send the shop's "paid online" notice.
The zero-total Payment from §6 would come back as $65.10 of cash, counting the
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
is created, before §6's Payment. **Fix:** after creating the invoice, the push
reads the invoice's `LinkedTxn`. If QuickBooks already applied the memo, it
records that Payment's id on the application and posts nothing. Otherwise it
posts the Payment. Either way the app and QuickBooks agree. Probe the setting
read-only before building, and tell Mark which way it is set.

### 9. Number, document, email, changes

- **Number:** its own series, `customer_credit_memos.first_number` and
  `prefix` in `orgs.settings`, beside the invoice settings (design rule 2):
  **"CM-", from 10000**, matching the invoices' five digits (Mark,
  2026-10-31). A separate series keeps QuickBooks' duplicate-number warning
  quiet and never makes an invoice number look skipped. The number STORES no
  prefix and the paper prints it, as invoices do (147).
- **PDF:** a new form, "Credit memo", in `components/forms/formCatalog.ts`. It
  uses the invoice's layout and parts: the customer, the memo number and date,
  "Credits invoice INV-10025-2", the reason, the lines ("Knotted Bismark —
  delivered 518 of 560 on 10/31, short 42"), the total, and "This credit will
  be applied to your next invoice."
- **Email:** sent the way invoices are, from the order's conversation when the
  memo comes from one order (167/210), using a template in `orgs.settings`
  with `{employee_name}`. **Issue and Email** is the default button.
- **Frozen once issued**, like a sent invoice.
- **Void…** while nothing of it is applied. It is voided in QuickBooks first
  (refused there, and so here, if QuickBooks has applied it), and the order's
  Credited figure drops back.
- **Once applied**, it is changed only by voiding the invoice it was applied
  to, which releases the application (140's void trigger, taught the new
  source), then voiding the memo. A second memo is never the way to undo the
  first.
- **Refunding memo credit** (paying the customer back instead) is NOT in v1
  (Mark, 2026-10-31: later). The money never came from Square, so
  `square-refund` can't do it. When it comes, it is "record a check or cash
  refund", a negative entry against the memo, plus a QuickBooks
  `RefundReceipt` for a QuickBooks customer. The customer's Credit section
  offers no Refund… on memo credit until then.

### 10. Who may do what

- **Issue or void a memo, or an allowance:** **manager and up** (owner, admin;
  Mark, 2026-10-31). A memo gives money away, which matches refunds
  (`payment_credit_refundable` is owner/admin) rather than Revise
  (supervisor+).
- **Record a delivery:** **ASK.** Recommended: **staff and up**, since
  whoever hands the order over records it. Correcting a recorded delivery is
  supervisor and up, and leaves a trace.

Both go into `lib/pageAccess.ts`, not inline.

---

## For whoever does the books (not a software question)

**Billing in advance books the revenue before the donuts are delivered.**
Knotted's weekly invoice is pushed to QuickBooks a week or more ahead, so the
sale is on the books before anything goes out. Standard accrual accounting
(ASC 606) recognizes revenue when the goods are delivered: money paid in
advance is a **customer deposit** (a liability) until then, or the customer is
billed afterwards for what was delivered. Plenty of small wholesale bakeries
bill in advance anyway, and a credit memo is the normal correction when they
do, so this design works either way. The questions to ask:

1. Is billing in advance acceptable for these books, or should wholesale be
   billed in arrears (once a week, for what was delivered)? The delivery
   record in §1 is what billing in arrears would read, so it is not wasted
   either way.
2. Which account takes allowances: a contra-revenue "Sales Returns and
   Allowances", or sales itself? (§7)
3. Should an allowance on a taxed sale reduce the sales tax? (§4)

---

## What it touches

**Schema (one migration, or two: the delivery record can ship first):**

- `special_order_items.delivered_qty`; `special_orders.delivered_at`,
  `delivered_by`, `delivery_note`. A definer function `record_order_delivery`
  (in full, or per line with a reason for any short) and its correction,
  logged to the order's events. A To-do flag (161) for an order past its date
  with nothing recorded.
- `customer_credit_memos`: org, customer, number, kind (`short_shipment` ·
  `allowance`), reason_code, note, issued_on, credits_invoice_id,
  location_id (the collecting shop, as for invoices), document_path,
  external_ref, sent_at, voided_at, created_by. Unique (org, number).
- `customer_credit_memo_lines`: memo_id, special_order_id,
  special_order_item_id, line_type (item · tax · allowance), description, qty,
  unit_price, amount, taxable, tax_rate, sort. Checks: an item line's quantity,
  with what earlier memos credited, never exceeds billed − delivered of that
  item; an allowance line has no quantity.
- `payment_applications.credit_memo_id`, `payment_id` made nullable, a check
  that exactly one is set, and the QuickBooks Payment id that applied it.
- New functions: `order_creditable(order)` (per item: billed, delivered,
  already credited, the most that can be credited), `special_order_credited`,
  `issue_credit_memo`, `issue_allowance`, `void_credit_memo`,
  `next_credit_memo_number`.
- **NOT changed, deliberately:** `special_order_billed`,
  `special_order_unbilled`, `order_item_billing` (§3).
- Changed: `customer_credit`, `apply_credit_to_invoice`,
  `apply_customer_credit`, `customer_balances`, `customer_account_entries`,
  the void-releases-payments trigger, `trg_log_payment_application`, and the
  order's event log ("Credit memo CM-10000 issued, $65.10").
- RLS on every new table (org-scoped read, writes only through the definer
  functions). Every new function is revoked from `anon` by name.
  **EVERY INSERT PASSES `org_id`.**

**Edge functions:** `qbo-sync` (`push_credit_memo`, `void_credit_memo`, the
apply step in `push_customer_invoice`, and §8's fix in `sync_qbo_payments`),
`qbo-webhook` (§8's fix), and `send-special-order-email` (the memo document).
Each `--no-verify-jwt` flag is checked against the live function before
deploying.

**Web:** Record Delivery… on the order (and the tablet tile if chosen); the
order's Ordered · Delivered · Billed · Credited figures; the made-vs-delivered
cross-check (if wanted); the Issue Credit Memo and New Allowance dialogs; a
credit memo record screen (`/credit-memos/[id]`, walking the customer's found
set); the customer record's Credit section listing memos; the invoice's
"Credit CM-…" line; the statement row; the PDF and its specimen in
`components/forms/formSamples.ts`; fixtures for any JS mirror of
`order_creditable` (the dialog's caps); and the staff guide in `app/guides/`
for recording a delivery.

---

## Build phases

0. **The delivery record**, on its own. It is useful the day it ships (the
   order says what went out) and it is what every memo reads. Shipping it first
   also gives a few weeks of real records before memos depend on them.
1. **Ledger.** Memos, allowances and the second credit source, with memo
   credit applied to SQUARE invoices only. Harness-tested on PG15 against the
   scenarios below, rehearsed on the live DB in a transaction that never
   commits, then applied by Mark.
2. **QuickBooks.** First the read-only probe of `AutoApplyCredit`. Then
   `push_credit_memo`, the apply step, and §8's fix in both `sync_qbo_payments`
   and `qbo-webhook`, deployed together. Then apply credit on QuickBooks
   invoices is switched on. Checked against one real memo, by Mark.
3. **Paper.** The PDF, the email, the invoice's credit line and the statement.
4. **Screens.** The dialogs, the record and the customer's section, checked in
   the browser pane.

Phases 1 and 2 must ship together for QuickBooks customers. Phase 1 alone must
not let memo credit reach a QuickBooks invoice.

**Scenarios to test:** the Knotted case (560 ordered and billed on a paid
QuickBooks invoice, delivery recorded 518 with a reason, memo prefilled and
capped at 42 = $65.10, the order still billed $918 and NOT offered for
invoicing again, next invoice $65.10 less in the app and in QuickBooks, no cash
recorded); a memo for more than the record allows, refused; a second memo on
the same item capped at what is left; correcting the delivery record after a
memo; an allowance with no quantity; a memo larger than the next invoice (the
rest stays credit); two memos oldest first; void before apply; void refused
after apply; voiding the invoice it was applied to brings the credit back; a
Square customer (no push, the pay link asks less); a QuickBooks Payment of cash
plus credit recorded as the cash only; `AutoApplyCredit` on and off; staff and
supervisor refused a memo; made 518 vs delivered in full raising the
cross-check.

---

## Mark's answers (2026-10-31)

1. An order's quantity means **ordered**, and the order is never edited to say
   what happened (§1, §3). Mark then asked for the standard way, which is what
   added the delivery record.
2. Numbering: **"CM-" from 10000** (§9).
3. Memos are issued by **manager and up** (§10).
4. **Memo credit first**, then payment credit (§5).
5. Refunding memo credit: **later**, not v1 (§9).
6. A Square customer's memo: **nothing in QuickBooks** (§7).

## Still open (ASK)

1. Where a delivery is recorded: the order screen, a tablet tile, the shift
   report? (§1)
2. Is recording one required (a To-do flag when it is missing)? (§1)
3. Who may record one: staff and up? (§10)
4. The made-vs-delivered cross-check: wanted, and what happens to the `→` on
   special-order premade pages? (§2)
5. The bookkeeper's three questions: billing in advance or in arrears, the
   allowance account, tax on allowances.

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

Either way, **have the closing supervisor enter the real made count for
SO-10137** (518, if that is what went out) instead of tapping `→`, and write
the short in the order's notes. That keeps the day's record true until the
delivery record exists.

**Do not** create the CreditMemo by hand in QuickBooks. QuickBooks would apply
it, the app would not know, Knotted would pay $65.10 less than the app's
invoice, and the app would show them owing it.
