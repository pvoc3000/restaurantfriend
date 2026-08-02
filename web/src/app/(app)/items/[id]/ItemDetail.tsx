import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import {
  VENDOR_ITEM_SELECT_ACTIVE_VENDOR,
  type CatalogItem,
  type CatalogVendorItem,
} from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { crumbPath, currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { ItemFields } from "@/components/catalog/ItemFields";
import { ItemLocationRows } from "@/components/catalog/ItemLocationRows";
import { VendorItemsTable } from "@/components/catalog/VendorItemsTable";
import { SectionHeading } from "@/components/ui/SectionHeading";

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
 * The item detail's whole body. Its own full-screen page (Mark, 2026-07-30 —
 * detail views were slide-overs for a week and are pages again); the body
 * stays split out from the page shell so the two are easy to tell apart.
 */
export async function ItemDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  // The trail follows the route actually taken — reaching this item from a
  // vendor's item list must lead back to that vendor, not to the Inventory list.
  const trail = parseTrail(rawParams, { href: "/items", label: "Inventory" });
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  const [
    { data: item, error },
    { data: vendorItems, error: viError },
    { data: categoryRows },
  ] = await Promise.all([
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
      // What the Category picker offers. One column over the catalog, fired
      // alongside the other two rather than after them, so it costs no round
      // trip of its own — there's no `distinct` in PostgREST, and 790 short
      // strings is cheaper than the view of them would be.
      supabase.from("inventory_items").select("category"),
    ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load item: {error.message}</p>;
  }
  if (!item) notFound();

  const row = item as unknown as CatalogItem;

  const categories = [
    ...new Set(
      ((categoryRows ?? []) as { category: string | null }[])
        .map((r) => r.category)
        .filter((c): c is string => c !== null && c !== "")
    ),
  ].sort((a, b) => a.localeCompare(b));

  const locationRows = [...row.inventory_item_locations].sort((a, b) => {
    const codeA = session.locations.find((l) => l.id === a.location_id)?.code ?? "";
    const codeB = session.locations.find((l) => l.id === b.location_id)?.code ?? "";
    return codeA.localeCompare(codeB);
  });

  return (
    <div className="space-y-6">
      {/* The book walks the Inventory list's found set — see ui/RecordNav. */}
      <Breadcrumbs
        trail={trail}
        current={row.name}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <ItemFields item={row} categories={categories} />

      <section className="space-y-2">
        <SectionHeading>Per-location config</SectionHeading>
        {/* `activeLocations`: this is the "stock here" list, and you don't
            stock a closed shop. The code lookups above use session.locations,
            which carries every location. */}
        <ItemLocationRows
          rows={locationRows}
          locations={session.activeLocations}
          inventoryItemId={row.id}
          baseUnit={row.base_unit}
          orgId={session.membership.org_id}
          activeLocationId={session.activeLocation?.id ?? null}
        />
      </section>

      <section className="space-y-2">
        <SectionHeading>Vendor items</SectionHeading>
        <p className="text-xs text-subtle">
          Items from deactivated vendors are hidden. Reactivate the vendor on its
          detail screen to bring them back.
        </p>
        {viError ? (
          <p className="text-sm text-accent">
            Could not load vendor items: {viError.message}
          </p>
        ) : (
          <VendorItemsTable
            vendorItems={(vendorItems ?? []) as unknown as CatalogVendorItem[]}
            baseUnit={row.base_unit}
            showVendor
            from={{ href: `/items/${id}${queryString}`, label: row.name }}
            canEdit={["owner", "admin", "purchaser"].includes(session.membership.role)}
          />
        )}
      </section>
    </div>
  );
}
