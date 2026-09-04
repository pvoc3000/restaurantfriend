import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { PageHeading } from "@/components/ui/PageHeading";
import { PriceGrid } from "@/components/production/PriceGrid";
import { canEditPage } from "@/lib/pageAccess";

/**
 * The price grid — decision 10's org-level (class × tier) prices and the sparse
 * per-shop overrides, in one editable matrix.
 *
 * Its own screen rather than a block on the item record, because it is not
 * about one item: forty numbers price three hundred of them, and the whole
 * argument for tiers is that you change one cell and a class reprices.
 */
export default async function PriceGridPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canEditPage(session.membership.role, "/price-grid");

  const [{ data: grid, error }, { data: overrides, error: overrideError }] = await Promise.all([
    supabase
      .from("production_price_grid")
      .select("id, price_class, price_tier, price, class_sort, tier_sort")
      .order("class_sort")
      .order("tier_sort"),
    supabase
      .from("production_price_grid_locations")
      .select("grid_id, location_id, price"),
  ]);

  if (error || overrideError) {
    const message = error?.message ?? overrideError?.message ?? "";
    return (
      <p className="text-sm text-accent">
        Could not load the price grid: {message}
        {/production_price/.test(message) ? " — migration 037 has not been applied yet." : ""}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* A MATRIX, not a list — one record with two axes — so the count is the
          grid's own cells and there is nothing to filter it down to. */}
      <PageHeading title="Prices" total={(grid ?? []).length} noun="prices" />
      <PriceGrid
        grid={(grid ?? []).map((g) => ({
          id: g.id as string,
          price_class: g.price_class as string,
          price_tier: g.price_tier as string,
          price: g.price === null ? null : Number(g.price),
          class_sort: g.class_sort === null ? null : Number(g.class_sort),
          tier_sort: g.tier_sort === null ? null : Number(g.tier_sort),
        }))}
        overrides={(overrides ?? []).map((o) => ({
          grid_id: o.grid_id as string,
          location_id: o.location_id as string,
          price: o.price === null ? null : Number(o.price),
        }))}
        // activeLocations, never locations — design rule 3: a scope OVER shops
        // enumerates the active ones, or three closed shops sprout dead columns.
        locations={session.activeLocations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
        }))}
        orgId={session.membership.org_id}
        editable={editable}
      />
    </div>
  );
}
