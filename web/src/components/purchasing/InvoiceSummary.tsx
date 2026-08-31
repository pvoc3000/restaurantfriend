"use client";

import { useState } from "react";
import { money } from "@/lib/purchaseOrders";
import {
  extractionNotes,
  invoiceDeliveryDate,
  type InvoiceExtraction,
} from "@/lib/invoiceExtraction";
import type { MatchResult } from "@/lib/invoiceMatch";
import { printedPoDisagreement, printedVendorDisagreement } from "@/lib/invoices";

/**
 * What was read, how much of it lined up, and — deliberately prominent —
 * everything that didn't.
 *
 * The unmatched half is the point. A reconciliation UI that only shows you the
 * rows it managed to pair reads as complete when it isn't; the lines it
 * couldn't place, and the parts of the page it couldn't read, are exactly what
 * a person needs to look at.
 *
 * This sits at the TOP of the receiving screen rather than inside a card
 * further down, so the first thing you learn on arriving is that a machine has
 * proposed something and that nothing has been written.
 */
/**
 * What the → would do, in a sentence — including what it replaces.
 *
 * Naming the date already on the order is the part that earns its keep: a
 * generated PO arrives with `delivery_date` pre-filled from the vendor's
 * delivery days (migration 016), so this button is usually overwriting a
 * PREDICTION with a fact, and the person tapping should be able to see that's
 * what's happening rather than discovering it afterwards.
 */
function takeLabel(
  source: "ship" | "invoice",
  date: string,
  current: string | null
): string {
  const from = current
    ? `This order says it arrives ${current}.`
    : "This order has no delivery date.";
  const provenance =
    source === "ship"
      ? "the ship date printed on this invoice"
      : "this invoice's own date — it prints no ship date";
  return `${from} Set it to ${date}, ${provenance}.`;
}

export function InvoiceSummary({
  invoiceCount = 0,
  poNumber,
  vendorName,
  extraction,
  match,
  fileName,
  model,
  receivedTotal,
  deliveryDate,
  onTakeDeliveryDate,
  saving,
  addItemSlot,
}: {
  /** How many invoices are FILED against this order. Named only when it's more
   *  than one — that's the backorder case, and the band otherwise describes
   *  the one document on screen without qualification. */
  invoiceCount?: number;
  /** The order being received. Compared against whatever purchase order number
   *  the invoice prints back at us — see `printedPoDisagreement`. */
  poNumber: string;
  /** Who the ORDER says we are buying from, so a reading that names somebody
   *  else can say so — see `printedVendorDisagreement`. */
  vendorName: string | null;
  extraction: InvoiceExtraction;
  match: MatchResult;
  fileName: string | null;
  model: string | null;
  /** What's been counted so far, in money — shown against the invoice total so
   *  a delivery that doesn't add up is visible without doing the arithmetic. */
  receivedTotal: number;
  /** What the order currently says. The invoice's own date is offered only
   *  when it disagrees with this — a date that already matches is a fact, not
   *  a decision. */
  deliveryDate: string | null;
  /** Undefined below purchaser+, which is what turns the offer back into text. */
  onTakeDeliveryDate?: (date: string) => void;
  saving: boolean;
  /** An `AddPoLines` trigger, rendered inside the billed-but-not-ordered block
   *  where it's actually needed. */
  addItemSlot?: React.ReactNode;
}) {
  // Collapsed by default and per mount, which is right: it resets when a
  // different document is read, and a remembered preference for a caveat you
  // open once a month is machinery nobody asked for.
  const [notesOpen, setNotesOpen] = useState(false);
  const notes = extractionNotes(extraction);

  const matched = match.matches.filter((m) => m.invoice !== null).length;
  const guessed = match.matches.filter((m) => m.by === "description").length;
  const notOnInvoice = match.matches.length - matched;
  const total = extraction.invoice_total;
  const short = total !== null && receivedTotal < Number(total) - 0.005;

  /** The invoice naming an order that isn't this one. Nothing here is an ERROR
   *  — the vendor keys our number by hand, and on 2026-08-17 a week of ordering
   *  ran through FileMaker while Mark was away, so both shops' invoices came
   *  back carrying that system's numbering. But it is the question you want
   *  asked before you record quantities: is this the right delivery's paper? */
  const wrongOrder = printedPoDisagreement(extraction, poNumber);
  const wrongVendor = printedVendorDisagreement(extraction, vendorName);

  // The date the goods moved, and whether taking it would change anything.
  const delivered = invoiceDeliveryDate(extraction);
  const takeable =
    delivered !== null && delivered.date !== deliveryDate && onTakeDeliveryDate !== undefined;
  /** The offer below is about to print the invoice's own date, so the invoice's
   *  identity shouldn't print it too — "73341407 · 2026-08-03  Invoiced
   *  2026-08-03" reads as two dates that happen to agree. */
  const restatesInvoiceDate = delivered?.source === "invoice" && takeable;

  return (
    <div className="space-y-3 border-2 border-ink px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Invoice
        </h2>
        <span className="text-ink">
          {extraction.invoice_number ?? "no number"}
          {extraction.invoice_date &&
            !restatesInvoiceDate &&
            ` · ${extraction.invoice_date}`}
        </span>

        {/* The invoice printing somebody else's order number.

            YELLOW, NOT RED, and a FILL rather than ink (text-mark on white is
            1.43:1). Red says something is WRONG; this says look at it. Nearly
            every cause is benign — a rep mis-keys the number, or the order was
            placed from another system — and none of them makes the delivery in
            front of you incorrect. What it is worth is the five seconds it
            takes to confirm you are counting against the right order before
            fifteen quantities get written.

            The chip SAYS what it means rather than hiding it in the title: the
            tooltip is a native one and the iPad has no hover. */}
        {wrongOrder && (
          <span
            className="border border-ink bg-mark-fill px-2 text-[12px] uppercase tracking-[0.12em]"
            title={
              `This invoice prints purchase order ${wrongOrder.join(", ")}, ` +
              `but you are receiving ${poNumber}. Check the paper belongs to ` +
              `this order before recording quantities.`
            }
          >
            {wrongOrder.length > 1 ? "Invoice names other orders" : "Invoice names a different order"}
            {" · "}
            {wrongOrder.join(", ")}
          </span>
        )}

        {/* The stronger of the two identity warnings, and it goes FIRST: a
            printed order number one digit out is a misprint, where a different
            company's name on the page means the document is not this order's at
            all. It is the check that would have caught $1,985.99 of Dawn's bill
            being filed under Vesta. */}
        {wrongVendor && (
          <span
            className="border border-ink bg-mark-fill px-2 text-[12px] uppercase tracking-[0.12em]"
            title={
              `This invoice is from ${wrongVendor}, but this order is with ` +
              `${vendorName ?? "another vendor"}. Filing it here would record the ` +
              `bill against the wrong vendor — check the paper belongs to this order.`
            }
          >
            Invoice is from {wrongVendor}
          </span>
        )}

        {/* Two invoices against one order is a partial shipment, and the
            quantities below come from BOTH — so the band has to say so rather
            than letting the one document on screen speak for the pair. */}
        {invoiceCount > 1 && (
          <span className="border border-ink bg-mark-fill px-2 text-[12px] uppercase tracking-[0.12em]">
            {invoiceCount} invoices on this order
          </span>
        )}

        {/* When the delivery happened, and a → that puts it on the order —
            the same take-it-or-leave-it shape as a line's Invoiced quantity,
            and for the same reason: a machine's reading of a photograph never
            writes itself.

            A SHIP date is always worth showing, because it's a fact the order
            doesn't otherwise have. The invoice DATE is only shown here when
            taking it would change something — otherwise it's already sitting
            two inches to the left in the invoice's own identity, and printing
            it twice in a band this tight reads as two different dates. */}
        {delivered && (delivered.source === "ship" || takeable) && (
          <span className="flex items-center gap-1.5">
            <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              {delivered.source === "ship" ? "Shipped" : "Invoiced"}
            </span>
            <span className="tabular-nums text-ink">{delivered.date}</span>
            {takeable && (
              <button
                type="button"
                disabled={saving}
                onClick={() => onTakeDeliveryDate?.(delivered.date)}
                aria-label={takeLabel(delivered.source, delivered.date, deliveryDate)}
                title={takeLabel(delivered.source, delivered.date, deliveryDate)}
                className="grid h-7 w-7 place-items-center border border-ink bg-white text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
              >
                →
              </button>
            )}
          </span>
        )}

        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {matched} of {match.matches.length} lines matched
          {guessed > 0 && ` · ${guessed} by description`}
          {notOnInvoice > 0 && ` · ${notOnInvoice} not on the invoice`}
        </span>

        {/* Billed against counted. Bill.com puts the line sum beside the bill
            amount for the same reason: the question "does this delivery add
            up?" shouldn't need mental arithmetic. */}
        {total !== null && (
          <span className="ml-auto flex items-baseline gap-3 tabular-nums">
            <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Billed {money(total)}
            </span>
            <span
              className={`text-[12px] uppercase tracking-[0.12em] ${short ? "text-accent" : "text-subtle"}`}
              title="What you've recorded as received, at the order's prices"
            >
              Received {money(receivedTotal)}
            </span>
          </span>
        )}
      </div>

      {/* Said in the card, not buried in a tooltip: everything here was read off
          a photograph by a model, and none of it is true until someone says so. */}
      {/* Two different promises, and they must not be blurred: nothing off the
          invoice reaches the order unless someone taps it in, and the order
          isn't done until Finalize. Writing "nothing is written until you
          Finalize" would be the wrong one — every tap writes immediately, so
          that sentence would tell you your count wasn't saved when it was. */}
      <p className="text-xs text-muted">
        Read from {fileName ?? "the attachment"}
        {model && ` by ${model}`}. Nothing here reaches the order until you take
        it, and the order isn’t done until you Finalize.
      </p>

      {/* The reader's caveats — what it couldn't make out, and what it had to
          judge. Not an error: a line explaining that a rate is printed per case
          while the quantity is in pieces is the reader being careful, and it's
          the difference between a number you can trust and one you can't.
          
          COLLAPSED, BEHIND A CARET, AND NOT AN OVERLAY (Mark, 2026-08-31: "a
          lot of noise… for the most part it's unnecessary, but it's still there
          if we need it", then offering either). A disclosure wins here for a
          reason particular to this screen: an overlay would cover the invoice
          AND the lines, which are the two documents you are standing there
          comparing, and it would have to be dismissed before you could go back
          to counting. It also costs nothing to expand — the split row MEASURES
          whatever sits above it and a ResizeObserver keeps that honest as bands
          come and go, which is the case this band is named in.
          
          The trigger is quiet, reading like the small-caps labels beside it
          rather than wearing the yellow: the fill means "worth your eye", and
          on a note that is usually a rate-per-case caveat that is a claim it
          cannot keep. The CONTENT keeps the fill, because opened, it is. */}
      {notes && (
        <div>
          <button
            type="button"
            onClick={() => setNotesOpen((o) => !o)}
            aria-expanded={notesOpen}
            className="flex items-center gap-1.5 text-[12px] uppercase tracking-[0.12em] text-subtle hover:text-ink"
          >
            {/* ▶ (U+25B6), NOT ▸ (U+25B8), and the GLYPH is doing most of the
                work here rather than the font size (Mark, 2026-08-31: "too
                small… make it 3 or 4 times larger", then "too big… split the
                difference"). Measured as INK rather than em box, which is the
                whole point: ▸ at the label's own 12px paints 4×5 PIXELS, and to
                reach even 11px of ink it would need a ~60px font — a line box
                several times the height of the band it sits in. ▶ paints 12×11
                at 18px.

                18px is the SPLIT: 5px of ink to 17px (▶ at 26px, which read as
                too big) puts the midpoint at 11. It costs the button one pixel
                over the original 17 — the size it was always going to be is the
                one where the character is the right character. It is also the
                order guide's own disclosure triangle, so the app has one shape
                for this. Reach for the bigger glyph before the bigger size. */}
            <span
              aria-hidden
              className={`inline-block text-[18px] leading-none transition-transform ${
                notesOpen ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            Reader’s notes
          </button>
          {notesOpen && (
            <p className="mt-1 border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-ink">
              {notes}
            </p>
          )}
        </div>
      )}

      {match.unmatchedInvoice.length > 0 && (
        <div>
          <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Billed but not on this order
          </p>
          <ul className="mt-1 space-y-0.5">
            {match.unmatchedInvoice.map((l, i) => (
              <li
                key={`${l.product_id ?? "?"}-${i}`}
                className="flex flex-wrap items-baseline gap-2"
              >
                {l.product_id && (
                  <span className="tabular-nums text-muted">{l.product_id}</span>
                )}
                <span className="text-ink">{l.description}</span>
                <span className="tabular-nums text-muted">
                  {l.qty ?? "—"} × {money(l.unit_price)}
                </span>
              </li>
            ))}
          </ul>
          {/* The command lives HERE rather than being named in a sentence and
              left on another screen — this list is the only place the thought
              "that should be on the order" occurs. */}
          {addItemSlot && <div className="mt-2">{addItemSlot}</div>}
        </div>
      )}
    </div>
  );
}
