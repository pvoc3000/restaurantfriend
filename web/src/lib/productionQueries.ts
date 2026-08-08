import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostElement } from "./productionCost";

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

export async function loadProductionGraph(
  supabase: SupabaseClient
): Promise<{ graph: ProductionGraph | null; error: string | null }> {
  const [elements, recipes, versions, lines] = await Promise.all([
    supabase
      .from("production_elements")
      .select(
        `id, name, kind, manual_cost, manual_cost_unit, inventory_item_id,
         inventory_items ( id, name, base_unit,
           vendor_items ( id, price, package_content, is_active,
             vendor_item_location_prices ( location_id, price ) ) )`
      ),
    supabase.from("production_recipes").select("id, element_id, name"),
    supabase
      .from("production_recipe_versions")
      .select("id, recipe_id, yield_amount, yield_unit, is_master")
      .eq("is_master", true),
    // Only the master versions' lines are needed for costing, but filtering
    // them here would need the version ids first — a fifth round trip to save
    // a few thousand rows we are already holding. Fetched flat and filtered.
    supabase
      .from("production_recipe_lines")
      .select("id, version_id, element_id, label, qty, unit"),
  ]);

  const failed = [elements, recipes, versions, lines].find((r) => r.error);
  if (failed?.error) return { graph: null, error: failed.error.message };

  const masterByRecipe = new Map<string, { id: string; yield_amount: number | null; yield_unit: string | null }>();
  for (const v of versions.data ?? []) {
    masterByRecipe.set(v.recipe_id as string, {
      id: v.id as string,
      yield_amount: v.yield_amount === null ? null : Number(v.yield_amount),
      yield_unit: (v.yield_unit ?? null) as string | null,
    });
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
  const masterByElement = new Map<string, { id: string; yield_amount: number | null; yield_unit: string | null }>();
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
            id: master.id,
            yield_amount: master.yield_amount,
            yield_unit: master.yield_unit,
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
