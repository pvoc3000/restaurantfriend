import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import {
  VENDOR_ITEM_SELECT_ACTIVE_VENDOR,
  type CatalogItem,
  type CatalogVendorItem,
} from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ItemFields } from "@/components/catalog/ItemFields";
import { ItemLocationRows } from "@/components/catalog/ItemLocationRows";
import { VendorItemsTable } from "@/components/catalog/VendorItemsTable";

// Item detail is per-ITEM, not per-location: every location's row is listed so
// the differences between shops are visible in one place (spec §4.8 — the
// desktop tab Mark used to duplicate config from).
const SELECT = `
  id, name, category, base_unit, note, is_active,
  inventory_item_locations (
    id, location_id, default_par, order_days, note, is_active,
    shop_sections ( display_name, sort_order )
  )
`;

/**
 * The item detail's whole body, shared by the dedicated page and the
 * app-wide slide-over panel (the intercepting route). Breadcrumbs only make
 * sense on the full page — the panel floats over wherever you already are.
 */
export async function ItemDetail({
  id,
  rawParams,
  inPanel = false,
}: {
  id: string;
  rawParams: RawSearchParams;
  inPanel?: boolean;
}) {
  // The trail follows the route actually taken — reaching this item from a
  // vendor's item list must lead back to that vendor, not to the Inventory list.
  const trail = parseTrail(rawParams, { href: "/items", label: "Inventory" });
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  const [{ data: item, error }, { data: vendorItems, error: viError }] =
    await Promise.all([
      supabase.from("inventory_items").select(SELECT).eq("id", id).maybeSingle(),
      // Deactivated vendors are gone from this screen entirely — you can't
      // order from them, so their items are noise here. An individually
      // inactive item under an ACTIVE vendor still shows, dimmed and toggleable.
      supabase
        .from("vendor_items")
        .select(VENDOR_ITEM_SELECT_ACTIVE_VENDOR)
        .eq("inventory_item_id", id)
        .eq("vendors.is_active", true)
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
      {!inPanel && <Breadcrumbs trail={trail} current={row.name} />}

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
        <p className="text-xs text-neutral-500">
          Items from deactivated vendors are hidden. Reactivate the vendor on its
          detail screen to bring them back.
        </p>
        {viError ? (
          <p className="text-sm text-red-700">
            Could not load vendor items: {viError.message}
          </p>
        ) : (
          <VendorItemsTable
            vendorItems={(vendorItems ?? []) as unknown as CatalogVendorItem[]}
            baseUnit={row.base_unit}
            showVendor
            from={{ href: `/items/${id}${queryString}`, label: row.name }}
          />
        )}
      </section>
    </div>
  );
}
