// The queries behind a single purchase order — its header, its lines, and its
// paperwork — shared by PO detail and the receiving screen.
//
// This file exists because two screens now load the same order. Duplicating the
// selects would let them drift, and the drift that matters is silent: a screen
// that forgets to join `vendor_items` still renders, it just stops knowing the
// catalog price and quietly offers no price button.
//
// It takes the Supabase client as a PARAMETER and never imports
// `lib/supabase/server`, the same shape as lib/poProcessing.ts. That keeps it
// callable from a server component, a script, or a test without dragging
// `next/headers` along.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type PoAttachment,
  type SignedAttachment,
} from "./attachments";
import type { PoLine, PurchaseOrder } from "./purchaseOrders";

export const PO_SELECT = `id, po_number, status, sent_via, order_date, delivery_date,
   notes, vendor_id, location_id, vendors ( id, name, order_type, url )`;

/**
 * `vendor_items` is joined for three things the line's own snapshot can't
 * answer:
 *
 * - the CURRENT catalog price, whose gap from the line's snapshot is the
 *   price-reconciliation prompt (spec §2 step 5);
 * - `package_desc` on the EMBED, which is the pack TYPE ("CS", "EA") — the
 *   line's own `package_desc` is migration 013's composed label ("12 × 32 oz")
 *   and reads as nonsense after a quantity ("1 12 × 32 oz");
 * - this location's price override, because design rule 6 resolves
 *   `vendor_item_location_prices` BEFORE `vendor_items.price`, and a screen that
 *   offers to "update the vendor price" had better write the one in force.
 */
export const PO_LINE_SELECT = `id, vendor_item_id, description, brand, product_id,
   package_desc, notes, qty_ordered, qty_received, unit_price, discrepancy_note,
   vendor_items ( id, price, package_desc, product_id,
                  vendor_item_location_prices ( location_id, price ),
                  inventory_items ( id, name, category ) )`;

export const PO_ATTACHMENT_SELECT = `id, po_id, invoice_id, storage_path, kind,
   file_name, content_type, byte_size, created_at, extraction, extracted_at,
   extraction_model`;

export type PoWithLines = {
  order: (PurchaseOrder & { vendors: { order_type: string; url: string | null } | null }) | null;
  lines: PoLine[];
  /** The header query failed — the screen has nothing to show. */
  error: string | null;
  /** The lines failed but the header didn't; the screen says so in place of the table. */
  lineError: string | null;
};

/**
 * The order and its lines in one round trip's worth of wall clock.
 *
 * `Promise.all` and not two awaits: a Supabase query builder is a lazy
 * thenable, so these only go on the wire when they're awaited, and awaiting
 * them together is the difference between one round trip and two.
 */
export async function fetchPoWithLines(
  supabase: SupabaseClient,
  id: string
): Promise<PoWithLines> {
  const [{ data: po, error }, { data: lines, error: lineError }] = await Promise.all([
    supabase.from("purchase_orders").select(PO_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("purchase_order_items")
      .select(PO_LINE_SELECT)
      .eq("po_id", id)
      .order("description"),
  ]);

  return {
    order: (po as PoWithLines["order"]) ?? null,
    lines: (lines ?? []) as unknown as PoLine[],
    error: error?.message ?? null,
    lineError: lineError?.message ?? null,
  };
}

/**
 * The order's paperwork, each row carrying somewhere to look at it.
 *
 * Signing happens HERE, on the server, in ONE batch call — not a round trip per
 * card on load, and a URL built to expire doesn't sit in the browser any longer
 * than the page does. `createSignedUrls` answers in request order and reports
 * per-object failures rather than throwing, so a single missing object costs
 * that one thumbnail and not the screen.
 *
 * Returns the error rather than throwing: a screen that can't read its
 * attachments must still be able to receive an order.
 */
export async function fetchSignedAttachments(
  supabase: SupabaseClient,
  poId: string
): Promise<{ attachments: SignedAttachment[]; error: string | null }> {
  const { data, error } = await supabase
    .from("purchase_order_attachments")
    .select(PO_ATTACHMENT_SELECT)
    .eq("po_id", poId)
    .order("created_at");

  if (error) return { attachments: [], error: error.message };

  const rows = (data ?? []) as unknown as PoAttachment[];
  if (rows.length === 0) return { attachments: [], error: null };

  const { data: signed } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(
      rows.map((a) => a.storage_path),
      SIGNED_URL_TTL_SECONDS
    );

  return {
    attachments: rows.map((a, i) => ({ ...a, url: signed?.[i]?.signedUrl ?? null })),
    error: null,
  };
}
