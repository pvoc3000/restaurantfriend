import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import {
  ShopSectionsTable,
  type ShopSectionRow,
} from "@/components/location/ShopSectionsTable";

/**
 * The shop's shelves, in walk order.
 *
 * Its own screen rather than a block on the location page (Mark, 2026-07-30):
 * 168 rows across three locations is a list, and it's the list the order guide
 * is built on.
 */
export default async function ShopSectionsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const editable = canWriteCatalog(session.membership.role);

  const { data: sections, error } = await supabase
    .from("shop_sections")
    .select("id, area, sub_area, display_name, sort_order")
    .eq("location_id", active.id)
    .order("sort_order");

  if (error) {
    return (
      <p className="text-sm text-accent">Could not load shop sections: {error.message}</p>
    );
  }

  // The item count per section, tallied from one narrow column rather than an
  // embedded aggregate. PAGINATED — PostgREST caps a page at 1000, and a
  // single request would silently under-count the busiest sections once a
  // location passes that (495 at DF01 today, so it has room, but a truncated
  // count reads as a real one).
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error: usageError } = await supabase
      .from("inventory_item_locations")
      .select("shop_section_id")
      .eq("location_id", active.id)
      .not("shop_section_id", "is", null)
      .order("id")
      .range(from, from + 999);

    if (usageError) {
      return (
        <p className="text-sm text-accent">Could not count items: {usageError.message}</p>
      );
    }
    for (const row of data ?? []) {
      const id = row.shop_section_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if ((data ?? []).length < 1000) break;
  }

  const rows: ShopSectionRow[] = (sections ?? []).map((s) => ({
    id: s.id as string,
    area: s.area as string,
    sub_area: (s.sub_area as string | null) ?? null,
    display_name: s.display_name as string,
    sort_order: Number(s.sort_order),
    item_count: counts.get(s.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Shop sections
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          The order guide walks {active.code} in this order — sort first, then
          name. The display name is what the guide groups by and what the
          in-person shopping list prints, so renaming one renames it everywhere.
        </p>
      </div>

      {/* Keyed for the same reason /location is: switching location is a
          navigation to this same route, so without it the search box keeps the
          term you typed against the other shop's shelves. A new location is a
          new screen. */}
      <ShopSectionsTable
        key={active.id}
        rows={rows}
        orgId={session.membership.org_id}
        locationId={active.id}
        locationCode={active.code}
        editable={editable}
      />
    </div>
  );
}
