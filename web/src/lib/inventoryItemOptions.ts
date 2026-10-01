import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickOption } from "@/components/ui/PickList";

/**
 * Every inventory item as `PickList` options — the Inventory item field on the
 * vendor item and production element records (Mark, 2026-10-01: "just use a
 * picklist in place of the inventory item field").
 *
 * PAGED, because PostgREST stops at 1,000 rows without saying so and the
 * catalog is ~790 today: the item a field needs would one day simply not be on
 * the list. Ordered by name and then id, so the pages cannot overlap.
 *
 * The unit rides as the hint — two items can share a name and differ in what
 * they are counted in, and a vendor item's pack content is in that unit.
 * Inactive items are marked and `PickList` sinks them, so a search can still
 * find one, and picking it asks to revive it.
 */
export async function loadInventoryItemOptions(
  supabase: SupabaseClient
): Promise<PickOption[]> {
  const options: PickOption[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: items } = await supabase
      .from("inventory_items")
      .select("id, name, base_unit, is_active")
      .order("name")
      .order("id")
      .range(from, from + 999);
    for (const it of items ?? []) {
      options.push({
        value: it.id,
        label: it.name,
        hint: it.base_unit,
        inactive: !it.is_active,
      });
    }
    if (!items || items.length < 1000) break;
  }
  return options;
}
