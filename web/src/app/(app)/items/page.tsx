import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { staleBucket, type StaleBucket } from "@/lib/lastOrdered";
import { type CatalogItem } from "@/lib/catalog";
import { parseItemFilters, type RawSearchParams } from "@/lib/itemFilters";
import { ItemsList } from "@/components/catalog/ItemsList";
import { canEditPage } from "@/lib/pageAccess";

// The list is item-master rows with the CURRENT location's config embedded, so
// one row = one item, and the per-location columns (section, par) reflect where
// you're working. Items with no row at this location still appear — "not
// stocked here" is a useful signal, not a reason to hide.
//
// The vendor_items embed resolved through default_vendor_item_id and went with
// it in migration 012; there is no single vendor item that speaks for an
// item-location any more.
const SELECT = `
  id, name, category, base_unit, note, is_active,
  inventory_item_locations (
    id, location_id, default_par, note, is_active,
    shop_sections ( display_name, sort_order )
  )
`;

export type ItemRow = CatalogItem & {
  last_order_date: string | null;
  stale: StaleBucket;
};

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Filters arrive in the URL so returning from item detail restores them.
  const initialFilters = parseItemFilters(await searchParams);
  const session = await getAppSession();
  const supabase = await createClient();
  const locationId = session.activeLocation?.id ?? null;

  // Paginated — PostgREST caps a page at 1000 and the catalog is ~790 items
  // today, close enough that a second page is a matter of time.
  const items: CatalogItem[] = [];
  let from = 0;
  for (;;) {
    let query = supabase.from("inventory_items").select(SELECT).order("name");
    if (locationId) {
      query = query.eq("inventory_item_locations.location_id", locationId);
    }
    const { data, error } = await query.range(from, from + 999);

    if (error) {
      return (
        <p className="text-sm text-accent">
          Could not load the catalog: {error.message}
        </p>
      );
    }
    items.push(...((data ?? []) as unknown as CatalogItem[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  // Last-ordered dates for this location, one query over the view (not N+1),
  // keyed by item_location_id. Degrades to "never" if migration 004 is missing.
  const lastOrderedByIl = new Map<string, string | null>();
  if (locationId) {
    const { data, error } = await supabase
      .from("v_item_last_ordered")
      .select("item_location_id, last_order_date")
      .eq("location_id", locationId);
    if (error) {
      console.warn("v_item_last_ordered unavailable (apply migration 004):", error.message);
    } else {
      for (const r of data ?? []) lastOrderedByIl.set(r.item_location_id, r.last_order_date);
    }
  }

  const today = new Date();
  const rows: ItemRow[] = items.map((item) => {
    const il = item.inventory_item_locations[0] ?? null;
    const last_order_date = il ? lastOrderedByIl.get(il.id) ?? null : null;
    return { ...item, last_order_date, stale: staleBucket(last_order_date, today) };
  });

  const categories = [
    ...new Set(items.map((i) => i.category).filter((c): c is string => !!c)),
  ].sort();

  return (
    <ItemsList
      items={rows}
      categories={categories}
      activeLocationCode={session.activeLocation?.code ?? null}
      initialFilters={initialFilters}
      orgId={session.membership.org_id}
      editable={canEditPage(session.membership.role, "/items")}
    />
  );
}
