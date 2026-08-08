import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { versionBatchCost } from "@/lib/productionCost";
import { RecipesList, type RecipeRow } from "@/components/production/RecipesList";

/**
 * The recipe families — the kitchen binder, costed.
 *
 * A row is a FAMILY and its figures come from its MASTER version, which is the
 * one costing reads and the one the PDF prints by default.
 */
export default async function RecipesPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const locationId = session.activeLocation?.id ?? null;

  const [{ data: recipes, error }, { graph, error: graphError }] = await Promise.all([
    supabase
      .from("production_recipes")
      .select(
        `id, name, recipe_type, is_active, element_id,
         production_elements ( id, name ),
         production_recipe_versions ( id, version_label, is_master, yield_amount, yield_unit )`
      )
      .order("name"),
    loadProductionGraph(supabase),
  ]);

  if (error || graphError) {
    const message = error?.message ?? graphError ?? "";
    return (
      <p className="text-sm text-accent">
        Could not load recipes: {message}
        {/production_/.test(message) ? " — migration 036 has not been applied yet." : ""}
      </p>
    );
  }

  // The master version's lines, for the batch cost. `loadProductionGraph`
  // already holds them keyed by element, so this needs no further query.
  const rows: RecipeRow[] = (recipes ?? []).map((r) => {
    const element = Array.isArray(r.production_elements)
      ? r.production_elements[0]
      : r.production_elements;
    const versions = (r.production_recipe_versions ?? []) as {
      id: string;
      version_label: string;
      is_master: boolean;
      yield_amount: number | null;
      yield_unit: string | null;
    }[];
    const master = versions.find((v) => v.is_master) ?? null;

    const node = graph!.byId.get(r.element_id as string);
    // Only cost from the graph's master if it IS this family's master — an
    // element with two families has one master in the graph and the other
    // family must not borrow it.
    const costable = node?.master && master && node.master.id === master.id ? node.master : null;
    const batchCost = costable
      ? versionBatchCost(costable, graph!.byId, locationId)
      : { cost: null, unit: null, unresolved: [] };

    return {
      id: r.id as string,
      name: r.name as string,
      recipe_type: (r.recipe_type ?? null) as string | null,
      is_active: (r.is_active ?? true) as boolean,
      elementId: r.element_id as string,
      elementName: (element?.name ?? "—") as string,
      versionCount: versions.length,
      masterLabel: master?.version_label ?? null,
      batchCost,
      yieldAmount: master?.yield_amount === null || master?.yield_amount === undefined
        ? null
        : Number(master.yield_amount),
      yieldUnit: master?.yield_unit ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Recipes
      </h1>
      <RecipesList rows={rows} editable={editable} />
    </div>
  );
}
