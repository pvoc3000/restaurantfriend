"use client";

import { money } from "@/lib/purchaseOrders";
import { extractionNotes, type InvoiceExtraction } from "@/lib/invoiceExtraction";
import type { MatchResult } from "@/lib/invoiceMatch";

/**
 * The band above the line table while you're reconciling against an invoice:
 * what document you're looking at, how much of it lined up, the one bulk action
 * worth having, and — deliberately prominent — everything that DIDN'T line up.
 *
 * The unmatched half is the point. A reconciliation UI that only shows you the
 * rows it managed to pair reads as complete when it isn't; the lines it
 * couldn't place, and the parts of the page it couldn't read, are exactly what
 * a person needs to look at.
 */
export function InvoiceReconcile({
  extraction,
  match,
  fileName,
  model,
  receivable,
  busy,
  onReceiveFromInvoice,
}: {
  extraction: InvoiceExtraction;
  match: MatchResult;
  fileName: string | null;
  model: string | null;
  /** Matched lines with an invoice quantity and nothing recorded yet. */
  receivable: number;
  busy: boolean;
  onReceiveFromInvoice: () => void;
}) {
  const matched = match.matches.filter((m) => m.invoice !== null).length;
  const guessed = match.matches.filter((m) => m.by === "description").length;
  const notOnInvoice = match.matches.length - matched;

  return (
    <div className="space-y-3 border-2 border-ink px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Invoice
        </h2>
        <span className="text-ink">
          {extraction.invoice_number ?? "no number"}
          {extraction.invoice_date && ` · ${extraction.invoice_date}`}
          {extraction.invoice_total !== null &&
            ` · ${money(extraction.invoice_total)}`}
        </span>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {matched} of {match.matches.length} lines matched
          {guessed > 0 && ` · ${guessed} by description`}
          {notOnInvoice > 0 && ` · ${notOnInvoice} not on the invoice`}
        </span>

        {receivable > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={onReceiveFromInvoice}
            title="Fills the received quantity from the invoice on matched lines that have none. Anything already counted is left alone."
            className="ml-auto h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Receive {receivable} from invoice
          </button>
        )}
      </div>

      {/* Said in the card, not buried in a tooltip: everything here was read off
          a photograph by a model, and none of it is true until someone says so. */}
      <p className="text-xs text-muted">
        Read from {fileName ?? "the attachment"}
        {model && ` by ${model}`}. Nothing is written to the order until you
        accept it — tap a value in the Invoice columns to take it.
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
          <p className="mt-1 text-xs text-muted">
            Use <span className="text-ink">Add item…</span> to put any of these on
            the order, then reconcile again.
          </p>
        </div>
      )}
    </div>
  );
}
