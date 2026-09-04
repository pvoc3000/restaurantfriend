import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import type { RawSearchParams } from "@/lib/itemFilters";
import { crumbPath, currentQuery, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import {
  fetchPoWithLines,
  fetchSignedAttachments,
} from "@/lib/purchaseOrderQueries";
import { PurchaseOrderDetail } from "@/components/purchasing/PurchaseOrderDetail";
import { canEditPage } from "@/lib/pageAccess";

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

  const { order, lines, error, lineError } = await fetchPoWithLines(supabase, id);

  if (error) {
    return <p className="text-sm text-accent">Could not load order: {error}</p>;
  }
  if (!order) notFound();

  const locationCode =
    session.locations.find((l) => l.id === order.location_id)?.code ?? "—";

  // Processing writes (status, delivery date), so the card is purchaser+ only —
  // matching the RLS policy that would reject a staff member's click anyway.
  const canProcess = canWriteCatalog(session.membership.role);

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

  // The invoice and packing slips (migration 018), signed server-side.
  const { attachments, error: attachmentError } = await fetchSignedAttachments(
    supabase,
    id
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={trail}
        current={order.po_number}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {lineError ? (
        <p className="text-sm text-accent">Could not load order lines: {lineError}</p>
      ) : (
        <PurchaseOrderDetail
          canFileBills={canEditPage(session.membership.role, "/invoices")}
          order={order}
          lines={lines}
          locationCode={locationCode}
          orgId={session.membership.org_id}
          processing={processing}
          attachments={attachments}
          // Said out loud rather than swallowed: if this query fails on the
          // columns it selects, an empty Paperwork card would read as "no
          // invoice yet" instead of "this isn't wired up at this end yet".
          attachmentError={attachmentError}
          // Built HERE because only the server has `rawParams`, and without
          // `currentQuery` the stamped crumb is a bare href — the receiving
          // screen would then show "112-181120-01 / Receive" and lose the POs
          // crumb that led here.
          receiveHref={withFrom(`/purchase-orders/${id}/receive`, {
            href: `/purchase-orders/${id}${currentQuery(rawParams)}`,
            label: order.po_number,
          })}
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
