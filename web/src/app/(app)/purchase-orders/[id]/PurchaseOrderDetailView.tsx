import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import { currentQuery, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { PoLine, PurchaseOrder } from "@/lib/purchaseOrders";
import {
  ATTACHMENT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type PoAttachment,
  type SignedAttachment,
} from "@/lib/attachments";
import { PurchaseOrderDetail } from "@/components/purchasing/PurchaseOrderDetail";

/**
 * The PO detail's whole body. Its own full-screen page (Mark, 2026-07-30);
 * the body stays split out from the page shell, like the other detail views.
 */
export async function PurchaseOrderDetailView({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const trail = parseTrail(rawParams, {
    href: "/purchase-orders",
    label: "POs",
  });
  const session = await getAppSession();
  const supabase = await createClient();

  const [{ data: po, error }, { data: lines, error: lineError }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        `id, po_number, status, sent_via, order_date, delivery_date, notes,
         vendor_id, location_id, vendors ( id, name, order_type, url )`
      )
      .eq("id", id)
      .maybeSingle(),
    // vendor_items is joined for the CURRENT catalog price — the line itself
    // carries the price snapshot from when it was ordered, and the gap between
    // the two is the price-reconciliation prompt (spec §2 step 5).
    supabase
      .from("purchase_order_items")
      .select(
        `id, vendor_item_id, description, brand, product_id, package_desc, notes,
         qty_ordered, qty_received, unit_price, discrepancy_note,
         vendor_items ( id, price, inventory_items ( id, name, category ) )`
      )
      .eq("po_id", id)
      .order("description"),
  ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load order: {error.message}</p>;
  }
  if (!po) notFound();

  const order = po as unknown as PurchaseOrder & {
    vendors: { order_type: string; url: string | null } | null;
  };
  const locationCode =
    session.locations.find((l) => l.id === order.location_id)?.code ?? "—";

  // Processing writes (status, delivery date), so the card is purchaser+ only —
  // matching the RLS policy that would reject a staff member's click anyway.
  const canProcess = ["owner", "admin", "purchaser"].includes(session.membership.role);

  // The vendor-location row carries the processing context: where the mail
  // draft goes and which weekday the delivery-date suggestion lands on.
  const { data: vendorLoc } = canProcess
    ? await supabase
        .from("vendor_locations")
        .select("rep_email, delivery_days")
        .eq("vendor_id", order.vendor_id)
        .eq("location_id", order.location_id)
        .maybeSingle()
    : { data: null };

  const processing = canProcess
    ? {
        order_type: order.vendors?.order_type ?? "none",
        vendor_url: order.vendors?.url ?? null,
        rep_email: vendorLoc?.rep_email ?? null,
        delivery_days: (vendorLoc?.delivery_days as number[] | null) ?? null,
      }
    : null;

  // The invoice and packing slips (migration 018). Signed HERE rather than in
  // the client component: one batch call instead of a round trip per card on
  // load, and a URL built to expire doesn't sit in the browser any longer than
  // the page does.
  const { data: attachmentRows, error: attachmentError } = await supabase
    .from("purchase_order_attachments")
    .select("id, po_id, storage_path, kind, file_name, content_type, byte_size, created_at")
    .eq("po_id", id)
    .order("created_at");

  const rows = (attachmentRows ?? []) as PoAttachment[];
  const { data: signed } = rows.length
    ? await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrls(
          rows.map((a) => a.storage_path),
          SIGNED_URL_TTL_SECONDS
        )
    : { data: null };

  // createSignedUrls answers in request order and reports per-object failures
  // rather than throwing, so a single missing object costs that one thumbnail
  // and not the screen.
  const attachments: SignedAttachment[] = rows.map((a, i) => ({
    ...a,
    url: signed?.[i]?.signedUrl ?? null,
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={trail} current={order.po_number} />

      {lineError ? (
        <p className="text-sm text-accent">
          Could not load order lines: {lineError.message}
        </p>
      ) : (
        <PurchaseOrderDetail
          order={order}
          lines={(lines ?? []) as unknown as PoLine[]}
          locationCode={locationCode}
          orgId={session.membership.org_id}
          processing={processing}
          attachments={attachments}
          // Said out loud rather than swallowed: before migration 018 is applied
          // this query fails on the columns it selects, and an empty Paperwork
          // card would read as "no invoice yet" instead of "this isn't wired up
          // at this end yet".
          attachmentError={attachmentError?.message ?? null}
          vendorLink={
            order.vendors ? (
              <Link
                href={withFrom(`/vendors/${order.vendors.id}`, {
                  href: `/purchase-orders/${id}${currentQuery(rawParams)}`,
                  label: order.po_number,
                })}
                className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
              >
                {order.vendors.name}
              </Link>
            ) : (
              "—"
            )
          }
        />
      )}
    </div>
  );
}
