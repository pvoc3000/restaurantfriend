// Writes that move a purchase order's STATUS, where more than one screen makes
// them. The status vocabulary itself is `lib/purchaseOrders`.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mark orders received — the PO list's Mark ▸ Received and PO detail's
 * Mark PO ▸ Received, one write so the two can't come to mean different things.
 *
 * It writes QUANTITIES, not just the status, because a status-only "received"
 * is a lie the list would then report: its Received column flags any received
 * PO whose total falls short of what was ordered, so flipping the status alone
 * paints every order red for a shortfall that never happened. "Received" means
 * the delivery landed, so the lines say so.
 *
 * Only lines with NO received quantity are filled. Anything already counted —
 * a short case someone recorded on the detail screen — is a measurement, and
 * this must not overwrite it.
 *
 * NOT what attaching paperwork does (`useAttachmentActions`): that moves the
 * status alone, because an invoice on file says the delivery came, not what
 * was in it — the counts come from reconciling against it.
 */
export async function markPurchaseOrdersReceived(
  supabase: SupabaseClient,
  ids: readonly string[]
): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };
  const { data: lines, error: lineError } = await supabase
    .from("purchase_order_items")
    .select("id, qty_ordered")
    .in("po_id", ids)
    .is("qty_received", null);
  if (lineError) return { error: lineError.message };

  // PostgREST can't say "set qty_received = qty_ordered", and one request per
  // line would be hundreds on a Friday. Ordered quantities are a tiny set of
  // small numbers, so grouping by value costs a handful of requests.
  const byQty = new Map<number, string[]>();
  for (const l of lines ?? []) {
    const q = Number(l.qty_ordered);
    byQty.set(q, [...(byQty.get(q) ?? []), l.id]);
  }
  for (const [q, lineIds] of byQty) {
    const { error } = await supabase
      .from("purchase_order_items")
      .update({ qty_received: q })
      .in("id", lineIds);
    if (error) return { error: error.message };
  }

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "received" })
    .in("id", ids as string[]);
  return { error: error?.message ?? null };
}
