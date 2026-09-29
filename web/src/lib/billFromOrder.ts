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

import type { SupabaseClient } from "@supabase/supabase-js";
import { computedAmounts, lineExtended } from "./bills";
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
  }: {
    orgId: string;
    order: { id: string; vendor_id: string; location_id: string; lines: PoLine[] };
    invoiceDate: string;
  }
): Promise<{ billId: string; error?: string } | { error: string }> {
  const drafts = billLinesFromOrder(order.id, order.lines);
  const { subtotal, total } = computedAmounts(drafts, {
    tax: null,
    freight: null,
    other_charges: null,
    discount: null,
  });

  const { data: bill, error: headerError } = await supabase
    .from("vendor_bills")
    .insert({
      org_id: orgId,
      location_id: order.location_id,
      vendor_id: order.vendor_id,
      invoice_date: invoiceDate,
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
  return { billId };
}
