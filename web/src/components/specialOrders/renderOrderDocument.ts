import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderDocData, type DocumentKind } from "@/lib/specialOrderDocs";

/**
 * Render one of a special order's documents to a PDF, in the browser.
 *
 * EXTRACTED so `SendDocument` and `PushOrderToQuickBooks` cannot render the
 * customer's copy two different ways (2026-09-02). @react-pdf needs a DOM, so
 * this only ever runs client-side, and both imports stay dynamic — the renderer
 * is large and neither caller should pay for it until somebody presses
 * something.
 *
 * It lives beside the PDFs rather than in `lib/`: `lib` is pure and is compiled
 * into the Node fixture run, so importing a component tree from there would
 * drag the whole renderer in behind it.
 */
export async function renderOrderDocument(
  supabase: SupabaseClient,
  orderId: string,
  kind: DocumentKind,
  /** The org's own today, for the kitchen sheet's AS OF line. */
  today: string
) {
  const [{ pdf }, docs, data] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./pdf/SpecialOrderPdfs"),
    fetchOrderDocData(supabase, [orderId]),
  ]);
  if (data.orders.length === 0) throw new Error("Order not found");
  const order = data.orders[0];
  const blob = await pdf(docs.documentElement(kind, [order], data.org, null, today)).toBlob();
  return { blob, order, org: data.org };
}

/** A PDF as base64, for posting to an edge function — `send-po-email`'s route,
 *  and the only one for a document that is stored nowhere. Chunked, because
 *  `String.fromCharCode(...bytes)` on a few hundred KB overflows the stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
