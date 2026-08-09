import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { elementCost } from "@/lib/productionCost";
import { ElementsList, type ElementRow } from "@/components/production/ElementsList";
import { NewElement } from "@/components/production/NewElement";
import type { ElementKind } from "@/lib/production";
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
  const locationId = session.activeLocation?.id ?? null;

  const [{ graph, error }, { data: catalog, error: catalogError }] = await Promise.all([
    loadProductionGraph(supabase),
    supabase
      .from("production_elements")
      .select("id, name, kind, element_type, schedule_class, is_active")
      .order("name"),
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
        ? elementCost(node, graph!.byId, locationId)
        : { cost: null, unit: null, unresolved: [] },
      source: graph!.sourceByElement.get(e.id as string) ?? null,
      recipeCount: graph!.recipeCountByElement.get(e.id as string) ?? 0,
    };
  });

  // The type vocabulary is whatever exists — a kitchen invents a category
  // faster than a migration can be written, so the picker offers these and
  // allows new ones.
  const types = [...new Set(rows.map((r) => r.element_type).filter(Boolean))].sort() as string[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Elements
        </h1>
        {editable ? (
          <NewElement orgId={session.membership.org_id} types={types} />
        ) : null}
      </div>

      <ElementsList
        rows={rows}
        editable={editable}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
      />
    </div>
  );
}
