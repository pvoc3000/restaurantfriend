// Reading one invoice, everything the detail screen needs — the shape
// lib/purchaseOrderQueries.ts established for a purchase order.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type PoAttachment,
  type SignedAttachment,
} from "./attachments";
import type { InvoiceLine } from "./invoiceExtraction";
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
  /** Present on a link CANDIDATE, where matchPrintedPoNumber checks the scope;
   *  omitted on an already-linked order, where the scope is settled. */
  vendor_id?: string;
  location_id?: string;
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

export type OrderInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  /** This invoice's lines that point at THIS order, in the matcher's shape. */
  lines: (InvoiceLine & { purchase_order_item_id: string | null })[];
};

/**
 * The invoices filed against a purchase order — the receiving screen's
 * question, answered by the same index the invoice screen uses in reverse.
 *
 * The link lives on the LINE (migration 025), so this is a `distinct` over one
 * indexed column. Two invoices against one order is the backorder case and
 * needs no special handling: each brings its own lines.
 *
 * Only the lines pointing at THIS order come back. An invoice covering two
 * orders would otherwise offer the other order's lines to a matcher that has
 * no business seeing them.
 */
export async function fetchInvoicesForOrder(
  supabase: SupabaseClient,
  poId: string
): Promise<{ invoices: OrderInvoice[]; error: string | null }> {
  const { data: lines, error } = await supabase
    .from("vendor_invoice_lines")
    .select(
      `invoice_id, purchase_order_item_id, product_id, alt_product_id,
       description, qty, unit_price, extended, pack`
    )
    .eq("purchase_order_id", poId);

  if (error) return { invoices: [], error: error.message };
  if (!lines || lines.length === 0) return { invoices: [], error: null };

  const ids = [...new Set(lines.map((l) => l.invoice_id as string))];
  const { data: headers, error: headerError } = await supabase
    .from("vendor_invoices")
    .select("id, invoice_number, invoice_date")
    .in("id", ids)
    // A voided invoice is not a claim about this delivery any more.
    .neq("status", "void");
  if (headerError) return { invoices: [], error: headerError.message };

  const byInvoice = new Map<string, OrderInvoice["lines"]>();
  for (const l of lines) {
    const id = l.invoice_id as string;
    byInvoice.set(id, [
      ...(byInvoice.get(id) ?? []),
      {
        product_id: (l.product_id as string | null) ?? null,
        alt_product_id: (l.alt_product_id as string | null) ?? null,
        description: (l.description as string | null) ?? "",
        qty: l.qty === null ? null : Number(l.qty),
        unit_price: l.unit_price === null ? null : Number(l.unit_price),
        extended: l.extended === null ? null : Number(l.extended),
        pack: (l.pack as string | null) ?? null,
        purchase_order_item_id: (l.purchase_order_item_id as string | null) ?? null,
      },
    ]);
  }

  return {
    invoices: (headers ?? []).map((h) => ({
      id: h.id as string,
      invoice_number: h.invoice_number as string | null,
      invoice_date: h.invoice_date as string | null,
      lines: byInvoice.get(h.id as string) ?? [],
    })),
    error: null,
  };
}

/**
 * This vendor's recent orders at this location — what "Link to PO…" offers,
 * and what the printed-PO-number proposal is checked against.
 *
 * Scoped to the vendor AND the location because those are the two things that
 * make a printed number unambiguous; `matchPrintedPoNumber` refuses anything
 * outside that scope for the same reason. Void orders are excluded — you can't
 * be billed against an order that was cancelled.
 */
export async function fetchLinkCandidates(
  supabase: SupabaseClient,
  {
    vendorId,
    locationId,
    since,
  }: { vendorId: string; locationId: string; since: string }
): Promise<LinkedPurchaseOrder[]> {
  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("id, po_number, order_date, status, vendor_id, location_id")
    .eq("vendor_id", vendorId)
    .eq("location_id", locationId)
    .neq("status", "void")
    .gte("order_date", since)
    .order("order_date", { ascending: false })
    .limit(40);

  const ids = (orders ?? []).map((o) => o.id as string);
  if (ids.length === 0) return [];

  const { data: poLines } = await supabase
    .from("purchase_order_items")
    .select(`po_id, ${PO_LINE_SELECT}`)
    .in("po_id", ids);

  const byOrder = new Map<string, PoLine[]>();
  for (const row of (poLines ?? []) as unknown as (PoLine & { po_id: string })[]) {
    const { po_id, ...line } = row;
    byOrder.set(po_id, [...(byOrder.get(po_id) ?? []), line as PoLine]);
  }

  return (orders ?? []).map((o) => ({
    id: o.id as string,
    po_number: o.po_number as string,
    order_date: o.order_date as string,
    status: o.status as string,
    vendor_id: o.vendor_id as string,
    location_id: o.location_id as string,
    lines: byOrder.get(o.id as string) ?? [],
  }));
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
