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
  /**
   * A SECOND number printed for the same line, when the page carries more than
   * one identifier column.
   *
   * Not a nicety. A distributor running SAP prints its catalog number AND an
   * internal MATERIAL number, and which of the two is the number WE ordered
   * under varies line by line: Dawn invoice 96461403 printed our SKU under
   * PRODUCT ID on one line and under MATERIAL on the other three. With a single
   * field the reader has to choose a column, and on that invoice the right
   * answer for three of four lines sat on the page unused.
   *
   * Optional in this type and required in the edge function's schema, for the
   * same reason `ship_date` is: readings stored before 2026-08-04 don't carry
   * it, and they stay valid — those lines simply match the way they did.
   */
  alt_product_id?: string | null;
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
  /**
   * When the goods MOVED, if the invoice prints such a field (Ship Date,
   * Delivered, Service Date). Optional in this type and required in the edge
   * function's schema, which is not a contradiction: every invoice read before
   * 2026-08-03 was stored without the key, and those readings stay valid — the
   * date simply isn't offered until that invoice is read again. Same treatment
   * `unreadable` gets below.
   */
  ship_date?: string | null;
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

/**
 * The number this invoice line can be paired ON, if any.
 *
 * Manual match works by copying a number onto the PO line so the ordinary join
 * finds it, so a line printing NO number can't be paired at all — that's what
 * the receiving screen greys out, and why it says so in words. Either column
 * will do: on an invoice with two identifier columns, the one we ordered under
 * may be in either.
 */
export function matchableSku(line: InvoiceLine): string | null {
  return line.product_id ?? line.alt_product_id ?? null;
}

/** The reader's notes, whichever key this extraction was stored under. */
export function extractionNotes(e: InvoiceExtraction): string | null {
  return e.notes ?? e.unreadable ?? null;
}

export type InvoiceDeliveryDate = {
  /** A real calendar date in YYYY-MM-DD — safe to put in a `date` column. */
  date: string;
  /**
   * Which field it was printed under. The UI labels it, because "the day it
   * shipped" and "the day they billed us" are different claims and taking the
   * second one as a delivery date is a judgement the person tapping should be
   * making knowingly.
   */
  source: "ship" | "invoice";
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date string only if it's a real date.
 *
 * The json_schema holds the model to a STRING; nothing enforces the format, and
 * nothing at all stops it reading 09/13 off a page and calling it 2026-13-09.
 * `purchase_orders.delivery_date` is a `date` column, so an unchecked value
 * comes back as a raw Postgres error at the receiving desk.
 *
 * The round-trip is the part that matters: `new Date("2026-02-31")` does not
 * fail, it rolls over to March 2nd. Formatting the parsed date back and
 * comparing is what catches a day that doesn't exist.
 */
function isoDate(raw: string | null | undefined): string | null {
  if (!raw || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * The date this invoice offers as the day the delivery happened.
 *
 * Ship date first, invoice date second. The fallback is deliberate rather than
 * lax: most distributor invoices print only one date, and for a same-day
 * delivery-and-invoice vendor it IS the delivery day — but it's a weaker claim,
 * so it travels with its `source` and the screen says which one you're taking.
 * Neither is ever written without someone tapping it.
 */
export function invoiceDeliveryDate(e: InvoiceExtraction): InvoiceDeliveryDate | null {
  const shipped = isoDate(e.ship_date);
  if (shipped) return { date: shipped, source: "ship" };
  const invoiced = isoDate(e.invoice_date);
  if (invoiced) return { date: invoiced, source: "invoice" };
  return null;
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
