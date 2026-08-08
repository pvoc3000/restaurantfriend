import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { elementCost } from "@/lib/productionCost";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ElementFields } from "@/components/production/ElementFields";
import { ElementLocationRows } from "@/components/production/ElementLocationRows";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import type { ElementKind } from "@/lib/production";

/**
 * One element: what it is, what it costs today, where its recipes are, and what
 * each shop keeps on hand.
 */
export async function ElementDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const locationId = session.activeLocation?.id ?? null;

  const [{ data: element, error }, { graph }, { data: recipes }, { data: locations }, { data: types }] =
    await Promise.all([
      supabase
        .from("production_elements")
        .select(
          `id, name, kind, element_type, schedule_class, manual_cost, manual_cost_unit,
           notes, is_active, inventory_item_id, inventory_items ( id, name )`
        )
        .eq("id", id)
        .maybeSingle(),
      loadProductionGraph(supabase),
      supabase
        .from("production_recipes")
        .select(
          `id, name, recipe_type, is_active,
           production_recipe_versions ( id, version_label, is_master, is_active )`
        )
        .eq("element_id", id)
        .order("name"),
      supabase
        .from("production_element_locations")
        .select("id, location_id, par_by_weekday, stock_count, stock_size, stock_unit, is_active")
        .eq("element_id", id),
      supabase.from("production_elements").select("element_type").not("element_type", "is", null),
    ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this element: {error.message}
        {/production_/.test(error.message) ? " — migration 036 has not been applied yet." : ""}
      </p>
    );
  }
  if (!element) notFound();

  const node = graph?.byId.get(id) ?? null;
  const cost = node
    ? elementCost(node, graph!.byId, locationId)
    : { cost: null, unit: null, unresolved: [] };

  const inventory = Array.isArray(element.inventory_items)
    ? element.inventory_items[0]
    : element.inventory_items;

  const typeVocabulary = [
    ...new Set((types ?? []).map((t) => t.element_type as string).filter(Boolean)),
  ].sort();

  const trail = parseTrail(rawParams, { href: "/elements", label: "Elements" });

  return (
    <div className="space-y-16">
      <div className="space-y-6">
        <Breadcrumbs
          trail={trail}
          current={element.name as string}
          trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
        />

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {element.name as string}
          </h1>
          {!element.is_active ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
          ) : null}
        </div>

        <ElementFields
          element={{
            id,
            name: element.name as string,
            kind: element.kind as ElementKind,
            element_type: (element.element_type ?? null) as string | null,
            schedule_class: (element.schedule_class ?? null) as string | null,
            manual_cost: element.manual_cost === null ? null : Number(element.manual_cost),
            manual_cost_unit: (element.manual_cost_unit ?? null) as string | null,
            notes: (element.notes ?? null) as string | null,
            inventory_item_id: (element.inventory_item_id ?? null) as string | null,
            inventoryName: (inventory?.name ?? null) as string | null,
          }}
          cost={cost}
          types={typeVocabulary}
          editable={editable}
        />
      </div>

      <section className="space-y-2">
        <SectionHeading count={(recipes ?? []).length}>Recipes</SectionHeading>
        {(recipes ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">
            {element.kind === "made"
              ? "No recipe yet — a made element costs nothing until it has one."
              : "None. Only a made element is described by a recipe."}
          </p>
        ) : (
          <ul className="space-y-1">
            {(recipes ?? []).map((r) => {
              const versions = (r.production_recipe_versions ?? []) as {
                id: string;
                version_label: string;
                is_master: boolean;
              }[];
              const master = versions.find((v) => v.is_master);
              return (
                <li key={r.id as string} className="text-[14px]">
                  <Link href={`/recipes/${r.id as string}`} className="font-medium hover:underline">
                    {r.name as string}
                  </Link>
                  <span className="ml-3 text-[13px] text-muted">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                    {master ? ` · master v${master.version_label}` : " · no master"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ElementLocationRows
        elementId={id}
        rows={(locations ?? []).map((l) => ({
          id: l.id as string,
          location_id: l.location_id as string,
          par_by_weekday: (l.par_by_weekday ?? null) as number[] | null,
          stock_count: l.stock_count === null ? null : Number(l.stock_count),
          stock_size: l.stock_size === null ? null : Number(l.stock_size),
          stock_unit: (l.stock_unit ?? null) as string | null,
          is_active: (l.is_active ?? true) as boolean,
        }))}
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
