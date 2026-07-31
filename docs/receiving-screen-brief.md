# Receiving screen — build brief

**Status: BUILT 2026-07-31** at `/purchase-orders/[id]/receive`. Reconcile mode
is deleted. See CLAUDE.md build-step 4 for what shipped and the decisions that
moved during the build — in particular the Bill.com-derived layout (document
left, draggable divider, stacked below `xl`), the Undo on bulk receive, and two
corrections this brief didn't anticipate: the price button needs its own
null-tolerant comparator, and "Update vendor" must write
`vendor_item_location_prices` when the location has an override.

Two things below are now STALE and left as written for the record: the
"23 fixture cases" (they existed only ad hoc — there are 66 committed ones now,
run with `npm run fixtures`), and PO 132-181121-01 as the test order (Mark had
already run it to completion; `132-181132-02` replaced it).

---

Superseded reconcile mode, which Mark used once, against a real invoice, and
would not use again.

Read `CLAUDE.md` first, then this. The engine described here — extraction,
matching, price derivation — is built, tested, and working; **this brief is
about the room it lives in, not the engine.**

---

## Why

Mark ran the full invoice flow against Chefs' Warehouse invoice 73341407 on
2026-07-31 and gave this verdict: *"As it stands, I would never use this
feature."* His critique, verbatim in substance:

1. Too many steps — attach, read, reconcile, change PO price, update vendor
   item, receive, close.
2. Reconcile mode is non-obvious; almost nothing changes when you enter it.
3. The UI is scattered — two different places to change a price (the line, and
   the band above the lines), and "Receive all as ordered" sits on its own.
4. Reading an invoice gives a small text message; there's no clear indication
   that something is happening.
5. "Receive all as ordered" uses the ordered numbers — so what did reading the
   invoice actually buy?
6. The Ordered and Received columns show bare numbers with no pack unit.
7. The "Receiving" column is misnamed.
8. You should be able to **see the invoice while receiving**.

### The diagnosis

Reconciliation was built as a *mode on the PO detail table* rather than a
surface of its own. The reasoning was that `qty_received` and `unit_price`
already mean the right things, so a second surface would mean a second place to
edit a PO line.

That reasoning is correct about **write paths** and was wrongly applied to a
**view**. Receiving against an invoice is a distinct task with a distinct
posture — you are standing at a delivery holding paper, comparing two
documents — while PO detail is a record-editing screen. A dedicated surface can
write through exactly the same code; nothing about avoiding duplicate logic
required avoiding a duplicate view.

Points 2 and 8 are that single problem. Points 1, 3 and 5 are its consequences.

---

## Decisions already made (Mark, 2026-07-31 — do not relitigate)

- **The receiving screen REPLACES reconcile mode.** Delete the mode, don't keep
  both.
- **Auto-read applies to invoices only.** Attaching an attachment of kind
  `invoice` reads it automatically; other kinds do not (each read costs money,
  and a packing slip has nothing to join on).
- **Price acceptance is an explicit labelled button, in two stages.** Clicking
  the price itself to accept it is "a weird mechanic". Instead, beside or below
  the price:
  - the button reads **"Update PO"** → tapping sets `purchase_order_items.unit_price`
    to the invoice price;
  - it then becomes **"Update vendor"** → tapping pushes that price onto
    `vendor_items.price` (the DB trigger writes price history — do not log in
    app code);
  - after both, no button.
  - A line whose PO price already matches the invoice but whose CATALOG price
    doesn't should show "Update vendor" directly. This absorbs the standalone
    price-differs band — delete it.

---

## What to build

A route — suggested `/purchase-orders/[id]/receive` — reached from the PO and
(later) from a list of deliveries awaiting receiving.

**Layout: the invoice beside the lines.** The document is already in Storage
with a signed URL minted server-side (`createSignedUrls`, see
`PurchaseOrderDetailView`). PDFs render in `<object type="application/pdf">`
with a text fallback — the pattern is proven in `ProcessPo`'s compose card, and
note the Claude browser pane is one of the clients that shows the fallback.
Images are an `<img>`. Plan for iPad portrait: side-by-side won't fit, so either
stack or offer a document/lines toggle.

**One row per PO line**, showing ordered, invoiced and received together, with
the receive action on the row. The row is the unit of work — a person goes down
the delivery line by line.

**One receive control, not two.** It uses the invoice quantities when an
invoice has been read and the ordered quantities when it hasn't. Never
overwrite a quantity a human already entered — that rule holds everywhere in
this app (see PO list batch mark-received).

**Reading feedback.** An invoice read is an Opus call over a document and can
run 30 seconds or more. It needs a real indicator, not a line of text. The
design system forbids spinners and skeletons but permits the indeterminate bar
used in every `loading.tsx` (`components/ui/PageLoading`) — reuse that idiom,
in a `ui/Dialog` or a prominent band.

**Quantities carry their pack.** "3" and "3 CS" are different amounts of
information; `package_desc` is on the line already.

**Rename** the `discrepancy_note` column header from "Receiving" to
**"Receiving note"** — it names the phase where it should name the content.

**Close the order** from here. `closeReadiness` (`lib/purchaseOrders.ts`)
already names what's unresolved and deliberately doesn't block.

---

## What already works — preserve it

The engine survived contact with a real invoice and should not be regressed:

- **`lib/invoiceMatch.ts`** — `product_id` is the join key; matched 19/19 lines
  on the real Chefs' Warehouse invoice. Normalises case, dashes and leading
  zeros; refuses to pair a SKU that appears twice on either side; falls back to
  description containment (≥ 0.75 of the shorter, ≥ 3 shared words) only for
  lines with no printed SKU. **23 fixture cases**, run in Node via an esbuild
  slice — re-run them after any change.
- **`invoiceUnitPrice`** (`lib/invoiceExtraction.ts`) — the per-unit price comes
  from `extended ÷ qty`, NOT the invoice's printed unit price. Distributors
  quote per-case or per-pound rates against per-piece quantities; the derived
  figure reproduced the order's own prices on 13 of 19 lines where the printed
  one managed 6.
- **Two markers must survive into the new UI**: `≈` for a line matched on
  description rather than SKU, and `?` for a line where the invoice's own
  arithmetic doesn't close (`printedPriceDisagrees` — the catch-weight case).
  Both say "this number deserves your eye", and dropping them would present a
  guess as a fact.
- **The reader's `notes`** — caveats and judgement calls, not just illegible
  text. On the real invoice it explained the pack arithmetic and named which of
  two printed item numbers it used as the SKU. Show it.
- **Nothing writes itself.** An extraction is a proposal. Every value that
  reaches the order does so because a person tapped something.

---

## What to delete

- Reconcile mode on `PurchaseOrderDetail` (the toggle, the injected Invoice
  columns, `InvoiceCell`).
- `InvoiceReconcile.tsx` — its content moves onto the new screen.
- The price-differs band (superseded by the two-stage button).
- "Receive all as ordered" on PO detail — receiving happens on the receiving
  screen. PO detail keeps its inline cell editing for desk corrections.

---

## Known limitations, still unsolved

Flag these rather than silently designing around them:

- **Nothing routes you to orders awaiting receiving.** The PO list has a Files
  count but no "read, not yet reconciled" state. On a Friday with six
  deliveries that matters. A filter or a dedicated list is the natural
  follow-on — out of scope here, but design the route so it can be linked to.
- **One invoice, one PO.** A delivery billed across two POs, or a PO invoiced in
  two parts, is not handled: the app reconciles against the most recently read
  attachment alone. Nothing merges.
- **`closeReadiness` ignores `discrepancy_note`.** You can flag a short delivery
  and close the order without anyone chasing it.

---

## Verification

- Re-run the matcher fixtures (23) after touching `lib/invoiceMatch.ts` or
  `lib/invoiceExtraction.ts`.
- The real test is PO **132-181121-01** at DF01: a genuine Chefs' Warehouse PDF
  with a stored extraction, 19 lines, 7 real price differences (Mexican Coke,
  oat milk, soy milk, strawberries, frozen raspberries, rainbow sprinkles, half
  and half) and 7 catch-weight lines. Nothing has been received against it yet,
  so it exercises the whole flow.
- `npx tsc --noEmit` and `npm run lint` in `web/`.
- Migrations, if any: the Docker harness (see the memory note), never assume
  applied state — probe.
