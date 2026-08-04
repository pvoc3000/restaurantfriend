// Reading one invoice, everything the detail screen needs — the shape
// lib/purchaseOrderQueries.ts established for a purchase order.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type PoAttachment,
  type SignedAttachment,
} from "./attachments";
import type { VendorInvoice, VendorInvoiceLine } from "./invoices";
import { PO_LINE_SELECT } from "./purchaseOrderQueries";
import type { PoLine } from "./purchaseOrders";

export const INVOICE_SELECT = `id, org_id, location_id, vendor_id, invoice_number,
   invoice_date, due_date, terms, subtotal, tax, freight, other_charges, total,
   is_credit, status, approved_at, approved_by, source, notes,
   vendors ( id, name, order_type )`;

export const INVOICE_LINE_SELECT = `id, invoice_id, purchase_order_id,
   purchase_order_item_id, line_no, product_id, alt_product_id, description,
   pack, qty, unit_price, extended, kind, notes`;

export type InvoiceWithLines = {
  invoice:
    | (VendorInvoice & {
        vendors: { id: string; name: string; order_type: string } | null;
      })
    | null;
  lines: VendorInvoiceLine[];
  error: string | null;
  lineError: string | null;
};

/**
 * The invoice and its lines in one round trip's worth of wall clock.
 *
 * `Promise.all`, not two awaits: a Supabase query builder is a lazy thenable,
 * so these only go on the wire when awaited, and awaiting them together is the
 * difference between one round trip and two.
 */
export async function fetchInvoiceWithLines(
  supabase: SupabaseClient,
  id: string
): Promise<InvoiceWithLines> {
  const [{ data: invoice, error }, { data: lines, error: lineError }] =
    await Promise.all([
      supabase.from("vendor_invoices").select(INVOICE_SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("vendor_invoice_lines")
        .select(INVOICE_LINE_SELECT)
        .eq("invoice_id", id)
        .order("line_no"),
    ]);

  return {
    invoice: (invoice ?? null) as InvoiceWithLines["invoice"],
    lines: (lines ?? []) as unknown as VendorInvoiceLine[],
    error: error?.message ?? null,
    lineError: lineError?.message ?? null,
  };
}

/**
 * The documents filed under this invoice, with somewhere to look at them.
 *
 * Signed SERVER-side in one `createSignedUrls` batch: one round trip instead of
 * one per card, and a URL built to expire doesn't outlive the page.
 *
 * Returns the error rather than throwing — a screen that can't read its
 * documents must still be able to show and approve the bill.
 */
export async function fetchInvoiceDocuments(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<{ attachments: SignedAttachment[]; error: string | null }> {
  const { data, error } = await supabase
    .from("purchase_order_attachments")
    .select(
      `id, po_id, invoice_id, storage_path, kind, file_name, content_type,
       byte_size, created_at, extraction, extracted_at, extraction_model`
    )
    .eq("invoice_id", invoiceId)
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

export type LinkedPurchaseOrder = {
  id: string;
  po_number: string;
  order_date: string;
  status: string;
  lines: PoLine[];
};

/**
 * The purchase orders this invoice's lines point at — DERIVED from the lines,
 * never a column on the header.
 *
 * That is the whole shape of the many-to-many (migration 025): an invoice
 * covering two orders is lines pointing at two orders, so this is a `distinct`
 * over one indexed column rather than a join table that could disagree with
 * the lines it claims to summarize.
 *
 * Their LINES come too, because the three-way match — ordered, received,
 * billed — is what approval is for, and it can only be computed against them.
 */
export async function fetchLinkedOrders(
  supabase: SupabaseClient,
  lines: VendorInvoiceLine[]
): Promise<{ orders: LinkedPurchaseOrder[]; error: string | null }> {
  const ids = [
    ...new Set(
      lines.map((l) => l.purchase_order_id).filter((id): id is string => Boolean(id))
    ),
  ];
  if (ids.length === 0) return { orders: [], error: null };

  // Overlapped: a Supabase builder is a lazy thenable, so `.then()` on the
  // first is what puts both on the wire together rather than one after the
  // other. `po_id` is named alongside PO_LINE_SELECT so the lines can be
  // grouped without a third query for the ownership they already carry.
  const ordersPromise = supabase
    .from("purchase_orders")
    .select("id, po_number, order_date, status")
    .in("id", ids)
    .then((r) => r);
  const { data: poLines, error: lineError } = await supabase
    .from("purchase_order_items")
    .select(`po_id, ${PO_LINE_SELECT}`)
    .in("po_id", ids);
  const { data: orders, error } = await ordersPromise;

  if (error || lineError) {
    return { orders: [], error: (error ?? lineError)!.message };
  }

  const byOrder = new Map<string, PoLine[]>();
  for (const row of (poLines ?? []) as unknown as (PoLine & { po_id: string })[]) {
    const { po_id, ...line } = row;
    byOrder.set(po_id, [...(byOrder.get(po_id) ?? []), line as PoLine]);
  }

  return {
    orders: (orders ?? []).map((o) => ({
      id: o.id as string,
      po_number: o.po_number as string,
      order_date: o.order_date as string,
      status: o.status as string,
      lines: byOrder.get(o.id as string) ?? [],
    })),
    error: null,
  };
}

/**
 * Other invoices at this vendor, for the duplicate check.
 *
 * Vendor-scoped and unbounded by location: the same bill uploaded twice at two
 * shops is still the same bill, and paying it twice is the mistake this whole
 * check exists to prevent.
 */
export async function fetchDuplicateCandidates(
  supabase: SupabaseClient,
  { orgId, vendorId }: { orgId: string; vendorId: string }
): Promise<(VendorInvoice & { status: VendorInvoice["status"] })[]> {
  const { data } = await supabase
    .from("vendor_invoices")
    .select("id, vendor_id, invoice_number, invoice_date, total, status, is_credit")
    .eq("org_id", orgId)
    .eq("vendor_id", vendorId)
    .limit(500);
  return (data ?? []) as unknown as VendorInvoice[];
}
