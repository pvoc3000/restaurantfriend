import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { elementCost, costContext } from "@/lib/productionCost";
import { ElementsList, type ElementRow } from "@/components/production/ElementsList";
import { NewElement } from "@/components/production/NewElement";
import { elementTypeVocabulary, type ElementKind } from "@/lib/production";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";

/**
 * The element catalog — production brief decision 2's merged component
 * vocabulary, where FileMaker had two tables built at different times.
 *
 * Costs are resolved HERE, on the server, from a graph loaded in four queries
 * (see `loadProductionGraph`). They are never stored: decision 11, and the
 * reason FMP still shows 2022 prices in 2026.
 */
export default async function ElementsPage({
  searchParams,
}: {
  // The filter menus and the search box live in the URL, so a view survives a
  // trip into an element and back — and can be sent to somebody. They are
  // passed through RAW: which values are real depends on the vocabulary the
  // column actually holds, which only the list itself knows.
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

  const [{ graph, error }, { data: catalog, error: catalogError }, { data: recipeTypes }] =
    await Promise.all([
      loadProductionGraph(supabase),
      supabase
        .from("production_elements")
        .select("id, name, kind, element_type, schedule_class, is_active")
        .order("name"),
      // Only the New element dialog reads this — the list's own TYPE filter is
      // built from the rows, because a filter has to offer what is actually
      // there or it cannot find anything.
      supabase.from("production_recipes").select("recipe_type").not("recipe_type", "is", null),
    ]);

  if (error || catalogError) {
    const message = error ?? catalogError?.message ?? "";
    return (
      <p className="text-sm text-accent">
        Could not load elements: {message}
        {/production_/.test(message) ? " — migration 036 has not been applied yet." : ""}
      </p>
    );
  }

  const rows: ElementRow[] = (catalog ?? []).map((e) => {
    const node = graph!.byId.get(e.id as string);
    return {
      id: e.id as string,
      name: e.name as string,
      kind: e.kind as ElementKind,
      element_type: (e.element_type ?? null) as string | null,
      schedule_class: (e.schedule_class ?? null) as string | null,
      is_active: (e.is_active ?? true) as boolean,
      cost: node
        ? elementCost(node, graph!.byId, costs)
        : { cost: null, unit: null, unresolved: [] },
      source: graph!.sourceByElement.get(e.id as string) ?? null,
      recipeCount: graph!.recipeCountByElement.get(e.id as string) ?? 0,
    };
  });

  // The recipe types plus Ingredient, matching the element record's own Type
  // menu — a create form offering a different vocabulary than the screen you
  // land on is exactly the drift these shared parts exist to prevent. Still
  // `allowNew`, because a kitchen invents a category faster than a migration
  // can be written.
  const types = elementTypeVocabulary(
    (recipeTypes ?? []).map((t) => t.recipe_type as string | null)
  );

  return (
    <div className="space-y-6">
      <ElementsList
        rows={rows}
        editable={editable}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
        action={
          editable ? (
            <NewElement orgId={session.membership.org_id} types={types} />
          ) : null
        }
      />
    </div>
  );
}
