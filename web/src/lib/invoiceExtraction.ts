// What the invoice says, as read off an attachment by the `extract-invoice`
// edge function (migration 019 stores it on `purchase_order_attachments`).
//
// **This is a PROPOSAL, never a measurement.** Everything here is a machine's
// reading of a photograph. It gets compared against the order and offered to a
// human; nothing in it becomes a received quantity or a price without someone
// accepting it. Render it in a register that says so — see reconcile mode on
// PO detail.
//
// The shape is declared twice on purpose: here, and as the json_schema the
// model is held to in supabase/functions/extract-invoice/index.ts. A Deno edge
// function can't import from `web/`, so the contract is written on both sides —
// change one and change the other.

export type InvoiceLine = {
  /** The SUPPLIER's SKU, as printed. The join key — see lib/invoiceMatch. */
  product_id: string | null;
  description: string;
  qty: number | null;
  unit_price: number | null;
  extended: number | null;
  pack: string | null;
};

export type InvoiceExtraction = {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
  lines: InvoiceLine[];
  /**
   * The reader's own caveats, in its own words — anything illegible, but also
   * anything it had to make a judgement about: which of two printed item
   * numbers it treated as the SKU, why a line's arithmetic doesn't close.
   * Shown, not swallowed.
   */
  notes: string | null;
  /** What `notes` was called before 2026-07-31, when the field was only for
   *  illegible text. Read through `extractionNotes`, never directly. */
  unreadable?: string | null;
};

/** The reader's notes, whichever key this extraction was stored under. */
export function extractionNotes(e: InvoiceExtraction): string | null {
  return e.notes ?? e.unreadable ?? null;
}

/**
 * What one of these cost, in the units the ORDER counts in.
 *
 * Derived from the line total rather than taken from the invoice's own unit
 * price column, which sounds backwards and isn't. A distributor invoice often
 * prints two rates per line — a per-pound or per-each figure for catch-weight
 * goods, and the case total — and which one lands in the "unit price" column
 * varies by line. Measured against Chefs' Warehouse invoice 73341407
 * (2026-07-31): `extended ÷ qty` reproduced the purchase order's own unit price
 * exactly on 13 of 19 lines, while the printed unit price agreed on 6.
 *
 * `extended` is the number the vendor is actually charging for that line, so
 * dividing it by the quantity billed gives the per-unit price in our terms —
 * whatever unit the vendor happened to quote.
 */
export function invoiceUnitPrice(line: InvoiceLine): number | null {
  if (line.extended !== null && line.qty !== null && line.qty !== 0) {
    return line.extended / line.qty;
  }
  return line.unit_price;
}

/**
 * The invoice's own arithmetic doesn't close: qty × printed unit price is not
 * the printed line total.
 *
 * Usually that means a catch-weight line (billed by actual pounds, not by the
 * case) or a second rate column the reading conflated — either way it's a line
 * where the price is worth a human's eye before it's adopted, so the UI marks
 * it rather than quietly presenting a derived number as fact.
 */
export function printedPriceDisagrees(line: InvoiceLine): boolean {
  if (line.unit_price === null || line.qty === null || line.extended === null) {
    return false;
  }
  return Math.abs(line.unit_price * line.qty - line.extended) > 0.02;
}

/**
 * Anything less than half a cent apart is the same price, and anything less
 * than a thousandth apart is the same quantity — floating point and a scanned
 * "4.00" should not read as a discrepancy.
 */
export function priceDiffers(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) > 0.005;
}

export function qtyDiffers(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) > 0.001;
}
