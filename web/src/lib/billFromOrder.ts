// Turning a purchase order into a bill — the path for an order whose vendor
// sent no paperwork worth reading, or none at all.
//
// The other path, `billFromExtraction`, builds the record from the VENDOR'S
// page. This one builds it from OURS: the order's own lines at the quantities
// that arrived and the prices on the line. So it is a proposal of what we
// expect to be billed, not a transcription of what we were billed — it has no
// invoice number (that is the vendor's, typed on the bill once it's known),
// and `source` stays 'manual', because the record did not come from a reading.
//
// Same shape as billFromExtraction: the Supabase client is a parameter, and
// the arithmetic is a pure function the fixtures can reach.
//
// THE HEADER COMES FROM THE VENDOR'S PAGE WHEN THE ORDER HAS ONE (Mark,
// 2026-09-29: an order closed before its invoice was attached, the invoice
// then attached, read and reconciled, and Generate Bill made a bill with no
// number). A reading nobody has filed yet is the vendor's own statement of the
// number, the dates, the terms and the charges, so the bill takes those from
// it — the LINES still come from the reconciled order — and the reading is
// tagged with the new bill, which files it: File as Bill stops offering it,
// and the bill screen shows the document and checks its total against it.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computedAmounts,
  invoiceHeaderFromExtraction,
  lineExtended,
  normalizeInvoiceNumber,
  type BillHeaderDraft,
} from "./bills";
import type { InvoiceExtraction } from "./invoiceExtraction";
import type { PoLine } from "./purchaseOrders";

export type BillLineFromOrder = {
  purchase_order_id: string;
  purchase_order_item_id: string;
  line_no: number;
  product_id: string | null;
  description: string | null;
  pack: string | null;
  qty: number;
  unit_price: number | null;
  extended: number | null;
  kind: "item";
};

/**
 * The bill's lines, one per order line that was billable.
 *
 * THE QUANTITY IS WHAT ARRIVED, falling back to what was ordered only where
 * nobody has counted — the same reading receiving's "Mark received" applies.
 * A line counted at 0 is LEFT OFF: nothing came, so nothing is owed, and a $0
 * line would only be a row somebody has to read past.
 */
export function billLinesFromOrder(
  orderId: string,
  lines: PoLine[]
): BillLineFromOrder[] {
  const out: BillLineFromOrder[] = [];
  for (const l of lines) {
    const qty = Number(l.qty_received ?? l.qty_ordered ?? 0);
    if (!(qty > 0)) continue;
    const unitPrice = l.unit_price === null ? null : Number(l.unit_price);
    out.push({
      purchase_order_id: orderId,
      purchase_order_item_id: l.id,
      line_no: out.length + 1,
      product_id: l.product_id,
      description: l.description ?? l.vendor_items?.inventory_items?.name ?? null,
      pack: l.package_desc,
      qty,
      unit_price: unitPrice,
      extended: lineExtended(qty, unitPrice),
      kind: "item",
    });
  }
  return out;
}

export type HeaderFromReadings =
  | { header: BillHeaderDraft; attachmentIds: string[] }
  | { header: null; reason: string | null };

/**
 * The bill's header, from the order's unfiled readings.
 *
 * ONE INVOICE OR NONE. Readings naming two different numbers are two bills —
 * a split delivery, or a consolidated bill's pages — and one bill made from
 * the whole order cannot be both, so it takes neither and says why; File as
 * Bill is the path that files each against its own record. A reading with no
 * printed number is taken only when it is the only one: beside a numbered
 * page it may be that page's second sheet or a different document entirely,
 * and there is nothing to tell which. A CREDIT reading is not a bill for this
 * order's goods, so it is never the header.
 *
 * Several pages of one invoice fill each other's BLANKS, in the order given —
 * page one's figures stand and a later page only supplies what it lacked,
 * `blankHeaderFields`' rule.
 */
export function headerFromReadings(
  readings: { id: string; extraction: InvoiceExtraction }[]
): HeaderFromReadings {
  const bills = readings
    .map((r) => ({ id: r.id, header: invoiceHeaderFromExtraction(r.extraction) }))
    .filter((r) => !r.header.is_credit);
  if (bills.length === 0) return { header: null, reason: null };

  const numbers = new Set(
    bills.map((b) => normalizeInvoiceNumber(b.header.invoice_number)).filter((n) => n !== null)
  );
  if (numbers.size > 1) {
    return {
      header: null,
      reason: `The order holds ${numbers.size} vendor invoices, so the bill takes no number from them.`,
    };
  }
  const [number] = [...numbers];
  const pages =
    number === undefined
      ? bills.length === 1
        ? bills
        : []
      : bills.filter((b) => normalizeInvoiceNumber(b.header.invoice_number) === number);
  if (pages.length === 0) return { header: null, reason: null };

  const header = { ...pages[0].header };
  for (const page of pages.slice(1)) {
    for (const key of Object.keys(header) as (keyof BillHeaderDraft)[]) {
      if (header[key] === null) (header as Record<string, unknown>)[key] = page.header[key];
    }
  }
  return { header, attachmentIds: pages.map((p) => p.id) };
}

/** The bills already holding lines of this order, void ones excluded. */
export async function billsForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ bills: { id: string; invoice_number: string | null }[]; error?: string }> {
  const { data, error } = await supabase
    .from("vendor_bill_lines")
    .select("bill_id, vendor_bills(invoice_number, status)")
    .eq("purchase_order_id", orderId);
  if (error) return { bills: [], error: error.message };
  const seen = new Map<string, string | null>();
  for (const row of (data ?? []) as unknown as {
    bill_id: string;
    vendor_bills: { invoice_number: string | null; status: string } | null;
  }[]) {
    if (row.vendor_bills?.status === "void") continue;
    seen.set(row.bill_id, row.vendor_bills?.invoice_number ?? null);
  }
  return { bills: [...seen].map(([id, invoice_number]) => ({ id, invoice_number })) };
}

/**
 * Create the bill: header first, then the lines in one insert — the order
 * `createBillFromReading` uses, for its reason: a failed line insert leaves an
 * EMPTY bill, which is visible and fixable, where lines first would leave
 * orphans.
 */
export async function createBillFromOrder(
  supabase: SupabaseClient,
  {
    orgId,
    order,
    invoiceDate,
    fromReading = null,
  }: {
    orgId: string;
    order: { id: string; vendor_id: string; location_id: string; lines: PoLine[] };
    /** When the reading has no date of its own — the delivery date, or today. */
    invoiceDate: string;
    /** `headerFromReadings`' answer, when it had one. */
    fromReading?: { header: BillHeaderDraft; attachmentIds: string[] } | null;
  }
): Promise<{ billId: string; error?: string } | { error: string }> {
  const drafts = billLinesFromOrder(order.id, order.lines);
  const printed = fromReading?.header ?? null;
  // The CHARGES are the page's; the subtotal and total are computed from the
  // order's lines plus those charges, the bill screen's own arithmetic. The
  // printed total is not lost — the tagged reading carries it, and approval
  // compares against it.
  const charges = {
    tax: printed?.tax ?? null,
    freight: printed?.freight ?? null,
    other_charges: printed?.other_charges ?? null,
    discount: null,
  };
  const { subtotal, total } = computedAmounts(drafts, charges);

  const { data: bill, error: headerError } = await supabase
    .from("vendor_bills")
    .insert({
      org_id: orgId,
      location_id: order.location_id,
      vendor_id: order.vendor_id,
      invoice_number: printed?.invoice_number ?? null,
      invoice_date: printed?.invoice_date ?? invoiceDate,
      due_date: printed?.due_date ?? null,
      terms: printed?.terms ?? null,
      tax: charges.tax,
      freight: charges.freight,
      other_charges: charges.other_charges,
      subtotal,
      total,
      is_credit: false,
      status: "open",
      source: "manual",
    })
    .select("id")
    .single();
  if (headerError || !bill) {
    return { error: headerError?.message ?? "Could not create the bill." };
  }
  const billId = bill.id as string;

  if (drafts.length > 0) {
    const { error: lineError } = await supabase
      .from("vendor_bill_lines")
      .insert(drafts.map((line) => ({ ...line, org_id: orgId, bill_id: billId })));
    if (lineError) {
      return { billId, error: `Created the bill, but its lines failed: ${lineError.message}` };
    }
  }

  // LAST, `createBillFromReading`'s rule: the tag is what stops the reading
  // being filed a second time, so it is set only once the bill it names exists.
  if (fromReading && fromReading.attachmentIds.length > 0) {
    const { data: tagged, error: tagError } = await supabase
      .from("purchase_order_attachments")
      .update({ bill_id: billId })
      .in("id", fromReading.attachmentIds)
      .select("id");
    if (tagError || (tagged ?? []).length === 0) {
      return {
        billId,
        error: `Created the bill, but could not file the vendor's invoice with it: ${
          tagError?.message ?? "nothing was updated"
        }. Don't use File as Bill on this order — it would make a second bill.`,
      };
    }
  }
  return { billId };
}
