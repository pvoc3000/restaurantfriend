// Turning a machine's reading of an invoice into a record you can approve.
//
// This runs CLIENT-side, in `useAttachmentActions.read()`, and not in the
// `extract-invoice` edge function — deliberately. That function is a READER:
// "nothing here writes to the order" is the sentence it was built around, and
// moving vendor, location and credit judgements into Deno would put them
// somewhere that can't import from `web/` and can't be fixture-tested. The
// client already has the order in hand, and keeping the write here preserves
// the rule that the UPLOAD stands even when the read fails.
//
// The Supabase client is a PARAMETER rather than an import, matching
// lib/poProcessing and lib/purchaseOrderQueries — these modules are about the
// writes, not about who is signed in.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceExtraction } from "./invoiceExtraction";
import {
  invoiceHeaderFromExtraction,
  invoiceLinesFromExtraction,
} from "./invoices";
import { matchInvoiceToOrder } from "./invoiceMatch";
import type { PoLine } from "./purchaseOrders";

export type InvoiceCreationOrder = {
  id: string;
  vendor_id: string;
  location_id: string;
  lines: PoLine[];
};

export type InvoiceCreationResult =
  | { invoiceId: string }
  | { error: string };

/**
 * File a reading as an invoice record, and link it to the order it was read on.
 *
 * The write order is chosen the way `useAttachmentActions`' two opposite orders
 * were — by asking what each failure leaves behind:
 *
 *   1. the HEADER first, because a failed line insert then leaves an EMPTY
 *      invoice, which is visible on the list and fixable by hand. Lines first
 *      would leave orphans nothing points at.
 *   2. the lines, in one insert.
 *   3. the matches, as an update per matched line.
 *   4. the attachment's `invoice_id` LAST, because that is the flag which stops
 *      a re-read creating a second record — it should only be set once the
 *      record it names actually exists.
 */
export async function createInvoiceFromReading(
  supabase: SupabaseClient,
  {
    orgId,
    attachmentId,
    extraction,
    order,
    fallback,
  }: {
    orgId: string;
    attachmentId: string;
    extraction: InvoiceExtraction;
    /** The purchase order this was read on, when there is one. */
    order: InvoiceCreationOrder | null;
    /** Where to file it when there is no order — the working location, and a
     *  vendor the human picked. */
    fallback: { vendorId: string; locationId: string } | null;
  }
): Promise<InvoiceCreationResult> {
  const vendorId = order?.vendor_id ?? fallback?.vendorId;
  const locationId = order?.location_id ?? fallback?.locationId;
  if (!vendorId || !locationId) {
    return { error: "No vendor or location to file this invoice against." };
  }

  const header = invoiceHeaderFromExtraction(extraction);

  const { data: invoice, error: headerError } = await supabase
    .from("vendor_invoices")
    .insert({
      org_id: orgId,
      location_id: locationId,
      vendor_id: vendorId,
      ...header,
      status: "open",
      source: "extraction",
    })
    .select("id")
    .single();

  if (headerError || !invoice) {
    return { error: headerError?.message ?? "Could not create the invoice." };
  }
  const invoiceId = invoice.id as string;

  const drafts = invoiceLinesFromExtraction(extraction);
  if (drafts.length > 0) {
    const { error: lineError } = await supabase.from("vendor_invoice_lines").insert(
      drafts.map((line) => ({ ...line, org_id: orgId, invoice_id: invoiceId }))
    );
    if (lineError) {
      // The header stands. An invoice with no lines is a visible, fixable state
      // — the same one a hand-typed rent bill is in — so this reports rather
      // than unwinding a record someone can already see and correct.
      return { error: `Filed the invoice, but its lines failed: ${lineError.message}` };
    }
  }

  // Link what the matcher can pair. The invoice is filed either way: a linked
  // invoice and an unlinked one are both valid records, and "Link to PO…" is
  // there for whatever this misses.
  if (order && drafts.length > 0) {
    const linkError = await linkMatchedLines(supabase, {
      invoiceId,
      order,
      extraction,
    });
    if (linkError) return { error: `Filed the invoice, but linking failed: ${linkError}` };
  }

  const { error: flagError } = await supabase
    .from("purchase_order_attachments")
    .update({ invoice_id: invoiceId })
    .eq("id", attachmentId);
  if (flagError) {
    return { error: `Filed the invoice, but could not tag the file: ${flagError.message}` };
  }

  return { invoiceId };
}

/**
 * Write the matcher's pairing onto the invoice's lines.
 *
 * The matcher works over the EXTRACTION's lines, and the rows we just inserted
 * are in that same order with `line_no` counting from 1 — which is what lets a
 * match on the reading be turned into an update on a row without a second join.
 */
async function linkMatchedLines(
  supabase: SupabaseClient,
  {
    invoiceId,
    order,
    extraction,
  }: { invoiceId: string; order: InvoiceCreationOrder; extraction: InvoiceExtraction }
): Promise<string | null> {
  const { matches } = matchInvoiceToOrder(order.lines, extraction.lines);

  // Which printed line each match came from, so the update can find its row.
  const indexOf = new Map(extraction.lines.map((line, i) => [line, i + 1]));

  const { data: rows, error } = await supabase
    .from("vendor_invoice_lines")
    .select("id, line_no")
    .eq("invoice_id", invoiceId);
  if (error) return error.message;

  const rowByLineNo = new Map<number, string>();
  for (const r of rows ?? []) {
    if (r.line_no !== null) rowByLineNo.set(Number(r.line_no), r.id as string);
  }

  for (const match of matches) {
    if (!match.invoice) continue;
    const lineNo = indexOf.get(match.invoice);
    if (lineNo === undefined) continue;
    const rowId = rowByLineNo.get(lineNo);
    if (!rowId) continue;

    const { error: updateError } = await supabase
      .from("vendor_invoice_lines")
      .update({
        purchase_order_id: order.id,
        purchase_order_item_id: match.line.id,
      })
      .eq("id", rowId);
    if (updateError) return updateError.message;
  }
  return null;
}
