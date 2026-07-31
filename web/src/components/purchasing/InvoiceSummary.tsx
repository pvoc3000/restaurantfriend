"use client";

import { money } from "@/lib/purchaseOrders";
import { extractionNotes, type InvoiceExtraction } from "@/lib/invoiceExtraction";
import type { MatchResult } from "@/lib/invoiceMatch";

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
export function InvoiceSummary({
  extraction,
  match,
  fileName,
  model,
  receivedTotal,
  addItemSlot,
}: {
  extraction: InvoiceExtraction;
  match: MatchResult;
  fileName: string | null;
  model: string | null;
  /** What's been counted so far, in money — shown against the invoice total so
   *  a delivery that doesn't add up is visible without doing the arithmetic. */
  receivedTotal: number;
  /** An `AddPoLines` trigger, rendered inside the billed-but-not-ordered block
   *  where it's actually needed. */
  addItemSlot?: React.ReactNode;
}) {
  const matched = match.matches.filter((m) => m.invoice !== null).length;
  const guessed = match.matches.filter((m) => m.by === "description").length;
  const notOnInvoice = match.matches.length - matched;
  const total = extraction.invoice_total;
  const short = total !== null && receivedTotal < Number(total) - 0.005;

  return (
    <div className="space-y-3 border-2 border-ink px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Invoice
        </h2>
        <span className="text-ink">
          {extraction.invoice_number ?? "no number"}
          {extraction.invoice_date && ` · ${extraction.invoice_date}`}
        </span>
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
        it, and the order isn&rsquo;t done until you Finalize.
      </p>

      {/* The reader's caveats — what it couldn't make out, and what it had to
          judge. Not an error: a line explaining that a rate is printed per case
          while the quantity is in pieces is the reader being careful, and it's
          the difference between a number you can trust and one you can't. */}
      {extractionNotes(extraction) && (
        <div className="border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-ink">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em]">
            Reader&rsquo;s notes
          </p>
          <p className="mt-1">{extractionNotes(extraction)}</p>
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
