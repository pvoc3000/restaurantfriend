import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { elementCost, costContext } from "@/lib/productionCost";
import { RecipesList, type RecipeRow } from "@/components/production/RecipesList";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";

/**
 * The recipe families — the kitchen binder, costed.
 *
 * A row is a FAMILY and its figures come from its MASTER version, which is the
 * one costing reads and the one the PDF prints by default.
 */
export default async function RecipesPage({
  searchParams,
}: {
  // The search box, the tier and the sort ride in the URL, so the view survives
  // a trip into a recipe and back.
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  // The WORKING shop, and its labour rate: both are costing inputs (Mark,
  // 2026-08-12, "each location has its own vendor item and labor costs") — a
  // price override beats the catalog price, and a recipe's prep time is hours
  // until this shop's rate turns it into money.
  const costs = costContext(session.activeLocation);

  const [{ data: recipes, error }, { graph, error: graphError }] = await Promise.all([
    supabase
      .from("production_recipes")
      .select(
        `id, name, recipe_type, is_active, element_id,
         production_elements ( id, name ),
         production_recipe_versions ( id, version_label, is_master )`
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

  // The master version's lines, for the cost. `loadProductionGraph` already
  // holds them keyed by element, so this needs no further query.
  const rows: RecipeRow[] = (recipes ?? []).map((r) => {
    const element = Array.isArray(r.production_elements)
      ? r.production_elements[0]
      : r.production_elements;
    const versions = (r.production_recipe_versions ?? []) as {
      id: string;
      version_label: string;
      is_master: boolean;
    }[];
    const master = versions.find((v) => v.is_master) ?? null;

    const node = graph!.byId.get(r.element_id as string);
    // Only cost from the graph's master if it IS this family's master — an
    // element with two families has one master in the graph and the other
    // family must not borrow it.
    const costable = node?.master && master && node.master.id === master.id ? node : null;
    // `elementCost` ITSELF, not a figure assembled here — so a recipe's cost in
    // this list, on the element screen and in the Costs block's headline are
    // one call at one column, labour and all (Mark, 2026-08-12: "just do one
    // calculation … and use it everywhere"). This column used to be
    // `versionBatchCost` under the name "Batch cost", which is ingredients only
    // — the very figure Mark had removed from the recipe screen the same day
    // for being "wrong as it doesn't include labor", still printed here.
    const cost = costable
      ? elementCost(costable, graph!.byId, costs)
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
      cost,
    };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Recipes
        </h1>
        <p className="text-sm text-muted">How to make our item components.</p>
      </div>
      <RecipesList
        rows={rows}
        editable={editable}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
      />
    </div>
  );
}
