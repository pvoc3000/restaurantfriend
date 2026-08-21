# Special Orders module — build brief

**Status: phases 1–3 DONE and live (2026-08-20); 4 and 5 not yet.** Read
`CLAUDE.md` first, then this — and read the corrections directly below before
trusting any measurement in the body, because five of them are wrong.

---

## CORRECTIONS, measured against the real export at build time (2026-08-17)

Every figure in the body came from a reading of `SpecialOrders.mer` that used
`parseInt` on `OrderID`. That one mistake produced three of these five.

1. **`OrderID` IS TEXT, so `number` is a text column** — not `int` as the data
   model sketch says. The export carries `2899-01`, `2899-02`, `2899-03`,
   `3932 cont.`, `5689a`, `5691a`, `5697a`, `5542b`, `5753a`, `5915a` and
   `7220a`: eleven real order numbers somebody suffixed to split a job into
   parts. `purchase_orders.po_number` is text for the same kind of reason.

2. **There is ONE duplicated number, not five.** The brief names "2899 ×3,
   3932/5542/6002 ×2"; over the raw strings only **`6002`** repeats, and the
   two rows are DIFFERENT ORDERS (customer 4916, 9/9/2021, $253.88, paid;
   customer 4917, 9/24/2021, $188.89, unpaid). Both migrate — the later one as
   `6002-2`, with `legacy_seq` recording the collision.

3. **`menuItemKey_n` IS a production item id**, which the brief did not expect
   ("MenuItems retired… our source is production_items"). Checked rather than
   assumed: **20,518 of 20,561 keyed lines** resolve, and over those the line's
   own donut name agrees with the production item's on 19,482 and the SIZE
   agrees on 19,497 of 19,520. So migrated lines carry `production_item_id` and
   **history is schedulable**, which decision 9 assumed only new lines would be.

4. **`Notes_Invoice` is boilerplate, not a note.** Filled on 8,060 rows, of
   which 8,052 read "We appreciate your business!" — it is the invoice
   document's FOOTER. It lives in `orgs.settings.special_orders.invoice_footer`
   and only the eight rows that say something else keep a `notes_invoice`.

5. **`Order_ToDo` is empty on 8,233 of 8,334 rows.** The brief's ten-value list
   is FileMaker's VALUE LIST, not its data, and the data also holds "OH HOLD",
   "\*", "HOLIDAY" and "No need to print \*page 2\*". Decision 4's `allowNew` is
   therefore load-bearing; never turn `todo` into a check constraint.

Smaller ones, all reported by the transform: the malformed row the brief
mentions parses cleanly (0 malformed); 4 rows carry no OrderID at all and are
skipped as empty stubs; 9 OrderItems order numbers have no parent (61 lines);
`Event_Time` is a real TIME (8,166 of 8,185 parse; the 19 that don't are the
literal `?`); and only **50 of 8,330 orders** fail to reproduce FileMaker's
stored subtotal from their own lines, which is a strong result for decision 6.

---

Designed in conversation with Mark against the fresh FMP exports
(`FMP Export/Special Orders/` — re-exported 2026-08-16 from the live file after
the first export turned out to be an 18-month-stale copy), fifteen screenshots
(`DF Operations Screenshots/desktop/Special Orders/`), four real generated
PDFs for order 9885 (quote, invoice, receipt, kitchen order doc), three real
inquiry emails, and the DDR census of `DF-Quotes-Orders.fmp12`. Every
measurement below was taken from those files, not from memory.

Special Orders is where large orders and custom-donut orders live: a web-form
inquiry becomes a lead, a lead becomes a quote, a signed quote becomes a Square
invoice, a paid invoice becomes an order the kitchen makes. It closes a loop
the Production module left open on purpose — `production_schedules.source`
has carried `'special_order'` and a `source_ref` since migration 040
(decision 12 of the production brief: "special orders are a seam, not a
feature"). This module is the thing that plugs into that seam.

---

## Terminology

| FMP (DF-Quotes-Orders.fmp12) | Ours | What it is |
| --- | --- | --- |
| Order (120 fields) | `special_orders` | The order record, one per event |
| OrderItems (25 fields) | `special_order_items` | Line items — editable COPIES of production items |
| OrderPayments (11 fields) | `special_order_payments` | One row per payment received |
| Customer (43 fields) | `customers` | Who ordered; orders link to it |
| MenuItems (241 rows) | **retired** | The old pickable catalog. The live FMP already links/copies Production Items instead (Mark); our source is `production_items` + the price grid |
| History_Notes (a text blob) | `special_order_events` | The edit log, as real rows |
| Preferences, FCCalendar\* | **not migrated** | FMP plumbing |

"Order" unqualified in this document means a special order. Purchase orders are
always written out in full.

---

## What the FMP version got right (preserve these)

Twelve years of daily use — 8,334 orders, 2014 → this week, 27 currently
upcoming. Worth keeping on purpose:

- **The list is a work queue grouped by event date.** Day bands, one row per
  order, and the right edge is a grid of stage dates (quote sent → order
  printed) where an empty cell IS the to-do list. Red marks a stage that's
  overdue, green the stage you're waiting on.
- **Items are copies, not links.** A line starts as a production item and is
  then customized freely ("Promise Ring - Glazed - Letter", note `"P"`). The
  exact PO-line snapshot philosophy this app already follows.
- **One kitchen document serves the whole chain.** The order doc groups by size
  class, prints the customized name PLUS the full taxonomy line
  (donut · type · cut · finish · size), and ends in signature bands.
- **The log.** Every meaningful act appended with author and timestamp
  ("8/15/2026 6:07:04 PM [Abim]: Order printed"), plus manual entries.
- **Duplicate-to-start.** Templates, standing orders and plain duplication all
  reuse "copy this order" — one mechanism, three uses.
- **"Other orders that day"** on the record — context that stops a supervisor
  double-booking a kitchen.

## What it got wrong (the diseases, so the cure is legible)

- **Record KIND and workflow STATUS share one field.** `Order_Type` holds
  Lead/Quote/Invoice/Order/Cancelled (a ladder) AND Standing Order/Template
  (kinds of record) AND "Square Online" (a provenance). A standing order can
  never also *have* a status, and every list filter special-cases the kinds.
- **Items lived in 20-slot repeating fields** until Aug 2021, capping an order
  at 20 lines and making the v1/v2 money-column split below necessary at all.
- **Payments were a calc field** (`Spent_c`) until 2022; rows exist only after.
- **The edit log is one text blob** — unqueryable, unpageable.
- **Email threading by subject kludge** — the inbound subject is stored
  (misnamed `Email_Token`) and pasted into replies so Mail.app threads them.
- **Totals are stored, twice** — `Order_Subtotal` vs `Order_Subtotal2` by
  "version number", with all the drift that implies.
- **Customer credit cards in plain fields** (`CC_Num`, `CC_Code`… filled on
  ~39 rows). Never migrating, same rule as SSN.

---

## Decisions (Mark, 2026-08-16 — do not relitigate)

### 1. Full migration, and the records evolve the way timesheets did

Customers, orders, items, payments and the parsed log all migrate. The app
changed shape over time — items moved from repeating fields to a child table in
Aug 2021, payments became rows in Mar 2022 — so older records are sparser, and
the transform reads each era's own fields (see Migration notes). Container
contents (signed quotes, pics, documents) do NOT migrate: a .mer cannot carry
them, and FMP stays available as the archive.

### 2. Square invoicing stays manual in v1; QBO is the accounting future

Today: the invoice is created on Square by hand, the customer pays there, a
human records invoice-sent / invoice-paid dates. v1 keeps exactly that, with
**seams, not integrations**: `special_order_payments.payment_type` keeps the
Square vocabulary (`square_invoice` is 1,188 of 1,190 real payments),
`external_ref` columns exist for a Square invoice id / QBO doc id from day one,
and money lives in derivable, per-line form (decision 6) so an exporter can be
added without schema surgery. The Invoices-module precedent exactly.

### 3. KIND and STATUS split into two columns

- `kind`: `order` | `template` | `standing_order`
- `status`: `lead` → `quote` → `invoice` → `order`, plus `cancelled`

The ladder is the workflow Mark described: lead (gathering info) → quote
(quote prepared/sent, awaiting signature) → invoice (Square invoice sent,
awaiting payment) → order (paid; only printing and scheduling remain).
Templates and standing orders simply have no status. FMP's junk values
("order" lowercase, `=="` , empty) normalize in the transform; "Square Online"
(6 rows) migrates as kind `order` with its provenance in `source_payload`.
This is the module's one deliberate model change, and it is the same move the
production brief made with plan-vs-schedule: two facts that shared a field get
their own columns.

### 4. The to-do stays a MANUAL field; the app only suggests

Mark: FMP does manual-with-quiet-suggestions today, he frequently overrides,
keep it. So: `todo` is a text column set through a `PickList` over the FMP
vocabulary (Respond to Email/Call, Send Quote, Send Invoice, Schedule
Delivery, Print Order, Send Receipt, Schedule Production, Post Event Followup,
Resolve Issue, Invoice Overdue!) with `allowNew` for the occasional freehand
("Adjust time to 9am or later" is real data). The app may render a quiet
derived hint ("invoice paid and unprinted — Print Order?") but NEVER writes
the column itself. Flagging an order = setting `flag_reason` (which colours
the row red and sets todo to Resolve Issue); resolving clears both.

### 5. Items are drag-sortable copies; `Misc` lines never reach the kitchen

A line is added from a **production-item chooser** (search all of
`production_items`, the Donut Chooser's job) which copies name, the taxonomy
tuple (donut/type/cut/finish/size), and a price onto the line — then every
field is editable in place, including the name ("Promise Ring - Glazed -
Letter"). `production_item_id` stays on the line as the link back. Reordering
is drag (`useColumnDrag`'s pointer-event reasons apply; FMP used a sort
number). **A line whose `item_type` is `Misc` is money, not production** —
Catering Platter, Delivery Fee — and is excluded from the kitchen document and
the production schedule (Mark's rule). Measured vocabulary: Raised 18,473 ·
Cake 597 · Misc 495 · Scrap 299 · Old Fashioned 63 · Mochi 54, plus junk
variants ("Misc- Cupcake liners") — the exclusion test is prefix-insensitive
(`Misc*`), and the transform normalizes the obvious spellings.

### 6. Money is DERIVED live; only the inputs are stored

FMP stored subtotal/tax/total (twice). We store the INPUTS — per-line qty ×
unit price × taxable flag, and per-order `tax_rate` (snapshotted from the
pickup location at creation, editable), `discount_amount` / `discount_rate`,
`delivery_charge`, `rush_fee`, `ignore_balance` — and derive subtotal, tax,
total, payments-to-date and balance due everywhere they're shown. Documents
snapshot nothing either: a quote PDF renders the order as it stands, and the
PDF the customer signed is FILED as an attachment, which is the immutable
copy. This is design rule "costing is derived live; snapshots only on
documents" applied to revenue. FMP's stored totals ride along in
`source_payload` and the transform REPORTS rows where lines don't reproduce
the stored total (era arithmetic, hand edits) rather than reconciling them.

### 7. Supervisor+ for the whole module, customers included

Mark: "supervisor and up should be able to handle special orders." RLS: ALL
FOUR VERBS supervisor+ (owner/admin/purchaser/supervisor) on `customers`,
`special_orders`, `special_order_items`, `special_order_payments`,
`special_order_events`. Read is gated too — customer names, addresses, phones
and emails are PII of the `employees` class (020's reasoning), and staff have
no screen that needs them; the kitchen sees the production schedule, not the
order. This is the SECOND write policy naming `supervisor` (the batch log was
first, 044). Deletes follow the EmployeeActions template: count the damage
(items, payments, documents, a linked production schedule), confirm, then
revoke-order-first semantics don't apply — but every delete `.select()`s its
own result (the standing lesson).

### 8. Location is where it's PICKED UP; kitchen is where it's MADE

Two nullable FKs on the order: `location_id` (pickup shop — FMP's `Location`
field, only filled on recent rows) and `kitchen_location_id` (FMP's `Kitchen`,
filled on 83%). Decision-9 shape from production. The delivery block's
pickup/delivery mode, times, windows, company, tracking etc. are ordinary
columns. **The screens are org-wide** — the list shows every location's orders
with kitchen/location as filter dimensions, exempt from
`InactiveLocationGate` the way `/employees` is: the phone rings wherever it
rings, and an order is made at one shop for pickup at another.

### 9. Scheduling production creates a REAL production schedule

"Schedule production" inserts one `production_schedules` row for (kitchen,
event date) with `source = 'special_order'`, `source_ref = order.id`, plus one
`production_schedule_items` row per non-Misc line — `item_id` from the line's
`production_item_id`, `item_name` from the line's CUSTOMIZED name (the
snapshot columns exist for exactly this), `par` = qty, `par_source =
'special_order'` (the value 040 shipped waiting for us). The night's packet
then includes it **by construction** — the tray guides and element sheets
already sum every schedule live in that kitchen that night. Unschedule =
delete that schedule (guarded if it carries actuals, 040's rule). The order
stores `production_schedule_id`; re-scheduling after edits replaces the lines
the way `p_replace` does, never silently.

Consequence of 040's schema (`item_id NOT NULL`): **a schedulable line must
link a production item.** The chooser flow always does (`menuItemKey_n` filled
on 99.8% of 20,605 real lines). A hand-typed non-Misc line with no link blocks
scheduling with a sentence naming the line — the fix is to attach the nearest
production item and keep the custom name, which is what the snapshot columns
are for. Do NOT widen `item_id` to nullable for this.

### 10. Inquiry parsing is a Claude extraction, `extract-invoice`'s shape
    (since decision 18, this is the FALLBACK lane — the primary door is our
    own public form, which creates the lead with no email in the loop)

The inquiry is a Square web form emailed to **specialorders@donutfriend.com**
(from `messenger@messaging.squareup.com`, subject "New Form Entry from {name}:
Special Order Inquiry") with fixed labeled fields — measured across the three
real samples: Full name, Email, Phone number, Occasion, Delivery or Pickup,
Address, Preferred Location, Time, Date, What are you interested in?, a
free-text description, Any allergies. "New order from inquiry" = paste the
email text into a dialog → a `parse-inquiry` edge function (Claude,
`json_schema` output_config, ANTHROPIC_API_KEY already a secret) returns the
fields → the app creates a `lead` and matches the customer by email then phone
(warn-never-block on near-matches, `findPossibleRehires`' rule; no match
creates one). The parse is a PROPOSAL — the create dialog shows every
extracted field editable before anything is written. A manual create path
skips the paste. The raw pasted text lands in `source_payload` so a bad parse
can be re-read later, and the SUBJECT line is kept for threading (decision 12).
The `extract-invoice` API traps apply verbatim: `content[0]` is a thinking
block, and `stop_reason: "refusal"` arrives as HTTP 200.

### 11. Documents are client-rendered PDFs matching the four references

Quote, invoice and receipt share one layout (the `PoPdf` idiom — masthead,
three header bands QUOTE/CUSTOMER/CONTACT, numbered item lines with qty ·
price · notes · cost, totals block): the quote adds the terms paragraph and
signature/date lines; the invoice adds the payments block and TOTAL DUE; the
receipt is the invoice marked paid. The kitchen **order document** is its own
renderer: kitchen / day-of-week / pickup-time header bands (time highlighted),
contact + event info, lines grouped by SIZE CLASS printing the customized name
over the full taxonomy line and the note, `*** END OF LIST ***`, then
order-taken-by / pickup-delivery / tracking / boxes / received-signature
bands, and the allergen warning. Reference PDFs for order 9885 are in the
screenshots folder — render ours against them in Node before calling any of
them done (the recipe-sheet verification pattern). Per-document note fields
(`notes_quote`, `notes_production`, `notes_invoice`, `notes_receipt`) print on
their document; `notes_general` prints nowhere.

### 12. Email goes through the provider layer, and threading is done RIGHT

Sending a quote/invoice/receipt is the PO compose card's flow: in-app compose,
prefilled to/subject/body, client-rendered PDF attached, sent via the
`send-po-email` provider layer. Special orders send **as
specialorders@donutfriend.com** — a second org-level provider config
(`orgs.settings.special_orders.email_provider`, falling back to the org
default), which needs its own Gmail OAuth at setup time (the info@ credential
cannot send as a different account). Replies thread properly: store the
inbound `Message-ID` and subject when an inquiry is parsed, and set
`In-Reply-To`/`References` + the original subject on outbound mail — which
retires the FMP subject-pasting kludge (`Email_Token` was the inbound subject,
Mark: "1000% certain there's a better way"). Sent mail lands in the
specialorders@ Sent folder via the Gmail API, so the mailbox stays the
paper trail. Stage dates stamp on send (quote_sent etc.), log entries write
themselves.

### 13. Standing orders MATERIALIZE THEMSELVES on a rolling horizon
    (Mark, 2026-08-16 — replacing FMP's manual Instantiate, which he forgets:
    "Sometimes I forget. I've often wondered if there was a better way.")

Standing orders are WHOLESALE production — Cafe Knotted takes 370 donuts M–Th
and 700 F–Su, expressed as two standing orders. A standing order (kind
`standing_order`) carries `standing_days smallint[]` (ISO weekdays — FMP's
MON…SUN checkboxes, `\v`-separated in the export), its own items, and three
new columns FMP never had: `starts_on`, `ends_on` (nullable — open-ended is
the normal case) and `paused`.

**Nobody instantiates, and there is no cron either.** A definer function
`ensure_standing_orders_materialized(p_through date)` tops up real orders for
every active, unpaused standing order through the horizon (14 days;
`orgs.settings.special_orders.horizon_days`, design rule 2), and it is called
from the two moments that need the orders to exist: **opening the special
orders list**, and **production schedule generation** (generating tomorrow
night's schedules first guarantees tomorrow's standing orders are real). The
moment anyone works, the horizon is full — there is no one whose job is
remembering, and no scheduled job to monitor.

Two rules keep it honest, both this app's own lessons:

- **Idempotent on `unique (standing_order_id, event_date)`, and an existing
  row — INCLUDING A CANCELLED ONE — blocks re-creation.** Cancelling
  Thanksgiving is a decision that sticks, not a row that resurrects on the
  next page load. Decision 6 of the production brief (never silently
  replace), in recurrence form. Consequence: a materialized day is CANCELLED,
  never deleted — deleting it would order the donuts again.
- **A materialized order is indistinguishable from a hand-made one**: kind
  `order`, status `order`, todo Print Order, items copied from the standing
  order, `standing_order_id` set, a log entry naming the source. Freely
  editable — "add 100 this Friday" is an edit to that Friday's order, never
  to the standing order. Editing the STANDING order changes only days not yet
  materialized, and the record says so.

**Instantiate survives only as a "materialize now…" escape hatch** (pick a
range — e.g. covering a one-off far beyond the horizon), running the same
function. The 10 live standing orders (Yeastie Boys ×7 one-per-weekday, LA
Cafe, Cafe Knotted M-Th and F-Su) migrate with `starts_on` null; **the
migration must materialize NOTHING** — the first horizon top-up happens in
the app, after Mark confirms the standing orders came over right, or cutover
day creates a week of wholesale orders before anyone has checked them.

Production's generation receipt names special orders for that night that
exist but are NOT yet scheduled — the closing supervisor's routine catches
the last manual step, which stays deliberately manual (scheduling production
is an explicit act, as everywhere else).

**Wholesale billing context** (Mark, 2026-08-16): Cafe Knotted is billed
WEEKLY for the previous week's orders — the per-day orders are production
and record-keeping, not each its own invoice. v1 changes nothing about that
workflow, but it is exactly what the QBO seam (decision 2) should anticipate:
a future "wholesale statement" is a rendering over one customer's orders for
a period, which the rows-not-blobs money model already supports. The
`ignore_balance` flag is how a per-day wholesale order stays out of the
unpaid/overdue filters meanwhile.

Templates are just kind `template`; Duplicate (any order → a new one, log
entry "Duplicated from Order N") covers starting from one.

### 14. Pics and Documents merge into one attachments card

Mark's call from the outset. One private bucket `special-order-attachments`
(own bucket: the audience is supervisor+, neither PO's nor HR's — 021's test),
018's four-policy org-folder pattern, `useAttachmentActions` +
`ui/DocumentChip` + drop zone reuse. Kinds: `signed_quote`, `picture`,
`document`. Filing a signed quote stamps `quote_returned` (offered, not
forced). No OCR of these in v1.

### 15. Numbering continues FMP's sequence from a round seed

`special_order_number_seq` seeded at **10000** (live max is 9887; the
batch-log 30000 idiom), `next_special_order_number()` definer. FMP's number
migrates as both the order number and `legacy_id`; the export carries 5
duplicated OrderIDs (2899 ×3, 3932/5542/6002 ×2) so `legacy_id` is NOT unique
— the natural key gets an occurrence ordinal, 028's `source_row_key` lesson.

### 16. The edit log becomes rows, and the app keeps writing it

`special_order_events`: order_id, happened_at, author (text — FMP usernames
like `tracit`/`df02` don't map to app users), message, `source`
(filemaker | app | manual). The transform parses `History_Notes` — entries are
`\v`-separated, each `M/D/YYYY H:MM:SS PM [user]: message`, reverse-
chronological, 5,890+ orders carry one. The app appends on every meaningful
act (status change, send, payment, schedule, duplicate, flag) and offers Add
entry for freehand notes. Display newest-first on the Info tab.

### 17. The customer approves the quote on a PUBLIC TOKENIZED PAGE
    (Mark, 2026-08-16: print/sign/scan/return "is difficult for a lot of
    people and I'd like to implement something slicker/easier.")

The quote email carries a link — `/q/{token}` — where the customer reviews
the quote on their phone (the PDF's content: lines, totals, the terms
paragraph), types their name, checks "I agree to the terms above", and taps
Approve. The app stamps `quote_returned`, files a **signed-quote PDF** (the
quote plus an approval block: name as typed, timestamp, token identity) as a
`signed_quote` attachment — the same artifact the scan flow produced — writes
the log entry, and emails confirmation both ways. Typed-name clickwrap, not a
drawn signature: legally equivalent under ESIGN/UETA for this class of
agreement and far easier on a phone; a signature pad is later theater if
customers expect it.

The rules that make it sound:

- **Approval binds to a SNAPSHOT, not the live order.** Money is derived
  live (decision 6), so the order can change after a quote goes out. The
  token is minted at SEND time, bound to the exact rendered document (the
  compose card already holds the blob — file it in the bucket, reference it
  from the token row). Approving signs THAT. Re-sending after edits mints a
  new token and SUPERSEDES the old, whose link then says "this quote has
  been revised — check your email." A token is spent by approval.
- **A public route in an auth-gated app is a deliberate act.** `proxy.ts`
  exempts `/q` the way it exempts `/welcome`. Data flows through two definer
  RPCs — `quote_by_token`, `approve_quote_by_token` — DELIBERATELY granted
  to `anon` (inverting 002's revoke rule, on purpose, in exactly two
  places), whose bodies check nothing but the token: a 128-bit capability
  URL, the same trust class as a signed storage URL. The page shows only
  what the paper quote shows, and nothing else in the schema is reachable
  from it.
- **The manual path survives.** A customer who still prints and signs, or
  replies "approved" by email, is handled exactly as today: file the
  attachment, hand-stamp `quote_returned`. The link is the fast lane, not
  the only lane.
- **No payment chaining in v1** — the approval page ends at "your invoice
  will follow by email"; Square invoicing stays decision 2's manual flow.
  No customer accounts, no portal beyond this one page. (Decision 20 names
  approve-and-pay as the FIRST post-v1 feature — nothing in v1 may make it
  harder.)

### 18. The inquiry form is OURS; the email layer disappears
    (Mark, 2026-08-16: "direct the customer to our own form so that there's
    no email layer — it's just a direct form entry that creates a special
    order Lead record.")

A public form at **`/inquiry`** (proxy-exempt, mobile-first) replaces the
Square web form as the front door. The donutfriend.com Square site's Special
Orders button links to it; an iframe embed is a cosmetic option if the Square
plan allows, and the form must stand alone regardless. Fields mirror the
Square form's (the measured list in decision 10) so customers see continuity:
name, email, phone, occasion, pickup/delivery, address, preferred location,
date, time, what they're interested in, description, allergies.

Submitting creates a **lead directly** — no email, no parsing: a definer
`create_inquiry(...)` granted to `anon` (the third and last deliberate anon
grant, beside decision 17's two), whose body validates hard, inserts the
lead with todo "Respond to Email/Call", matches-or-creates the customer by
email then phone INTERNALLY, and returns nothing but ok — an anon caller
must not be able to learn whether an email address is a customer. Abuse is
handled proportionately: a honeypot field, per-IP rate limiting in the
route, server-side validation — leads are cheap and a supervisor triages
them anyway; no CAPTCHA.

**The customer can BUILD the order, not just describe it** (Mark,
2026-08-16: "we could allow the customer to really build an order
themselves rather than just 'describe' it"). An OPTIONAL "build your box"
section beside the free-text description — never instead of it, because
custom work is the module's soul and no picker expresses "spell WERE
PREGNANT! in letter donuts". The customer browses the offerable menu with
prices from the grid, steppers, a note per item, and a running total
**labelled ESTIMATE** ("your quote may differ — custom work, delivery and
rush fees are quoted by a human"). Submission still creates a LEAD; the
picked lines land as real `special_order_items` (log entry: "items proposed
by customer"), so the supervisor edits a draft instead of transcribing
prose. Two guardrails: **what is offerable is a curated flag on
`production_items`** (`show_on_inquiry_form`, default FALSE — the catalog
holds Scrap and test items, so opting in is the safe direction and Mark
ticks the menu once), served through a definer RPC returning only name /
size / price — never the taxonomy, costs or anything else; and the page
never promises a confirmed order — the QUOTE remains the offer, decision
17's page remains where it's accepted.

The app then sends "We received your inquiry" from specialorders@ — which
both verifies the address is real and **establishes the email thread from a
message WE authored** (its Message-ID becomes the thread root decision 12
replies to). The form shows decision 22's cutoff notice ("orders need two
business days; closer dates incur a rush fee") but never blocks a date.

**Decision 10's paste-and-parse survives as the fallback** — organic emails
to specialorders@ will never stop, and the parser is how they become leads.
The Square form is retired once this is live.

### 19. The list carries a DERIVED "needs attention" queue

The module knows every stalled order and now says so: a quote sent N days
ago with no answer, an event inside X days still unpaid, a paid order for
tomorrow nobody printed or scheduled, a delivery order with no delivery
scheduled, yesterday's event awaiting its post-event follow-up. A tier on
the list ("Needs attention · 12", the cleanup queue's shape) where **each
order names its reason in words** — never a bare count. Pure derivation
over existing columns (`needsAttention(order)` in `lib/specialOrders`,
fixture-tested, thresholds in `orgs.settings.special_orders` per design
rule 2); the manual todo always OVERRIDES the derived reason on display,
decision 4's rule extended. Nothing is stored, so nothing can go stale.

### 20. Approve-and-pay is the FIRST post-v1 feature, named now

The two highest-friction customer steps are signing and paying; decision 17
fixes the first, and its natural completion is the approval page ending at
a Square payment link — collecting the money at the moment the customer is
most willing. NOT BUILT in v1 (it needs the Square API: programmatic
invoice/payment-link creation), but it is the reason decision 2's
`external_ref` seam exists, and the acceptance test for v1 is that adding
it later touches the approval page and an edge function — no schema
surgery, no rework of the money model.

### 21. Weekly wholesale statements are one command

Mark bills Cafe Knotted every week for the previous week's orders, by hand.
A **Statement…** command on the customer record: pick a date range
(defaulting to last week), render a statement PDF over that customer's
orders in the range — a rendering over rows, the recipe-sheet/PoPdf idiom,
no new tables — and hand it to the compose card addressed to the customer.
Nothing auto-sends; the command makes the weekly chore one tap. This is
also the dry run for the QBO era: the statement's line grain is exactly
what an accounting export will want.

### 22. The rush fee suggests itself
    (measured: the terms promise "$25 or 30%, whichever is greater" inside
    two business days — and only 795 of 5,198 v1 orders carry ANY rush fee)

`businessDaysUntil(event_date)` and `suggestedRushFee(order)` in
`lib/specialOrders` (fixture-tested; the terms' parameters live in
`orgs.settings.special_orders`, design rule 2). When an order is created or
quoted inside the cutoff, the rush-fee cell offers the computed figure with
the receiving screen's `→` idiom — **a suggestion you tap, never an
automatic write**, and dismissible like every other offer. The public form
(decision 18) shows the cutoff as a notice. The point is that the terms the
quote PDF prints become true in the data.

---

## The data model (sketch — migrations get designed at build time)

```
customers
  id, org_id, legacy_id (FMP CustomerID, unique per org)
  first_name, last_name, company, phone, email
  address jsonb        -- street/street2/city/state/zip + formatted, locations' idiom
  notes, created_at/by, updated_at/by
  -- NO cc fields, ever. Balance/spent/order-count are DERIVED, never columns.

special_orders
  id, org_id, number (int, unique per org), legacy_id
  kind        order | template | standing_order
  status      lead | quote | invoice | order | cancelled   (null when kind ≠ order? NO —
              templates/standing orders simply ignore it; keep NOT NULL default lead,
              decide at migration design)
  todo text, flag_reason text
  customer_id FK, contact_* (day-of name/phone/email), allergen_info
  title (FMP Event_Description), event_date date, event_time, ready_by_time
  location_id FK (pickup shop), kitchen_location_id FK
  fulfillment  pickup | delivery
  delivery_*   (address, distance, cost, charge, window_start/end, company,
                company_phone, tracking, boxes, weight)
  tax_rate numeric, discount_amount, discount_rate, delivery_charge, rush_fee,
  ignore_balance bool
  taken_by text
  notes_general, notes_quote, notes_production, notes_invoice, notes_receipt
  standing_days smallint[]  -- ISO, 1=Mon; the 017/009 seven-slot guard idiom does
                            -- NOT apply (this is a set, not a per-weekday array)
  starts_on date, ends_on date, paused bool     -- standing orders only
  standing_order_id uuid FK null                -- which standing order made me
  -- unique (standing_order_id, event_date) where standing_order_id is not null
  -- — the materializer's idempotency key; a cancelled day still occupies it
  date_initiated, quote_sent_at, quote_returned_at, invoice_sent_at,
  invoice_paid_at, receipt_sent_at, delivery_scheduled_at, order_printed_at,
  order_scheduled_at        -- dates, hand-editable like PO detail's
  production_schedule_id uuid FK null
  inbound_subject text, inbound_message_id text
  external_ref jsonb        -- the Square/QBO seam (decision 2)
  source (filemaker|app), source_payload jsonb

special_order_items
  id, org_id, order_id FK cascade, sort integer
  production_item_id FK null (on delete set null)
  name, item_donut, item_type, item_cut, item_finish, item_size   -- all editable text
  notes, qty numeric, unit_price numeric, taxable bool
  legacy_key (FMP _PrimaryKey or repeating-slot ordinal)

special_order_payments
  id, org_id, order_id FK cascade
  paid_on date, amount numeric, payment_type text, note text
  external_ref text, legacy_key

special_order_events
  id, org_id, order_id FK cascade
  happened_at timestamptz, author text, message text, source

special_order_quote_tokens                       -- decision 17
  id, org_id, order_id FK cascade
  token text unique          -- 128-bit random, the whole capability
  document_path text         -- the exact PDF sent, filed in the bucket
  created_at/by, superseded_at
  approved_at, approved_name, approved_meta jsonb (ip, user_agent)
```

RLS: supervisor+ on every verb, every table (decision 7). Every insert passes
`org_id` explicitly (design rule 1's hard-won lesson). Sequence + definer
function per 006. Indexes: orders by (org, event_date), (org, status),
(org, kind); items by order; events by (order, happened_at desc);
payments by order; customers by (org, lower(email)), (org, phone) for match.

Derived-money helpers live in `lib/specialOrders.ts` (pure, fixture-tested):
line extended = qty × price; subtotal; tax = taxable subtotal × rate; total =
subtotal − discount + delivery + rush + tax; balance = total − Σpayments;
`suggestedTodo(order)` for the quiet hint; `needsAttention(order)` (decision
19); `businessDaysUntil` / `suggestedRushFee` (decision 22);
`standingMaterializationDates(range, days)` (string dates, never
`new Date("…")` — the plans lesson). The
materializer itself is SQL (`ensure_standing_orders_materialized`, definer,
supervisor+-checked in its body) because both callers — the list's server
component and production generation — need one implementation that cannot
drift, 013's one-rule-two-callers precedent.

---

## Screens (existing conventions, named)

**`/special-orders`** — org-wide list, `DataTable` grouped by EVENT DATE
(black `DataGroup` bands, "SUN, AUG 16" + count), default view = upcoming
(event_date ≥ today, status ≠ cancelled, kind = order), sorted date then
time. `FilterMenus` dimensions: view (upcoming / unpaid / overdue / tomorrow /
past / all), status, kind (templates and standing orders reachable HERE, as
FMP's saved finds), kitchen, location, to-do; search over number / customer /
company / title. State in the URL (`urlFilterParams`, sort included), rows
publish the record set, `withFrom` breadcrumbs. Columns: todo · kitchen ·
number · status · date · time · customer · title · total (derived) · the
stage-date grid (quote sent/returned, invoice sent/paid, delivery scheduled,
order scheduled/printed). Stage cells: date when done; **red** when overdue
(the stage the derived pipeline says is blocking and the event is near/past);
**yellow** for waiting-on-customer (FMP's green — colour here is record
state, and this app's "worth your eye" mark is yellow, not green). Cancelled
rows grey + struck. A standing-order row shows its weekday set where dates
would be.

**`/special-orders/[id]`** — `ui/SectionNav` tabs (the employee record
pattern, tab in the URL): **Info** (details dl, customer block with link +
inline contact fields, completion dates dl of editable `kind="date"` cells,
Other orders that day, the log), **Items** (drag-sortable lines table, chooser
panel Add item — AddPoLines' stays-open shape, per-line editable cells,
payments card, totals card with derived figures), **Delivery**, **Documents**
(attachments card + drop zone, pics merged in), and the standing-order /
template variants suppress what doesn't apply. Commands in the page flow /
RowMenu: Duplicate, Instantiate (standing only), Schedule production /
Unschedule, Flag / Resolve, Take payment, Delete (confirm names damage),
Preview/email quote · invoice · receipt · order doc. `key={id}` shell,
`loading.tsx`, breadcrumbs, RecordNav via the published set.

**`/customers`** + **`/customers/[id]`** — the locations-list pattern: list
(search, company filter) and a record showing details (inline-editable) plus
that customer's orders (unpaid band first, FMP's split) with New order from
here. Warn on near-duplicate at create; a Merge tool is DEFERRED (FMP's
Remove Duplicates button exists, but our precedent is warn-and-let-through
first, tooling when the pile hurts).

Nav: a new tier-1 section is overkill; Mark places it at build time — likely
Operations > Special Orders + Customers as tier-2 subs (one `lib/nav.ts`
edit either way).

---

## Migration notes

### Exports (all fresh 2026-08-16, in `FMP Export/Special Orders/`)

| File | Rows | Notes |
| --- | --- | --- |
| SpecialOrders.mer | 8,334 (one malformed row of width 106 — skip and report) | 117 cols; OrderID 1001–9887, created 2014-04-20 → 2026-08-13; 27 future events |
| OrderItems.mer | 20,605 | real child rows, Aug 2021+ |
| OrderPayments.mer | 1,190 | Mar 2022+; PaymentType: Square Invoice 1,188 · Square Online 1 · comp 1 |
| Customers.mer | 5,874 | CustomerID unique; CC_* fields on ≤39 rows — NEVER read them |

The first SpecialOrders export (same filename, 2026-08-16 20:26) was from a
stale server copy — max OrderID 9108, nothing created after 2025-01-11, the
`Location` column empty everywhere. **If a re-export is ever needed again,
check `max(OrderID)` against the live layout before trusting it.**

### The two eras (measured)

`VersionNumber_n = "2"` marks the Aug-2021 rebuild. 5,198 v1 rows / 3,136 v2.

- **Items**: v1 keeps them in 20-slot ␝-separated repeating fields
  (`Item_Desc/QTY/Price/Cost/Notes/Taxed`, GS = 0x1D; 5,068 of 5,198 have
  content); v2 in OrderItems rows (3,100 of 3,136). Only 35 v1 orders ALSO
  have OrderItems rows — **OrderItems wins where present**, repeats otherwise.
  165 orders have neither (empty leads/cancelled). `Item_Taxed` slot text
  "Plus Tax" → taxable true.
- **Money**: v1 reads `Order_Subtotal/Tax/Total`, v2 the `*2` columns. Both
  land only in `source_payload` (decision 6); the transform diffs derived
  totals against them and REPORTS, expecting era noise.
- **Payments**: rows only since 2022. 6,430 orders carry a nonzero `Spent_c`;
  5,267 of them have NO payment rows → synthesize ONE payment (`paid_on` =
  invoice-paid date, else event date; type `legacy`; note "FMP paid total")
  so the unpaid/overdue filters stay honest over history. 1,085 orders have
  rows that DISAGREE with `Spent_c` — rows win, `Spent_c` rides in
  `source_payload`, each named in the report.

### Traps already identified

- **`\v` (0x0B) is the in-field return** — standing days ("MON\vTUE\vWED\vTHU"
  → ISO array), History_Notes entries, and stray multi-value cells
  (`Order_IgnoreBalance` "0\v1"). ␝ (0x1D) separates repeating slots.
- **OrderNumber joins are TEXT by order NUMBER, not id** — OrderItems
  (`orderNumber_n`) and OrderPayments (`OrderNumber_t`). With 5 duplicated
  OrderIDs in the parent, joined children attach to EVERY copy — resolve
  dupes first (keep the row with the later Record_Modified; report), then
  join.
- **Junk vocabulary**: `Order_Type` "order"/`=="` /empty; todo "OH HOLD",
  "*"; Kitchen "Unspecified" (15) + blank (1,391) → null; one DF03 row
  (real location, fine). Event dates 1986/2004 (2 rows) migrate as-is —
  they're visible, editable history, not load failures.
- **`Location` is filled only on 187 recent rows** — the field is new in FMP.
  Null pickup location on history is honest; don't infer it from Kitchen.
- **Customer links**: 8,258 of 8,334 resolve; 75 blank + 1 orphaned id →
  orders with NO customer (nullable FK, rendered as em dash), reported.
- **Customer name casing/whitespace is wild** (53 spellings of the staff in
  `OrderTakenBy` alone — migrate that column verbatim as text; it's history,
  not a FK).
- Repeating-field slots can be RAGGED (a price with no desc) — a slot
  materializes iff ANY of desc/qty/price/notes is non-empty.
- The transform mirrors the purchasing pipeline: `transform-special-orders.mjs`
  → JSON outside the repo → `load-special-orders.mjs` (service_role), field
  ALLOW-LIST (the CC columns and g-fields are never read), idempotent on
  `legacy_id`+occurrence, `--wipe` for reload, sanity counts printed and
  compared.

---

## Build phases (suggested, in dependency order)

1. ✅ **Schema + migration** — migration `051_special_orders.sql` (six tables +
   attachments + the quote-token table, the number sequence seeded at 10000,
   supervisor+ RLS on all four verbs of every table, the private
   `special-order-attachments` bucket with 018's four-policy pattern,
   `production_items.show_on_inquiry_form`, and the module's settings).
   `migration/transform-special-orders.mjs` → `load-special-orders.mjs`, dry-run
   clean: **8,330 orders · 47,827 lines · 6,457 payments (5,267 synthesized) ·
   106,471 log entries · 5,874 customers**.
   **NOT YET APPLIED, and NOT YET REPLAYED ON THE HARNESS** — Docker Desktop was
   waiting on an admin-password dialog that a non-interactive session cannot
   answer. Do the harness replay (as a real supervisor AND a staffer, the 044
   pattern) before this goes near production.
2. ✅ **List + record.** `lib/specialOrders.ts` (derived money, needs-attention,
   business days, rush fee, recurrence, the stage grid, the tabs) with **56
   fixtures, each rule checked by breaking it**; `/special-orders` with six
   combining `FilterMenus`, event-date bands, the stage grid and the
   needs-attention tier; `/special-orders/[id]` with `ui/SectionNav` tabs
   Info/Items/Delivery/Documents, drag-sortable lines, the priced donut chooser,
   the derived totals card, payments, the log, and Duplicate/Flag/Cancel/Delete;
   `/customers` + `/customers/[id]` with the unpaid-first split.
   The Documents tab is a placeholder until phase 3 gives it something to file.
3. ✅ **Documents + email.** `lib/specialOrderDocs.ts` (the document data, the
   dates, the size-class grouping, the email templates) +
   `lib/specialOrderSend.ts` (the token, the snapshot, the send) with **24
   fixtures, each rule checked by breaking it**;
   `components/specialOrders/pdf/SpecialOrderPdfs.tsx` — quote · invoice ·
   receipt from ONE renderer, the kitchen order from a second, the statement
   from a third; the compose card (`SendDocument`); the attachments card
   (`OrderDocuments`, decision 14); `send-special-order-email` +
   `approve-quote` edge functions over a shared provider layer;
   migration **052** and `/q/{token}`; the statement command on the customer
   record.

   **VERIFIED BY RENDERING, over the real 9885 rows, against FileMaker's own
   four PDFs** — the recipe-sheet pattern, and the acceptance test this phase
   was given. It reproduces the money to the cent ($147.40 / $14.37 /
   $161.77), and it found four things reading could not:

   · **the transform was eating the letter-cake notes.** `text()` stripped a
     wrapping pair of double quotes, written for `Delivery_Company`
     (`"DeliverLA"`, 357 rows) — and the note on a letter order IS `"W"`, the
     letter being iced onto the donut. FileMaker prints `"W"`; ours printed
     `W`. Fixed in the transform and restored by
     `migration/backfill-special-order-notes.mjs`, which **has run**: 4,617
     line notes and 384 orders, idempotent (a second run wrote 0).
   · **the masthead printed the date twice** — Mark's titles routinely END
     with the date ("Pregnanacy Revela 8/16/2026"), which is why FileMaker
     prints the title alone there.
   · **@react-pdf hyphenates by default**, breaking a real customer's address
     into `alexlan-dayan@gmail.com`.
   · **a `fixed` table header repeats onto a page holding only the totals**,
     printing an empty ITEM/QTY/PRICE row above the TOTALS band.

   **One deliberate deviation from the reference and one disagreement with
   it.** FileMaker prints the quote's terms and signature lines at the foot of
   page ONE, above two dozen items and two pages before the total; ours prints
   them after the totals, because nobody signs a figure they have not reached.
   And the reference invoice says TOTAL DUE **$0.00** on an unpaid $161.77
   quote — that is the stored-total drift decision 6 exists to end, and ours
   derives $161.77.

   **052 IS APPLIED and all three functions are DEPLOYED** (2026-08-17), and
   each was smoke-tested against the live project: an empty body is refused by
   name from every one of them (which also proves the shared provider layer
   bundled into all three), `approve-quote` reaches the SQL gate through the
   anon key — `unknown` for a bogus token, `name_required` for an empty name —
   and `send-special-order-email` answers 401 to an anonymous caller.
   **The specialorders@ credential is SET UP** (Mark, 2026-08-19, Path A) and
   **the whole loop has been walked on real customers** — see the residue on
   order #9877 recorded in CLAUDE.md. Phase 3 is CLOSED.

   Five things this phase learned the hard way, all fixed, all worth not
   rediscovering:
   · a Google refresh token pasted with a trailing newline made the whole
     credential unparseable and reported it as `Bad control character in string
     literal in JSON at position 262` — position 262 is the tail of the refresh
     token in a Google credential set, which is how it was found. `readCreds`
     in `_shared/email.ts` strips control characters now.
   · the approval link was built from `window.location.origin`, so a quote
     composed on a dev server carried a **localhost** link. It reads
     `NEXT_PUBLIC_APP_URL` now, the compose card refuses to open without a
     usable one, and the send re-checks the origin against the `APP_URL` secret.
   · `/q/` needs the app DEPLOYED, not just the env var — the route and its
     `proxy.ts` exemption ship together, and a link pointing at a deployment
     that predates them just 307s to /login.
   · the documents printed the BILLING address after a correct mailbox setup,
     because they read `special_orders.reply_to` while the setup writes
     `email_provider.reply_to`. They read both now, explicit first.
   · **`_shared/email.ts` is compiled into each function at DEPLOY time**, so
     editing it means redeploying all three — `send-po-email` included.
4. **The front door.** Split into three on Mark's call (2026-08-20), because
   the form's value is complete without the picker — the Square form it
   replaces has no picker either.

   **4a ✅ BUILT AND LIVE — 057 applied and `submit-inquiry` deployed by Mark
   2026-08-21, then walked end to end** (see the walk's record below).
   Migration **058 NEEDS APPLYING** — the auto-flag. Migration **057**
   (`create_inquiry` + `inquiry_shops`, both granted `anon`;
   `customers.source` gains `'inquiry'`; `locations.public_name`; the throttle
   index; the form's settings), the **`submit-inquiry`** edge function,
   `lib/inquiry.ts` + **28 fixtures**, `/inquiry` + its `proxy.ts` exemption,
   `NEXT_PUBLIC_ORG_ID`, and a `Message-ID` field on the shared mail layer.
   See "Where a next session picks up" for exactly what Mark still has to run.

   **4b — the build-your-box picker** and the `show_on_inquiry_form` curation
   UI. Not built.

   **4c — the fallback lane**: the `parse-inquiry` edge function and paste
   dialog (decision 10), fixtures from the three real emails. Not built.

   The Square form retires when 4a is live.
5. **Production + recurrence.** Schedule/unschedule against 040's seam
   (verify the packet picks the lines up — it should, by construction); the
   standing-order materializer (verified idempotent on the harness: two
   calls one row, a cancelled day stays cancelled, a paused order makes
   nothing) wired into the list and into generation, with the "materialize
   now…" escape hatch; Duplicate; templates. Flag/resolve. Take payment.

Each phase ships usable; nothing later blocks earlier.

---

## Where a next session picks up (2026-08-20, after 4a)

**057 AND 058 ARE APPLIED AND `submit-inquiry` IS DEPLOYED** (Mark, 2026-08-21).

**REDEPLOY `submit-inquiry`** — the confirmation template moved from
`special_orders.inquiry_email` to `special_orders.email.inquiry`, beside the
other five, so one settings screen covers every message the module sends. Until
it is redeployed the function reads the old key, which nobody ever set, so both
paths fall back to the same built-in text and nothing breaks meanwhile — but
editing that template on `/settings` will appear to do nothing.

**The settings have a screen**: `/settings` edits the six email templates, the
inquiry form's two paragraphs, the terms and invoice footer, the timing numbers,
and states the mailbox read-only. Owner/admin. Clearing a box restores the
built-in default, which is why each placeholder IS the default.
`locations.public_name` is on the location record.

**Still to run: migration 058**, the auto-flag. Its tail block carries the
probes; the one that matters is `select count(*) from pg_proc where proname =
'create_inquiry'` returning **ONE**, because two would mean the argument list
drifted and 057's version is still live beside it.

`NEXT_PUBLIC_ORG_ID` is in `web/.env.local` (`5803adf6-…`); **it also has to go
into Vercel** before the form works on the deployment, and Next inlines it at
BUILD time, so it needs a redeploy rather than a reload.

Redeploying `send-po-email`, `send-special-order-email` and `approve-quote` is
**hygiene, not a requirement**: `_shared/email.ts` gained an OPTIONAL
`messageId` and none of them passes it. Verified by rendering both providers in
Node — with no `messageId` the Gmail MIME carries no `Message-ID` header and
Resend's `headers` object is `undefined`, exactly as before.

### The end-to-end walk (2026-08-21)

Submitted through the real form on the real deployment's database, and every
leg landed:

· the lead is **#10013** — kind order / status lead / todo "Respond to
  Email/Call", title from the occasion, DF01 pickup, **tax 0.09750 snapshotted
  from the shop**, `date_initiated` the org's own 2026-08-21, `created_by` null.
· **`delivery_address` is null on a pickup that supplied an address** — the
  measured rule, holding on real data.
· **the customer MATCHED rather than duplicating**: `trombino@mac.com` already
  belonged to a FileMaker customer, so no second row was made, and the answer
  was byte-identical to a create. `contact_name` is who typed the form while
  the customer record is who the order belongs to — `contactFrom`'s per-field
  seeding, visibly working.
· the confirmation sent, and **`inbound_message_id` holds the exact Message-ID
  we generated** — the thread root recorded.
· then a QUOTE was emailed from the app: `gmail 1a024e939b919e00`,
  `quote_sent_at` stamped, the PDF filed as `quote_document`, a token minted
  with its snapshot, and **`inbound_message_id` unchanged**, so it went out
  `In-Reply-To` the confirmation. `threadHeaders` resolves that stored value to
  itself with no double-bracketing, checked against the real string.

The one leg no probe can settle is what the mailbox does with it — that is a
look, not an assertion.

## Where phase 3 left things (2026-08-20)

**Work on `main`.** The `special-orders` branch is fully merged and Mark has
asked for no more forking — commit and push to `main`, which is what Vercel
deploys.

**What is live and should not be re-derived:** migrations 051 and 052; the
three edge functions; the specialorders@ mailbox; `/q/{token}`;
`NEXT_PUBLIC_APP_URL` in `web/.env.local` and in Vercel. Phase 3's own
acceptance test — rendering the documents in Node against FileMaker's PDFs for
order 9885 — is worth repeating if the renderers change, and the recipe is the
`PoPdf` idiom: a tsc slice, a service_role read, and a `node_modules/@` symlink
at `.verify-build/src` so `@/` resolves. That harness is deliberately NOT
committed.

**Phase 4 starts from a real gap, not a blank page.** `special_orders.source`
already accepts `'inquiry'`, `inbound_message_id` / `inbound_subject` are
columns the send already threads on, and `production_items.show_on_inquiry_form`
exists and is FALSE on all 307 items — so the curation UI has to come with the
form, or the picker offers nothing.

**Two things phase 4 should reuse rather than rebuild:**
· `lib/customerSearch` + `CustomerPicker` — the inquiry form creates a lead
  with a customer, and `create_inquiry`'s "never reveal whether an email is a
  known customer" rule is about the ANON path only; the staff-facing paste
  dialog can use the picker as it stands.
· `lib/createSpecialOrder` — one creator, and it already handles a customer
  that does not exist yet. A third door (the inquiry) should go through it
  rather than write its own insert, which is exactly how the first two drifted.

**Known and deliberately not done:**
· `orgs.settings.special_orders.document_phone` is unset, so documents print
  the billing phone `(213) 908-2743` where FileMaker's print `213 995 6191`.
  One line of SQL in `docs/po-email-setup.md`; Mark has not asked for it.
· The statement command is built and has never been run against a real Cafe
  Knotted week — decision 21's own acceptance test is still owed, and needs
  wholesale orders to exist, which is phase 5's materializer.
· Order #9877 carries three quote tokens and #10000 is a test order. Both are
  Mark's, both are evidence, and neither should be tidied away.

---

## Phase 4a — what it learned (2026-08-20)

Six things, each of which the obvious implementation gets wrong.

**`create_inquiry` CANNOT CALL `next_special_order_number`.** 051 revokes that
from `anon` by name and its body demands supervisor+, so an anon caller gets
"permission denied for function" — migration 014's footgun in a new costume: a
definer that re-checks `user_org_ids()` is unreachable from a caller with no
`auth.uid()`. It advances the sequence itself. **Verified as `anon` on the
harness**, where that call is refused and `create_inquiry` still numbers an
order.

**`lib/createSpecialOrder` COULD NOT BE THE THIRD DOOR**, which this brief's own
handoff had hoped. It takes the CALLER's Supabase client so RLS applies, and
`anon` has no policy on `special_orders`, `customers` or `special_order_items`;
a Deno function cannot import from `web/` either. So the lead's defaults are
restated once in SQL, and that duplication is argued in 057's header. **4c's
staff-facing paste dialog still goes through `createSpecialOrder`** — that is
the door the note actually meant.

**`sendMail` RETURNS A PROVIDER ID, NOT A `Message-ID`.** `gmail 19f9…` is the
Gmail message *resource* id. Storing it as the thread root produces something no
client will ever match, and **the failure is silent** — replies just start new
conversations forever. So `Mail` gained an optional `messageId` the CALLER
generates, emits and stores. Rendered in Node against both providers: the header
carries exactly the string we generated, its domain matches the sender, and with
the field omitted **no header is emitted at all**, which is what makes the other
three functions' stale copies harmless.

**`customers.source` HAD NO `'inquiry'` VALUE** even though `special_orders.source`
did — 051 wrote the two checks differently. Widened in 057.

**AN ADDRESS IS NOT EVIDENCE OF DELIVERY.** Measured over the three real Square
submissions: two are PICKUPS that carry an address anyway (the form asked
regardless) and the third omits the field entirely. Writing it to
`delivery_address` unconditionally would print a customer's home address on a
kitchen document for an order they are collecting themselves. **Checked by
breaking it** on the harness, where a pickup came out carrying the address.
Note all three samples are pickups, so **there is no delivery sample** — worth
knowing when 4c's parser is written.

**THE PRIVACY RULE HAS TO SURVIVE INTO THE UI.** 057 answers `received` for a
throttled duplicate and for a swallowed honeypot, and `created` for a success —
and `inquiryStateMessage` words the first two IDENTICALLY to the third. A page
that distinguished them would undo in the UI exactly what the migration is
careful about in SQL. Broken on purpose in both places: in SQL the two answers
diverge visibly, and in TS a fixture goes red.

Smaller, and each cost a measurement: the empty-date fix lives in
`ui/DateField`, so the form uses it (`variant="field"`, `PickList`'s own prop
name for the same dense-cell-vs-form-box problem) rather than a raw
`<input type="date">` — Safari paints TODAY into an empty one, and on a form
whose date starts empty that means submitting no date while believing you asked
for today. `ui/TimeField` took the same variant because its own header already
argued the pair must wear one dress. The two native `<select>`s ARE deliberate
and are noted in the file: that rule is about the desk, and on a phone the
platform's wheel picker beats a portalled panel.

## What NOT to build (settled during design)

- **Square API / webhooks** — the invoice is made on Square by hand, v1
  records dates. Seam only; approve-and-pay (decision 20) is the named
  first use of it, post-v1.
- **QBO sync** — future; the `external_ref` columns and rows-not-blobs money
  are the preparation.
- **A customer portal** — no accounts, no order history, no payment page.
  The customer-facing surface is exactly TWO pages, each doing one thing:
  the inquiry form (decision 18, open) and the quote-approval page
  (decision 17, a capability URL). Anything more is a portal, and a portal
  is not this module.
- **Delivery-carrier integration** — DeliverLA request/schedule stay links or
  manual; distance stays a hand-entered pair (FMP's Google link can survive
  as a plain href).
- **A cron for standing orders** — materialization is on-demand from the two
  places that need it (decision 13); a scheduled job would be a third
  implementation to monitor.
- **Weekly wholesale statements** — Cafe Knotted's weekly bill stays a manual
  act in v1; the statement is a QBO-era rendering the money model already
  supports (decision 13).
- **A MenuItems successor** — production items + the price grid are the
  catalog; special-order line prices are typed/edited per line.
- **Customer merge tooling** — warn on create now, merge tool when the pile
  hurts.
- **A "special orders calendar"** — the FMP file's FCCalendar addon was
  abandoned plumbing; the date-grouped list IS the calendar for now.

---

## Open questions (small; ask before building that piece)

1. **Staff read access**: decision 7 gates READ to supervisor+. If a staff
   screen ever needs "today's pickups" without PII, that's a definer function
   naming safe columns (`production_operators()` pattern), not a loosened
   policy.
2. **The `status` column on templates/standing orders** — NOT NULL with a
   default, or nullable? Decide at migration design; the check constraint
   should make kind/status combinations legal-by-construction either way.
3. ~~**specialorders@ Gmail OAuth**~~ — DONE (Mark, 2026-08-19, Path A of
   `docs/po-email-setup.md`: its own OAuth refresh token in
   `EMAIL_CREDS_SPECIALORDERS`). Quotes go out as specialorders@ and land in
   that mailbox's Sent folder. The trap it was worth naming stayed true and
   was never hit: Gmail does not refuse a `From` it is not authorized for, it
   silently REWRITES it, so a wrong credential looks like a working send.
4. ~~**Receipt rendering**~~ — ANSWERED by reading the reference: the receipt
   is the invoice layout, word for word, with only the masthead title
   different. So it is the same renderer at a third moment, which is what
   decision 11 assumed.
