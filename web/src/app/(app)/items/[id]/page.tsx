import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { VENDOR_ITEM_SELECT, type CatalogItem, type CatalogVendorItem } from "@/lib/catalog";
import { ItemFields } from "@/components/catalog/ItemFields";
import { ItemLocationRows } from "@/components/catalog/ItemLocationRows";
import { VendorItemsTable } from "@/components/catalog/VendorItemsTable";

// Item detail is per-ITEM, not per-location: every location's row is listed so
// the differences between shops are visible in one place (spec §4.8 — the
// desktop tab Mark used to duplicate config from).
const SELECT = `
  id, name, category, base_unit, note, is_active,
  inventory_item_locations (
    id, location_id, default_par, default_vendor_item_id, note, is_active,
    shop_sections ( display_name, sort_order ),
    vendor_items ( ${VENDOR_ITEM_SELECT} )
  )
`;

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAppSession();
  const supabase = await createClient();

  const [{ data: item, error }, { data: vendorItems, error: viError }] =
    await Promise.all([
      supabase.from("inventory_items").select(SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("vendor_items")
        .select(VENDOR_ITEM_SELECT)
        .eq("inventory_item_id", id)
        .order("is_active", { ascending: false }),
    ]);

  if (error) {
    return <p className="text-sm text-red-700">Could not load item: {error.message}</p>;
  }
  if (!item) notFound();

  const row = item as unknown as CatalogItem;
  const locationRows = [...row.inventory_item_locations].sort((a, b) => {
    const codeA = session.locations.find((l) => l.id === a.location_id)?.code ?? "";
    const codeB = session.locations.find((l) => l.id === b.location_id)?.code ?? "";
    return codeA.localeCompare(codeB);
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/items" className="text-blue-700 hover:underline">
          ← Items
        </Link>
      </div>

      <ItemFields item={row} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Per-location config
        </h2>
        <ItemLocationRows
          rows={locationRows}
          locations={session.locations}
          inventoryItemId={row.id}
          baseUnit={row.base_unit}
          orgId={session.membership.org_id}
          activeLocationId={session.activeLocation?.id ?? null}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Vendor items
        </h2>
        {viError ? (
          <p className="text-sm text-red-700">
            Could not load vendor items: {viError.message}
          </p>
        ) : (
          <VendorItemsTable
            vendorItems={(vendorItems ?? []) as unknown as CatalogVendorItem[]}
            baseUnit={row.base_unit}
            showVendor
          />
        )}
      </section>
    </div>
  );
}
