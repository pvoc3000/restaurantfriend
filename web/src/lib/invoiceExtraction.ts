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
  /** What the model couldn't read, in its own words. Shown, not swallowed. */
  unreadable: string | null;
};

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
