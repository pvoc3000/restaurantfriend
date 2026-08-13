import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchYield, CostElement, ItemBom } from "./productionCost";
import type { PriceGridCell, PriceGridOverride } from "./productionPrice";

/**
 * Load the whole costing graph in FOUR queries, regardless of how deep the BOM
 * goes.
 *
 * A recursive fetch would be the obvious shape and the wrong one: a glaze made
 * from a dough made from a flour is three round trips for one row, and the
 * order guide's own lesson is that round trips are the first thing to count
 * (`getAppSession`, 2026-07-26). The catalog is ~470 elements and ~4,000 lines
 * — small enough to hold whole — so it is fetched flat and assembled in memory,
 * and `elementCost` walks it with no I/O at all.
 *
 * Only MASTER versions are loaded. A non-master version is a document you can
 * read on its own screen; it is never what an element costs.
 */
export type ProductionGraph = {
  byId: Map<string, CostElement>;
  /** Recipe families per element, for the counts a list shows. */
  recipeCountByElement: Map<string, number>;
  /** What each element costs FROM, in words — the list's "Costs from" column. */
  sourceByElement: Map<string, string>;
};

/**
 * POSTGREST RETURNS AT MOST 1,000 ROWS AND SAYS NOTHING ABOUT IT.
 *
 * Supabase caps every REST select at `db-max-rows` (1,000 by default), so a
 * table with more rows comes back silently truncated — no error, no flag, just
 * a short array. `production_recipe_lines` has 3,765 rows, and the first cut of
 * this module fetched them in one call: two-thirds of every recipe's
 * ingredients were invisible to costing, so 299 elements read as uncosted where
 * the real figure is 209. It looked exactly like a catalog with more holes in
 * it than expected, which is why it survived a first read of the screen.
 *
 * Note the `.order()` — a `.range()` sweep with no ORDER BY returns rows in
 * whatever order Postgres likes, so pages overlap and rows go missing. That is
 * the timesheets audit lesson (44,661 rows fetched holding 27,795 distinct
 * ids), and it applies to any paginated read.
 */
async function fetchAll(
  supabase: SupabaseClient,
  table: string,
  select: string,
  /**
   * What to order the sweep by. Defaults to `id`, which every table here has
   * EXCEPT `production_price_grid_locations` — 037 gives it none on purpose,
   * the `vendor_item_location_prices` idiom, because the pair IS the key. A
   * hardcoded "id" here asked Postgres for a column that does not exist and
   * took the whole menu screen down with it.
   */
  orderBy = "id"
): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy)
      .range(from, from + PAGE - 1);
    if (error) return { data: [], error };
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export async function loadProductionGraph(
  supabase: SupabaseClient
): Promise<{ graph: ProductionGraph | null; error: string | null }> {
  const [elements, recipes, versions, lines] = await Promise.all([
    fetchAll(
      supabase,
      "production_elements",
      `id, name, kind, manual_cost, manual_cost_unit, inventory_item_id,
       inventory_items ( id, name, base_unit,
         vendor_items ( id, price, package_content, is_active,
           vendor_item_location_prices ( location_id, price ) ) )`
    ),
    fetchAll(supabase, "production_recipes", "id, element_id, name"),
    // Master versions only — a non-master is a document you read on its own
    // screen, never what an element costs. ~128 rows, one page.
    supabase
      .from("production_recipe_versions")
      .select("id, recipe_id, is_master")
      .eq("is_master", true)
      .order("id"),
    // Only the master versions' lines are needed for costing, but filtering
    // them here would need the version ids first — a fifth round trip to save
    // a few thousand rows we are already holding. Fetched flat and filtered.
    fetchAll(supabase, "production_recipe_lines", "id, version_id, element_id, label, qty, unit"),
  ]);

  const failed = [elements, recipes, versions, lines].find((r) => r.error);
  if (failed?.error) return { graph: null, error: failed.error.message };

  // Not the yield columns: costing divides by the "Expected Yield" LINE, which
  // arrives with the rest of the lines below. Selecting them here is how the
  // wrong one gets read again.
  const masterByRecipe = new Map<string, { id: string }>();
  for (const v of versions.data ?? []) {
    masterByRecipe.set(v.recipe_id as string, { id: v.id as string });
  }

  type GraphLine = {
    id: string;
    label: string | null;
    qty: number | null;
    unit: string | null;
    element_id: string | null;
  };
  const linesByVersion = new Map<string, GraphLine[]>();
  for (const l of lines.data ?? []) {
    const key = l.version_id as string;
    const list = linesByVersion.get(key) ?? [];
    list.push({
      id: l.id as string,
      label: (l.label ?? null) as string | null,
      qty: l.qty === null ? null : Number(l.qty),
      unit: (l.unit ?? null) as string | null,
      element_id: (l.element_id ?? null) as string | null,
    });
    linesByVersion.set(key, list);
  }

  // An element's master version is the master of its FIRST recipe family. An
  // element with two families (a summer and a winter formulation) has two, and
  // costing has to pick one; the first by name is at least stable, and the
  // element screen shows both so the choice is visible rather than hidden.
  const recipeCountByElement = new Map<string, number>();
  const masterByElement = new Map<string, { id: string }>();
  const recipeNameByElement = new Map<string, string>();
  for (const r of (recipes.data ?? []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name))
  )) {
    const elementId = r.element_id as string;
    recipeCountByElement.set(elementId, (recipeCountByElement.get(elementId) ?? 0) + 1);
    const master = masterByRecipe.get(r.id as string);
    if (master && !masterByElement.has(elementId)) {
      masterByElement.set(elementId, master);
      recipeNameByElement.set(elementId, r.name as string);
    }
  }

  const byId = new Map<string, CostElement>();
  const sourceByElement = new Map<string, string>();
  for (const e of elements.data ?? []) {
    const id = e.id as string;
    // PostgREST returns an embedded to-one as an object, but the generated
    // types can't always tell — normalise rather than trusting the shape.
    const inv = Array.isArray(e.inventory_items) ? e.inventory_items[0] : e.inventory_items;
    const master = masterByElement.get(id);
    byId.set(id, {
      id,
      name: e.name as string,
      kind: e.kind as CostElement["kind"],
      manual_cost: e.manual_cost === null ? null : Number(e.manual_cost),
      manual_cost_unit: (e.manual_cost_unit ?? null) as string | null,
      inventory: inv
        ? {
            id: inv.id as string,
            base_unit: (inv.base_unit ?? null) as string | null,
            vendor_items: (inv.vendor_items ?? []).map((vi: Record<string, unknown>) => ({
              id: vi.id as string,
              price: vi.price === null ? null : Number(vi.price),
              package_content:
                vi.package_content === null ? null : Number(vi.package_content),
              is_active: (vi.is_active ?? true) as boolean,
              vendor_item_location_prices: (vi.vendor_item_location_prices ??
                []) as { location_id: string; price: number | null }[],
            })),
          }
        : null,
      master: master
        ? {
            // NO yield columns: costing divides by the "Expected Yield" LINE,
            // which is already in `lines`. See `elementCost`.
            id: master.id,
            lines: linesByVersion.get(master.id) ?? [],
          }
        : null,
    });

    // What this element costs FROM, named — the list's "Costs from" column. A
    // kind with no source resolves to nothing, and the empty cell is the point.
    const kind = e.kind as string;
    if (kind === "made") {
      const recipe = recipeNameByElement.get(id);
      if (recipe) sourceByElement.set(id, recipe);
    } else if (kind === "purchased" && inv) {
      sourceByElement.set(id, inv.name as string);
    } else if (kind === "manual" && e.manual_cost !== null) {
      sourceByElement.set(
        id,
        `$${Number(e.manual_cost).toFixed(2)}${e.manual_cost_unit ? ` / ${e.manual_cost_unit}` : ""}`
      );
    }
  }

  return { graph: { byId, recipeCountByElement, sourceByElement }, error: null };
}

/* ========================================================================== */
/* Items                                                                       */
/* ========================================================================== */


export type ItemGraph = {
  items: (ItemBom & {
    finish: string | null;
    price_class: string | null;
    price_tier: string | null;
    tally_box_size: number;
    is_active: boolean;
    baseName: string | null;
  })[];
  yields: BatchYield[];
  grid: PriceGridCell[];
  gridOverrides: PriceGridOverride[];
  /** Per-item price overrides, keyed by item id. */
  overridesByItem: Map<string, { location_id: string; price_override: number | null }[]>;
};

/**
 * The item layer, in five paginated queries.
 *
 * Paginated for the reason `fetchAll` exists: 325 item-locations and 324 edges
 * are under the 1,000 cap today and a menu grows. A silent truncation here
 * would drop toppings off items and read as a costing gap rather than a
 * missing row.
 */
export async function loadItemGraph(
  supabase: SupabaseClient,
  elementNames: Map<string, string>
): Promise<{ graph: ItemGraph | null; error: string | null }> {
  const [items, edges, locations, grid, overrides, yields] = await Promise.all([
    fetchAll(
      supabase,
      "production_items",
      `id, name, item_type, subtype, finish, size, base_element_id,
       price_class, price_tier, tally_box_size, is_active`
    ),
    fetchAll(supabase, "production_item_elements", "id, item_id, element_id, qty, unit, sort"),
    fetchAll(supabase, "production_item_locations", "id, item_id, location_id, price_override"),
    fetchAll(supabase, "production_price_grid",
      "id, price_class, price_tier, price, class_sort, tier_sort"),
    fetchAll(supabase, "production_price_grid_locations", "grid_id, location_id, price", "grid_id"),
    fetchAll(supabase, "production_batch_yields",
      "item_type, subtype, size, portion_of_batch, size_factor"),
  ]);

  const failed = [items, edges, locations, grid, overrides, yields].find((r) => r.error);
  if (failed?.error) return { graph: null, error: failed.error.message };

  const edgesByItem = new Map<string, ItemBom["elements"]>();
  for (const e of edges.data) {
    const key = e.item_id as string;
    const list = edgesByItem.get(key) ?? [];
    list.push({
      id: e.id as string,
      label: null,
      qty: e.qty === null ? null : Number(e.qty),
      unit: (e.unit ?? null) as string | null,
      element_id: (e.element_id ?? null) as string | null,
      sort: e.sort === null || e.sort === undefined ? null : Number(e.sort),
    });
    edgesByItem.set(key, list);
  }

  const overridesByItem = new Map<string, { location_id: string; price_override: number | null }[]>();
  for (const l of locations.data) {
    const key = l.item_id as string;
    const list = overridesByItem.get(key) ?? [];
    list.push({
      location_id: l.location_id as string,
      price_override: l.price_override === null ? null : Number(l.price_override),
    });
    overridesByItem.set(key, list);
  }

  return {
    graph: {
      items: items.data.map((i) => ({
        id: i.id as string,
        name: i.name as string,
        item_type: (i.item_type ?? null) as string | null,
        subtype: (i.subtype ?? null) as string | null,
        finish: (i.finish ?? null) as string | null,
        size: (i.size ?? null) as string | null,
        base_element_id: (i.base_element_id ?? null) as string | null,
        baseName: i.base_element_id ? elementNames.get(i.base_element_id as string) ?? null : null,
        price_class: (i.price_class ?? null) as string | null,
        price_tier: (i.price_tier ?? null) as string | null,
        tally_box_size: Number(i.tally_box_size ?? 6),
        is_active: (i.is_active ?? true) as boolean,
        elements: edgesByItem.get(i.id as string) ?? [],
      })),
      yields: yields.data.map((y) => ({
        item_type: y.item_type as string,
        subtype: (y.subtype ?? null) as string | null,
        size: (y.size ?? null) as string | null,
        portion_of_batch: y.portion_of_batch === null ? null : Number(y.portion_of_batch),
        size_factor: y.size_factor === null ? null : Number(y.size_factor),
      })),
      grid: grid.data.map((g) => ({
        id: g.id as string,
        price_class: g.price_class as string,
        price_tier: g.price_tier as string,
        price: g.price === null ? null : Number(g.price),
        class_sort: g.class_sort === null ? null : Number(g.class_sort),
        tier_sort: g.tier_sort === null ? null : Number(g.tier_sort),
      })),
      gridOverrides: overrides.data.map((o) => ({
        grid_id: o.grid_id as string,
        location_id: o.location_id as string,
        price: o.price === null ? null : Number(o.price),
      })),
      overridesByItem,
    },
    error: null,
  };
}

/**
 * Every ACTIVE element, id and name, for a picker to choose from.
 *
 * Separate from `loadProductionGraph`, which loads the same table but for
 * COSTING and therefore loads all 470 whether they are retired or not — a
 * resolver has to be able to price a component that is already on a BOM. A
 * picker is the opposite question: what may be added NOW. Offering an inactive
 * element there would make deactivating one mean nothing, which is the whole
 * answer `ElementActions` gives for the 412 that cannot be deleted.
 *
 * Paginated like everything else here — PostgREST truncates at 1,000 rows in
 * silence, and this catalog is at 470 and grows.
 */
export async function loadElementOptions(
  supabase: SupabaseClient
): Promise<{ options: { value: string; label: string }[]; error: string | null }> {
  const { data, error } = await fetchAll(
    supabase,
    "production_elements",
    "id, name, is_active",
    "name"
  );
  if (error) return { options: [], error: error.message };
  return {
    options: data
      .filter((e) => e.is_active !== false)
      .map((e) => ({ value: e.id as string, label: e.name as string })),
    error: null,
  };
}
