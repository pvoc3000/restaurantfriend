import type { SupabaseClient } from "@supabase/supabase-js";
import { nextDeliveryDate } from "@/lib/poProcessing";

/**
 * Create an EMPTY draft purchase order — ONE implementation behind the PO
 * list's New Purchase Order… and the vendor record's (Mark, 2026-09-14), so
 * the numbering, the delivery date and the row-count check cannot drift
 * between the two doors.
 *
 * It does what 013's generation does for a header: numbers the order with
 * `next_po_number` (006) and dates delivery from the vendor's delivery days at
 * this shop, so an order made by hand reads like a generated one.
 */
export async function createEmptyPurchaseOrder(
  supabase: SupabaseClient,
  {
    orgId,
    locationId,
    vendorId,
    today,
  }: { orgId: string; locationId: string; vendorId: string; today: string }
): Promise<{ id: string } | { error: string }> {
  const [{ data: poNumber, error: numberError }, { data: vl }, { data: auth }] =
    await Promise.all([
      supabase.rpc("next_po_number", { p_vendor_id: vendorId, p_location_id: locationId }),
      supabase
        .from("vendor_locations")
        .select("delivery_days")
        .eq("vendor_id", vendorId)
        .eq("location_id", locationId)
        .maybeSingle(),
      supabase.auth.getUser(),
    ]);
  if (numberError || !poNumber) {
    return { error: numberError?.message ?? "The order could not be numbered." };
  }
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      org_id: orgId,
      location_id: locationId,
      vendor_id: vendorId,
      po_number: poNumber as string,
      status: "draft",
      order_date: today,
      delivery_date: nextDeliveryDate(
        today,
        (vl as { delivery_days: number[] | null } | null)?.delivery_days
      ),
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "The purchase order could not be created." };
  }
  return { id: data.id as string };
}
