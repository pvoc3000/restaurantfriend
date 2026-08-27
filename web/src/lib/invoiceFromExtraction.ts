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
  blankHeaderFields,
  filedInvoiceFor,
  invoiceHeaderFromExtraction,
  invoiceLinesFromExtraction,
  unfiledLines,
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
  /** `joined` when this reading was filed against an invoice that already
   *  existed, rather than becoming a new one. */
  | { invoiceId: string; joined: boolean }
  | { error: string };

/**
 * File every reading on an order that isn't recorded as a bill yet, and say
 * what happened in one sentence.
 *
 * Two screens accept this offer — the receiving screen's Complete and PO
 * detail's Close order / File as bill — and they must not each decide for
 * themselves what "file the paperwork" does. On a multi-page invoice the second
 * page JOINS the first (see `filedInvoiceFor` and `absorbIntoInvoice`), so
 * filing three documents can quite correctly produce one bill; the sentence
 * counts BILLS rather than documents, because that is what the person is about
 * to be responsible for paying.
 */
export async function fileReadings(
  supabase: SupabaseClient,
  {
    orgId,
    order,
    readings,
  }: {
    orgId: string;
    order: InvoiceCreationOrder | null;
    readings: { id: string; extraction: InvoiceExtraction }[];
  }
): Promise<{ filed: number; error?: string }> {
  const invoices = new Set<string>();
  for (const reading of readings) {
    const result = await createInvoiceFromReading(supabase, {
      orgId,
      attachmentId: reading.id,
      extraction: reading.extraction,
      order,
      fallback: null,
    });
    // Stop at the first failure rather than pressing on: the ones already filed
    // stand (each is its own transaction), and a second error would only bury
    // the first. What is left unfiled is still visible and still offered.
    if ("error" in result) {
      return { filed: invoices.size, error: result.error };
    }
    invoices.add(result.invoiceId);
  }
  return { filed: invoices.size };
}

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
 *
 * THAT FLAG WAS THE ONLY GUARD AND IT IS PER-FILE, which is why duplicates
 * happened anyway (Mark, 2026-08-27, and confirmed on the live database: 7
 * numbers on file more than once, so 49 filings had produced 49 records where
 * they should have produced 41). It cannot
 * see a second COPY of the same invoice — two files, two rows, two nulls — and
 * it cannot see the same invoice read on a second order. Both are ordinary: a
 * retaken photo, a second page saved separately, a consolidated invoice
 * covering two POs.
 *
 * There are now two guards in front of it, in this order:
 *
 *   0a. the attachment's flag is RE-READ from the database rather than taken
 *       from the caller's props. `router.refresh()` is in flight for a second
 *       or two after a file, so a second Read in that window sees a stale null
 *       — and since step 4 is last-writer-wins, the earlier invoice is orphaned
 *       rather than found. Eight of the live duplicates had no attachment
 *       pointing at them at all, which is that race's signature.
 *   0b. an invoice already on file under the same vendor and number is JOINED,
 *       not duplicated — see `filedInvoiceFor`, which is the certain half of
 *       the warning the detail screen already shows a human.
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

  // 0a. What does the DATABASE say this document is filed under? The caller's
  // copy can be a refresh behind, and acting on it is how an invoice ends up
  // with nothing pointing at it.
  const { data: current, error: currentError } = await supabase
    .from("purchase_order_attachments")
    .select("invoice_id")
    .eq("id", attachmentId)
    .single();
  if (currentError) {
    return { error: `Could not check whether this file is already filed: ${currentError.message}` };
  }
  if (current?.invoice_id) {
    return { invoiceId: current.invoice_id as string, joined: true };
  }

  const header = invoiceHeaderFromExtraction(extraction);

  // 0b. Is this bill already on record? Same vendor, same number — the one
  // signal certain enough to act on without asking.
  //
  // Bounded and ordered NEWEST FIRST on purpose. PostgREST truncates a select
  // at 1,000 rows and says nothing about it, so a busy vendor would one day
  // start silently missing matches; asking for the most recent 1,000 makes the
  // cut-off harmless instead, because a second copy of a bill is filed days
  // after the first, never years.
  const { data: onFile, error: onFileError } = await supabase
    .from("vendor_invoices")
    .select("id, vendor_id, invoice_number, status, is_credit")
    .eq("org_id", orgId)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (onFileError) {
    return { error: `Could not check for an existing invoice: ${onFileError.message}` };
  }
  const existing = filedInvoiceFor(
    { vendor_id: vendorId, invoice_number: header.invoice_number, is_credit: header.is_credit },
    onFile ?? []
  );
  if (existing) {
    const joinError = await absorbIntoInvoice(supabase, {
      orgId,
      invoiceId: existing.id,
      extraction,
      header,
      order,
    });
    if (joinError) {
      return { error: `Filed against invoice ${existing.invoice_number ?? ""}, but ${joinError}` };
    }
    const { error: tagError } = await supabase
      .from("purchase_order_attachments")
      .update({ invoice_id: existing.id })
      .eq("id", attachmentId);
    if (tagError) {
      return { error: `Found the invoice already on file, but could not tag this file: ${tagError.message}` };
    }
    return { invoiceId: existing.id, joined: true };
  }

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

  return { invoiceId, joined: false };
}

/**
 * Fold a reading into an invoice that already exists — ANOTHER PAGE of a bill
 * this record already holds, or another copy of a page it holds already.
 *
 * This is the other half of joining, and without it joining would be a
 * different bug rather than a fix. Chefs Warehouse 73535581 at DF02 is the
 * worked example: two pages scanned and attached separately, the totals block
 * printed on both, so each page read as the whole $394.16 bill and each became
 * its own record — one holding 4 lines, the other 7. Matching them on the
 * header and stopping there would leave one record holding 4 of the 11 lines,
 * and seven lines would vanish without a word.
 *
 * Three writes, each of which only ever ADDS:
 *
 *   1. the lines this record does not already hold (`unfiledLines`, a multiset
 *      so a repeated item is not mistaken for a repeated page),
 *   2. header fields that are still blank (`blankHeaderFields`) — a later page
 *      often carries the totals and the due date, and never overwrites what is
 *      already there,
 *   3. the order links, on lines that have none.
 *
 * Nothing here replaces a value. A record that has been read once has been seen
 * by somebody, and a second page is not entitled to revise it.
 */
async function absorbIntoInvoice(
  supabase: SupabaseClient,
  {
    orgId,
    invoiceId,
    extraction,
    header,
    order,
  }: {
    orgId: string;
    invoiceId: string;
    extraction: InvoiceExtraction;
    header: ReturnType<typeof invoiceHeaderFromExtraction>;
    order: InvoiceCreationOrder | null;
  }
): Promise<string | null> {
  const { data: held, error: heldError } = await supabase
    .from("vendor_invoice_lines")
    .select("line_no, product_id, alt_product_id, description, qty, unit_price, extended")
    .eq("invoice_id", invoiceId);
  if (heldError) return `could not read its lines: ${heldError.message}`;

  const fresh = unfiledLines(held ?? [], invoiceLinesFromExtraction(extraction));
  if (fresh.length > 0) {
    const { error } = await supabase
      .from("vendor_invoice_lines")
      .insert(fresh.map((line) => ({ ...line, org_id: orgId, invoice_id: invoiceId })));
    if (error) return `its extra lines failed: ${error.message}`;
  }

  const { data: current, error: currentError } = await supabase
    .from("vendor_invoices")
    .select("invoice_number, invoice_date, due_date, terms, subtotal, tax, freight, other_charges, total")
    .eq("id", invoiceId)
    .single();
  if (currentError) return `could not read it: ${currentError.message}`;

  const patch = blankHeaderFields(current as Record<string, unknown>, header);
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("vendor_invoices").update(patch).eq("id", invoiceId);
    if (error) return `filling in its blanks failed: ${error.message}`;
  }

  // Receiving reads the lines that name ITS purchase order, so a joined invoice
  // with no links would leave the second order of a consolidated invoice with
  // no invoice at all — worse than the duplicate this replaces.
  if (order) {
    const linkError = await linkMatchedLines(supabase, { invoiceId, order, extraction });
    if (linkError) return `linking failed: ${linkError}`;
  }
  return null;
}

/**
 * Write the matcher's pairing onto the invoice's lines.
 *
 * The matcher works over the EXTRACTION's lines, and the rows inserted above
 * are in that same order with `line_no` counting from 1 — which is what lets a
 * match on the reading be turned into an update on a row without a second join.
 *
 * IT ONLY EVER FILLS AN EMPTY LINK, never replaces one. On a fresh invoice
 * every line is empty and this is invisible; it earns its keep on the JOIN
 * path, where the invoice already exists and some of its lines already name
 * the FIRST order they were read on. A consolidated invoice covering two POs
 * is the case the many-to-many was designed for (migration 025 puts the link
 * on the LINE for exactly this), and it only works if the second reading adds
 * to the first rather than dragging every line onto whichever order was read
 * last.
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
    .select("id, line_no, purchase_order_id")
    .eq("invoice_id", invoiceId);
  if (error) return error.message;

  const rowByLineNo = new Map<number, string>();
  for (const r of rows ?? []) {
    // Already claimed by an order — leave it. See the note above.
    if (r.purchase_order_id) continue;
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
