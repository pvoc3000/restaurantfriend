import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph } from "@/lib/productionQueries";
import { lineCost, versionBatchCost } from "@/lib/productionCost";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { RecipeVersions } from "@/components/production/RecipeVersions";
import type { SheetLine, SheetVersion } from "@/components/production/RecipeVersionSheet";

/**
 * One recipe family, and whichever version you are reading.
 *
 * Costs are live — the batch figure, and every line's contribution — so a
 * flour price that moved this morning shows here this afternoon. Nothing on
 * this screen is a stored cost, which is decision 11.
 */
export async function RecipeDetail({
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

  const [{ data: recipe, error }, { graph, error: graphError }] = await Promise.all([
    supabase
      .from("production_recipes")
      .select(
        `id, name, recipe_type, is_active, element_id,
         production_elements ( id, name ),
         production_recipe_versions (
           id, version_label, version_sort, is_master, is_active, author, description,
           note, testing_notes, yield_amount, yield_unit, mixer_size, prep_time,
           shelf_life, storage, tools, scale_labels, scale_multipliers,
           production_recipe_lines ( id, label, qty, unit, note, sort, element_id ),
           production_recipe_steps ( id, sort, body )
         )`
      )
      .eq("id", id)
      .maybeSingle(),
    loadProductionGraph(supabase),
  ]);

  if (error || graphError) {
    const message = error?.message ?? graphError ?? "";
    return (
      <p className="text-sm text-accent">
        Could not load this recipe: {message}
        {/production_/.test(message) ? " — migration 036 has not been applied yet." : ""}
      </p>
    );
  }
  if (!recipe) notFound();

  const element = Array.isArray(recipe.production_elements)
    ? recipe.production_elements[0]
    : recipe.production_elements;

  type RawVersion = {
    id: string;
    version_label: string;
    version_sort: number | null;
    is_master: boolean;
    is_active: boolean;
    author: string | null;
    description: string | null;
    note: string | null;
    testing_notes: string | null;
    yield_amount: number | null;
    yield_unit: string | null;
    mixer_size: string | null;
    prep_time: string | null;
    shelf_life: string | null;
    storage: string | null;
    tools: string | null;
    scale_labels: string[] | null;
    scale_multipliers: number[] | null;
    production_recipe_lines: {
      id: string;
      label: string | null;
      qty: number | null;
      unit: string | null;
      note: string | null;
      sort: number | null;
      element_id: string | null;
    }[];
    production_recipe_steps: { id: string; sort: number | null; body: string }[];
  };

  const raw = (recipe.production_recipe_versions ?? []) as RawVersion[];

  const versions: SheetVersion[] = raw
    // Newest first — a baker opening a recipe wants what they make today, and
    // FMP's own version list reads the same way.
    .slice()
    .sort((a, b) => (Number(b.version_sort) || 0) - (Number(a.version_sort) || 0))
    .map((v) => {
      const lines: SheetLine[] = (v.production_recipe_lines ?? [])
        .slice()
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((l) => {
          const node = l.element_id ? graph!.byId.get(l.element_id) : null;
          return {
            id: l.id,
            label: l.label,
            qty: l.qty === null ? null : Number(l.qty),
            unit: l.unit,
            note: l.note,
            sort: l.sort,
            elementId: l.element_id,
            elementName: node?.name ?? null,
            cost: lineCost(
              {
                id: l.id,
                label: l.label,
                qty: l.qty === null ? null : Number(l.qty),
                unit: l.unit,
                element_id: l.element_id,
              },
              graph!.byId,
              locationId
            ),
          };
        });

      return {
        id: v.id,
        version_label: v.version_label,
        is_master: v.is_master,
        is_active: v.is_active,
        author: v.author,
        description: v.description,
        note: v.note,
        testing_notes: v.testing_notes,
        yield_amount: v.yield_amount === null ? null : Number(v.yield_amount),
        yield_unit: v.yield_unit,
        mixer_size: v.mixer_size,
        prep_time: v.prep_time,
        shelf_life: v.shelf_life,
        storage: v.storage,
        tools: v.tools,
        scale_labels: v.scale_labels,
        scale_multipliers: v.scale_multipliers?.map(Number) ?? null,
        lines,
        steps: (v.production_recipe_steps ?? [])
          .slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
        batchCost: versionBatchCost(
          {
            id: v.id,
            yield_amount: v.yield_amount === null ? null : Number(v.yield_amount),
            yield_unit: v.yield_unit,
            lines: lines.map((l) => ({
              id: l.id,
              label: l.label,
              qty: l.qty,
              unit: l.unit,
              element_id: l.elementId,
            })),
          },
          graph!.byId,
          locationId
        ),
      };
    });

  const trail = parseTrail(rawParams, { href: "/recipes", label: "Recipes" });

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={recipe.name as string}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {recipe.name as string}
          </h1>
          {!recipe.is_active ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
          ) : null}
        </div>
        <p className="text-[13px] text-muted">
          Makes{" "}
          {element ? (
            <Link
              href={withFrom(`/elements/${element.id as string}`, {
                href: `/recipes/${id}`,
                label: recipe.name as string,
              })}
              className="font-medium text-ink hover:underline"
            >
              {element.name as string}
            </Link>
          ) : (
            "—"
          )}
          {recipe.recipe_type ? ` · ${recipe.recipe_type as string}` : ""}
        </p>
      </div>

      <RecipeVersions
        recipeName={recipe.name as string}
        elementName={(element?.name ?? null) as string | null}
        versions={versions}
        editable={editable}
      />
    </div>
  );
}
