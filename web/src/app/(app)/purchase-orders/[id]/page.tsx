import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import { currentQuery, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { PoLine, PurchaseOrder } from "@/lib/purchaseOrders";
import { PurchaseOrderDetail } from "@/components/purchasing/PurchaseOrderDetail";

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
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
         vendor_id, location_id, vendors ( id, name )`
      )
      .eq("id", id)
      .maybeSingle(),
    // vendor_items is joined for the CURRENT catalog price — the line itself
    // carries the price snapshot from when it was ordered, and the gap between
    // the two is the price-reconciliation prompt (spec §2 step 5).
    supabase
      .from("purchase_order_items")
      .select(
        `id, vendor_item_id, description, brand, product_id, package_desc,
         qty_ordered, qty_received, unit_price, discrepancy_note,
         vendor_items ( id, price, inventory_items ( id, name ) )`
      )
      .eq("po_id", id)
      .order("description"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Could not load order: {error.message}</p>;
  }
  if (!po) notFound();

  const order = po as unknown as PurchaseOrder;
  const locationCode =
    session.locations.find((l) => l.id === order.location_id)?.code ?? "—";

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={trail} current={order.po_number} />

      {lineError ? (
        <p className="text-sm text-red-700">
          Could not load order lines: {lineError.message}
        </p>
      ) : (
        <PurchaseOrderDetail
          order={order}
          lines={(lines ?? []) as unknown as PoLine[]}
          locationCode={locationCode}
          vendorLink={
            order.vendors ? (
              <Link
                href={withFrom(`/vendors/${order.vendors.id}`, {
                  href: `/purchase-orders/${id}${currentQuery(rawParams)}`,
                  label: order.po_number,
                })}
                className="text-blue-700 hover:underline"
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
