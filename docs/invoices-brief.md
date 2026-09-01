# Invoices module — build brief

**Status: SPECCED 2026-08-04, not yet built.** Read `CLAUDE.md` first, then
`docs/receiving-screen-brief.md` (the engine this sits on top of), then this.

The reading half already exists and works: `extract-invoice` returns the vendor,
the invoice number, the dates, the total and the lines, and `lib/invoiceMatch.ts`
joins those lines to a purchase order. **This brief is about giving that reading
a RECORD** — something with a status, a due date, and an identity independent of
one attachment on one PO.

---

## Why

Mark, 2026-08-04, after using the receiving screen for real:

> this reconcile PO workflow is new to me and I love it. It's making me want to
> expand the concept just a little bit. […] Every time we upload an invoice to a
> purchase order we could create an invoice record. Invoice records could sync to
> Quickbooks online or Bill.com […] Paid/Unpaid invoices could be flagged in our
> app. It would complete the work flow.

Two limitations this brief's own predecessor already flagged are closed by the
same change:

- *"Nothing routes you to orders awaiting receiving."* An invoice list with a
  status **is** that route.
- *"One invoice, one PO."* Nothing merges today, because there is no invoice
  entity — only an attachment on one order.

And one thing neither of them said out loud: **an invoice with no purchase order
has nowhere to live at all.** `vendors` already holds the landlord, the plumber
and the utilities with `order_type: 'none'`. They never produce a PO and always
produce a bill. Confining invoices to PO-born ones would mean QuickBooks still
gets hand-entry for everything that isn't food.

### The thing this app knows that QuickBooks doesn't

An invoice arriving is not an invoice you should pay. QBO knows what was billed;
it does not know whether the case actually showed up. Ordered ↔ received ↔
billed is already computed by `matchInvoiceToOrder` and `lib/receiving` — the
approval step just names it. That is the module's reason to exist, and it is why
approval ships in v1 and the sync does not.

---

## Decisions already made (Mark, 2026-08-04 — do not relitigate)

1. **Scope is all vendor bills**, not just PO-born ones. Creatable with no
   purchase order at all.
2. **v1 is the record, the list and approval. No QuickBooks sync** — but leave
   the seams that are expensive to retrofit.
3. **Approval is an explicit action**, separate from closing a PO, and it is
   **Manager and Owner only**.
4. **Many-to-many is real and regular**: one invoice covering two POs, one PO
   invoiced in two parts.
5. **The tables are `vendor_invoices` / `vendor_invoice_lines`.** The UI label is
   "Invoices". `docs/master-plan.md`'s unbuilt Quotes & Orders module has a
   customer-facing "Quote → Invoice → Receipt" lifecycle, so a bare `invoices` is
   a name the customer side will want — the same collision `purchase_orders`
   already dodged with a future `orders`.
6. **Attaching and reading an invoice on a PO creates the record automatically.**
   **REVERSED 2026-09-01, by Mark, after using it** ("when I added a scanned
   invoice document to a purchase order so I could reconcile, the app created
   an invoice record. I think this is premature … it should be created only
   once a purchase order is reconciled and closed"). Attaching still auto-READS
   — the extraction is what receiving reconciles against — and it no longer
   creates a BILL. The record is offered as a ticked line in the CLOSE confirm,
   which both the receiving screen and PO detail already made (2026-08-27);
   until this reversal that offer could never appear, because auto-filing had
   always consumed the reading first. `fileAsInvoice` on the document and
   "File as bill" on PO detail remain the standing manual route. See CLAUDE.md
   4d, "FILING IS AN ACT OF CLOSING".

### Decisions taken during the design, with their reasons

**No `paid` status, and no payments table.** v1 has no payment writer, and once
the sync exists "paid" is a fact QuickBooks owns. Two truths about the same money
is worse than one truth elsewhere. The check constraint widens in one line later.

**No `draft` either.** A half-typed bill and a machine-read one are both open
bills; what distinguishes them is `source`, not a status. A second unapproved
state that nothing operationally distinguishes is the mistake `closed` made — it
existed in 001, sorted and badged correctly, and sat unused for months because
nothing routed you to it.

**`is_credit` plus positive magnitudes**, never a signed total. OCR returns
`-142.10`, `142.10 CR` and `142.10` on a page headed CREDIT MEMO unpredictably. A
flag plus positive amounts gives exactly one convention; a signed column means
every reader has to know whether a given row is already signed. `signedTotal()`
is the only place the sign lives. The *reading* transcribes as printed; the
*record* normalizes — that seam is `invoiceHeaderFromExtraction`.

**`location_id` is NOT NULL.** Rent and utilities are per-shop costs. A PO-born
invoice inherits the order's location, a hand-typed one takes the working
location. Nullable-means-org-wide is the wrong answer: a null row either vanishes
from every location-scoped screen or appears on all of them, and both look like a
bug. If a genuinely org-wide bill needs a home, the answer is a scope on the list
(`/cleanup`'s all-locations mode), not a null in the column.

**No unique constraint on the invoice number — warn, never block.** Following
`findPossibleRehires` exactly. A credit memo legitimately carries the number of
the invoice it credits; `invoice_number` is nullable and Postgres allows
unlimited NULLs in a unique index, so the constraint would silently skip the
numberless rent bill — the row most likely to be entered twice; and one misread
digit lets a real duplicate through while refusing a correctly-read reissue. The
failure would surface as a raw 23505 to someone standing at a delivery holding
paper, which is the class of failure `invoiceDeliveryDate`'s format check exists
to prevent.

The structural guard that actually matters is better than any constraint:
**a document row carries at most one `invoice_id`, and auto-creation fires only
when it is null.** Re-reading a filed invoice can never create a second record.

---

## The data model

### The many-to-many lives on the LINE

`vendor_invoice_lines` carries **both** `purchase_order_id` and
`purchase_order_item_id`. There is no FK on the invoice header and no
`invoice_purchase_orders` join table. Both directions are one index:

```sql
select distinct purchase_order_id from vendor_invoice_lines where invoice_id = $1;
select distinct invoice_id from vendor_invoice_lines where purchase_order_id = $1;
```

Why this and not a join table:

- It is **the same granularity as the reconciliation the app already does**.
  `matchInvoiceToOrder` produces exactly a per-line pairing; persisting it is a
  one-column write. A header-level join would throw that away and then need it
  back.
- **Split and merge need no schema at all.** One invoice across two POs is lines
  pointing at two POs. One PO in two parts is two invoices whose lines point at
  disjoint subsets, with no unique constraint to collide on — the backorder case
  is free.
- **It cannot go stale.** An explicit join table can claim "invoice A relates to
  PO 7" when none of A's lines touch 7. A derived link can't lie.

The coarser `purchase_order_id` exists for the two things a pure line-item join
can't express: a line matching no PO line (freight, a fuel surcharge, a
billed-but-not-ordered item), and an invoice you know perfectly well belongs to
PO 7 where every line match failed. The check constraint
`purchase_order_item_id is null or purchase_order_id is not null` means naming a
LINE obliges you to name its ORDER, which keeps one representation at one
granularity.

**Verified before relying on the denormalization:** `purchase_order_items.po_id`
is written at insert (`AddPoLines.tsx`) and **never updated anywhere in
`web/src`**, so a PO item cannot move between orders and the copied
`purchase_order_id` cannot drift. Note the invariant in the migration; don't add
a trigger.

### Lines are real rows, not jsonb

`purchase_order_attachments.extraction` keeps its 019 meaning exactly — the raw
reading, on the document row, never edited. The chain is **document → raw
reading → seeded lines → human-corrected lines**, and you can always ask what the
machine actually said after six edits.

The lines themselves are rows because:

1. The many-to-many needs an FK, and a jsonb array can't have one or be indexed.
2. **A line gets EDITED, and a jsonb path is POSITIONAL.** A re-read renumbers
   the positions and silently retargets every correction someone made — data loss
   with no symptom.
3. A hand-typed rent bill has no extraction to live in, so the column would mean
   two different things.
4. Money has to sum, and `purchase_order_items` is real rows for exactly this.

**`unit_price` is `numeric(12,4)`** because `invoiceUnitPrice` derives
`extended ÷ qty` and catch-weight lines produce fractions of a cent. **Do not
"fix" `purchase_order_items.unit_price` to match** — its two decimals are what
makes `priceAction` terminate.

### The document reuses the PO attachments table and bucket

018's four `storage.objects` policies test `bucket_id` and
`public.storage_folder_org(name)`, which is `(storage.foldername(name))[1]` —
the **first** path segment. They say nothing about the second. **Verified:** a
key `{org_id}/invoices/{invoice_id}/{uuid}.ext` is authorized by the existing
policies with no new function, policy or grant.

So 026 makes `po_id` nullable and adds `invoice_id` rather than creating a second
table. 021's separate bucket precedent does not apply, and the reason is the
deciding test: **021 needed its own bucket because employee documents have
different RLS.** Invoice documents want exactly the audience PO attachments have.

`on delete set null`, not cascade — a document can belong to both a PO and an
invoice, and deleting the invoice must not delete the order's paperwork. And
deliberately **no** `check (po_id is not null or invoice_id is not null)`: with
`set null` that check would make deleting an invoice fail with a raw constraint
violation. The app removes invoice-only documents first (row then object, 018's
order); a stray row is unreachable, which 018 already states its tolerance for.

**Nothing migrates.** A file attached to a PO keeps today's key even when it
later gains an `invoice_id` — the path is where it landed, not a claim about
ownership.

**`extract-invoice` needs no structural change.** It selects `po_id` and uses it
for nothing, checks the role on `org_id`, downloads through the caller's JWT and
writes `extraction` back to the same table. All of that works unchanged on a
`po_id`-null row. The only edits to that file in this whole project are the
schema constant and the prompt.

### Approval cannot be an RLS policy

The rule is "a purchaser may edit this invoice, but only a manager may set
`approved_at`", and **RLS filters rows, not columns**. So `set_vendor_invoice_approval`
is a `security definer` function naming those columns — the `set_my_member_profile`
pattern. It re-checks what RLS would have, takes `approved_by` from `auth.uid()`
and never from the client, refuses a void invoice, and **returns rows so the
caller can check the count** (an update matching no policy returns no error — the
lesson from the employee delete and from Finalize). Both revokes per 002.

One function does both directions. An approval with no way back means people stop
approving.

---

## What to build

Build order is in the plan; the parts, in the order they matter:

**`lib/invoices.ts`** — `INVOICE_STATUS_LABEL` / `_CLASS`, `signedTotal`,
`agingBucket` + `AGING_ORDER` / `AGING_LABEL`, `findPossibleDuplicates`,
`amountReconciliation`, `approvalReadiness`, `invoiceHeaderFromExtraction`. Pure,
fixture-tested. `agingBucket` takes `today` as a string computed once from the
**org timezone** — a UTC host must not make a bill overdue at 4pm, the same trap
migration 007 exists to close.

**The list, `/invoices`** — clones `/purchase-orders` exactly. Default sort
**due date ascending** (the working order for bills is soonest-first, and
`lib/tableSort` sinks empties last in both directions). Default filter **`open`**,
unlike the PO list's `all`, because this list exists to answer "what do I owe a
decision on". Aging tiers Overdue · Due in 7 · Due in 30 · Later · No due date,
with `nodate` **last** rather than folded into Later — the rent bill will be the
commonest one and burying it hides work. Group bands on status, vendor, and due
date **by bucket rather than raw value** (the raw date fails the
few-values-many-rows test; its bucket passes, and sorting ascending makes the
bands contiguous by construction). **No invoice-date band**: POs batch on Monday,
invoices arrive one per delivery.

**The detail, `/invoices/[id]`** — a two-column grid, document left, that is
**NOT draggable and NOT viewport-measured**. Receiving earned its
`ResizeObserver`, `spaceBelow` and drag divider by being a single-viewport
standing task whose lines pane scrolls inside itself; invoice detail is a desk
screen that scrolls the page like every other detail screen. Say so in a comment,
so nobody "fixes" it by lifting the measurement machinery in.

**Approve** is a **white outlined button in a footer row in the page's own flow**,
beside Void. Not an ActionBar — Mark had the black bar removed from receiving on
2026-08-04. Not black: the `DIALOG_COMMIT_CLASS` exception is "a commit inside a
panel", and this screen's buttons (Link to PO…, Add line, Void, Delete, Approve)
are a row of peers, which is the case the rule explicitly says is *not* the
exception. It **does not navigate on success** — unlike Finalize, which leaves
because finalizing ends the task — the strip instead replaces the button with
"Approved by <name> on <date>".

**`approvalReadiness`** is `closeReadiness`'s twin and follows its rule exactly:
it reports and never blocks. It names totals that don't add up, lines attributed
to no PO (silent when **none** are, or a rent bill complains every time), the
three-way-match exceptions per linked PO, no document, a possible duplicate, and
a vendor-name disagreement. **Every caveat must have an affordance on the
screen** — the BakeMark lesson: a confirm that names something you're given no
way to fix teaches you to stop reading confirms. Price differences link to the
receiving screen, which owns the two-stage write; **do not build a second price
path here.**

**Linking** is three mechanisms and no more. The printed PO number is an
automatic first *pass*, never an automatic *link* — it requires a unique
candidate at the same vendor and location, because a printed number is one OCR
digit from someone else's order. *Provenance is different and does link
automatically:* an invoice created from a PO's own Paperwork card is linked to
that PO because you attached it there. Then a "Link to PO…" dialog, which **is**
the merge UI, with one checkbox to attribute the remaining lines to that order
too. Then a per-line `ui/RowMenu`.

**Only the merge direction costs UI.** One PO invoiced in two parts falls out of
the data model with nothing to build — worth knowing before estimating.

---

## What already works — preserve it

**The acceptance criterion for this whole project is that the receiving screen
does not regress.** Mark started using it on 2026-08-04 and likes it.

- `matchInvoiceToOrder` is pure over two arrays with no notion of "the" invoice
  or "the" PO. **It does not change.** Two additive exports sit beside it:
  `matchInvoiceToOrders` (per PO, in descending confidence, over what's still
  unclaimed — **never** concatenate two POs' lines into one call, or a SKU unique
  within each becomes ambiguous across both and the matcher correctly refuses
  both) and `matchesFromLinks`.
- Receiving **prefers the stored link over a fresh match**, which is better three
  ways at once: it honours a human's manual matches, it survives a re-read, and
  it sidesteps the duplicate-SKU problem. **Keep `latestRead` as the fallback** —
  that is what makes day one a no-op and what covers any attachment never filed
  as an invoice.
  **A MIDDLE TIER WAS ADDED 2026-09-01 when filing moved to close**:
  filed links → `billsFromReadings` (the order's readings, joined into bills by
  printed number, each bill's pages unioned as a multiset) → `latestRead`. It
  had to exist that day, because until then receiving could lean on the filed
  records having been joined and unioned for it, and `latestRead` reconciles
  against ONE document. Measured on the real two-page Chefs Warehouse 73535581:
  one bill of 11 lines, the same printed lines the filed record holds, where
  `latestRead` alone offers 7. The middle tier is `createInvoiceFromReading`'s
  own join rule done in the head rather than in the database — **parity with
  what filing would produce is the target**, and a cleverer rule here would be
  a second answer to a question this module has already answered.
- Unchanged and to be verified unchanged: `fillable`, `priceAction`, `skuAction`,
  `receivedClass`, `qtyLabel`, `receivingOrder`, the `→` take-it chips, the Undo
  band, the manual-match dialog, the split layout and its measurement, and the
  `Close · Complete` footer.
- **Closing a PO does NOT require its invoices to be approved.** Approval runs on
  a different clock: a delivery can be complete on Friday and the bill approved
  next Tuesday. Gate nothing.

## Known limitations, accepted

- **The ~10 existing stored extractions are not backfilled.** A SQL backfill
  would have to reimplement the matcher in PL/pgSQL for ten rows, and every
  pre-redeploy reading lacks a due date, tax, freight and PO number anyway — the
  honest move for those is "Read again, then file". A **"File as invoice"** button
  clears the backlog and is the escape hatch the auto path needs regardless.
- **No Invoices column on the PO list.** That list is at its width limit (1338,
  and its eight-column compact set already truncates at 736). Obvious follow-on
  once the module has been used.
- **`purchase_order_attachments` keeps its now-slightly-wrong name.** Renaming is
  right eventually and wrong bundled with a new module and a live edge-function
  redeploy. Propose it later as its own content-free migration.
- **A line printing no item number anywhere still can't be paired**, exactly as
  on the receiving screen — pairing IS copying a number onto the PO line. If that
  ever has to be recorded, it needs a column on `purchase_order_items` and is a
  migration, not a tweak.

## Verification

- `npx tsc --noEmit`, `npm run lint`, `npm run fixtures` in `web/` at every commit.
- Migrations through the Docker harness before Mark applies them, then probe the
  hosted DB — never assume applied state:
  `select polname, polcmd from pg_policy where polrelid = 'public.vendor_invoices'::regclass`,
  and call the approval RPC with a bogus uuid so it raises on its first statement
  rather than doing any work.
- Storage: upload with no PO and confirm the object lands at
  `{org_id}/invoices/{invoice_id}/{uuid}.pdf`, that the signed URL renders, and
  that an `anon` signed-URL request is refused (018's own check).
- **After the last commit, re-walk the three real orders end to end and leave
  them as found:** `132-181132-02` (Chefs' Warehouse, DF02, 15 lines),
  `112-181120-01` (BakeMark — the DF01 override and the renumbered SKUs), and
  `135-181118-01` (Dawn — the two-column item number).
- Date fields in **both** Safari and Chrome. The empty-date bug is invisible in
  one of them.
