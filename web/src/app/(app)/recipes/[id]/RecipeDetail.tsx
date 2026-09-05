import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { loadProductionGraph, loadElementOptions } from "@/lib/productionQueries";
import { versionBatchCost, laborCells, costContext } from "@/lib/productionCost";
import { scaleColumns } from "@/lib/production";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import { RecipeVersions } from "@/components/production/RecipeVersions";
import { RecipeVersionSheet } from "@/components/production/RecipeVersionSheet";
import { RecipeInfo } from "@/components/production/RecipeInfo";
import { SectionNav } from "@/components/ui/SectionNav";
import { RECIPE_IMAGE_BUCKET, RECIPE_IMAGE_TTL_SECONDS } from "@/lib/recipeImages";
import {
  RECIPE_TABS,
  RECIPE_TAB_LABEL,
  parseRecipeTab,
  parseRecipeVersion,
  recipeHref,
} from "@/lib/recipes";
import type { SheetLine, SheetVersion } from "@/components/production/RecipeVersionSheet";
import { canEditPage } from "@/lib/pageAccess";

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
  const editable = canEditPage(session.membership.role, "/recipes");
  // The WORKING shop, and its labour rate: both are costing inputs (Mark,
  // 2026-08-12, "each location has its own vendor item and labor costs") — a
  // price override beats the catalog price, and a recipe's prep time is hours
  // until this shop's rate turns it into money.
  const costs = costContext(session.activeLocation);

  const [
    { data: recipe, error },
    { graph, error: graphError },
    { options: elementOptions },
  ] = await Promise.all([
    supabase
      .from("production_recipes")
      .select(
        `id, name, recipe_type, is_active, element_id,
         production_elements ( id, name ),
         production_recipe_versions (
           id, org_id, version_label, version_sort, is_master, is_active, author, description,
           note, testing_notes, yield_amount, yield_unit,
           shelf_life, storage, tools, scale_labels, scale_multipliers,
           created_at, updated_at, cost_column, source_payload,
           production_recipe_lines (
             id, label, qty, unit, note, sort, element_id,
             scale_auto, scale_amounts, scale_units, hide_on_print
           ),
           production_recipe_steps ( id, sort, body, image_path, image_name )
         )`
      )
      .eq("id", id)
      .maybeSingle(),
      loadProductionGraph(supabase),
      // The ingredient picker's vocabulary — active elements only, which the
      // costing graph beside it deliberately cannot answer (it loads retired
      // ones too, because a resolver has to price what is already on a recipe).
      loadElementOptions(supabase),
    ]);

  if (error || graphError) {
    const message = error?.message ?? graphError ?? "";
    return (
      <p className="text-sm text-accent">
        Could not load this recipe: {message}
        {/cost_column/.test(message)
          ? " — migration 042 has not been applied yet."
          : /scale_auto|hide_on_print|image_path/.test(message)
          ? " — migration 041 has not been applied yet."
          : /production_/.test(message)
            ? " — migration 036 has not been applied yet."
            : ""}
      </p>
    );
  }
  if (!recipe) notFound();

  const element = Array.isArray(recipe.production_elements)
    ? recipe.production_elements[0]
    : recipe.production_elements;

  type RawVersion = {
    id: string;
    org_id: string;
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
    shelf_life: string | null;
    storage: string | null;
    tools: string | null;
    scale_labels: string[] | null;
    scale_multipliers: number[] | null;
    created_at: string | null;
    updated_at: string | null;
    cost_column: number | null;
    source_payload: { fmp_modified_at?: string | null } | null;
    production_recipe_lines: {
      id: string;
      label: string | null;
      qty: number | null;
      unit: string | null;
      note: string | null;
      sort: number | null;
      element_id: string | null;
      scale_auto: boolean | null;
      scale_amounts: (number | string | null)[] | null;
      scale_units: (string | null)[] | null;
      hide_on_print: boolean | null;
    }[];
    production_recipe_steps: {
      id: string;
      sort: number | null;
      body: string;
      image_path: string | null;
      image_name: string | null;
    }[];
  };

  const raw = (recipe.production_recipe_versions ?? []) as RawVersion[];

  // SIGNED SERVER-SIDE, in ONE batch across every version's steps — a URL built
  // to expire shouldn't outlive the page, and one round trip beats one per
  // picture. `createSignedUrls` answers in the order it was asked, but it also
  // reports per-item errors, so the answers are keyed by path rather than
  // zipped by position.
  const imagePaths = raw.flatMap((v) =>
    (v.production_recipe_steps ?? []).map((s) => s.image_path).filter((p): p is string => !!p)
  );
  const signed = new Map<string, string>();
  if (imagePaths.length) {
    const { data } = await supabase.storage
      .from(RECIPE_IMAGE_BUCKET)
      .createSignedUrls(imagePaths, RECIPE_IMAGE_TTL_SECONDS);
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) signed.set(row.path, row.signedUrl);
    }
  }

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
            // `numeric[]` arrives as strings, the way every other numeric
            // column here does — an unconverted strip silently sorts and
            // compares as text.
            scaleAuto: l.scale_auto !== false,
            scaleAmounts:
              l.scale_amounts?.map((n) =>
                n === null || n === "" ? null : Number(n)
              ) ?? null,
            scaleUnits: l.scale_units ?? null,
            hideOnPrint: l.hide_on_print === true,
          };
        });

      return {
        id: v.id,
        org_id: v.org_id,
        version_label: v.version_label,
        is_master: v.is_master,
        is_active: v.is_active,
        author: v.author,
        description: v.description,
        note: v.note,
        testing_notes: v.testing_notes,
        yield_amount: v.yield_amount === null ? null : Number(v.yield_amount),
        yield_unit: v.yield_unit,
        shelf_life: v.shelf_life,
        storage: v.storage,
        tools: v.tools,
        scale_labels: v.scale_labels,
        scale_multipliers: v.scale_multipliers?.map(Number) ?? null,
        created_at: v.created_at,
        updated_at: v.updated_at,
        fmp_modified_at: v.source_payload?.fmp_modified_at ?? null,
        cost_column: v.cost_column === null ? null : Number(v.cost_column),
        lines,
        steps: (v.production_recipe_steps ?? [])
          .slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((s) => ({
            id: s.id,
            sort: s.sort,
            body: s.body,
            imagePath: s.image_path,
            imageName: s.image_name,
            imageUrl: s.image_path ? (signed.get(s.image_path) ?? null) : null,
          })),
        // ONE `CostVersion` FOR BOTH, and it must carry the scale strips —
        // `laborResolver` reads a labour line's hours AT THE COLUMN through
        // `columnCell`, so a line whose typed strip was dropped on the way in
        // would silently fall back to the base hours on every batch size.
        // `versionBatchCost` used to be handed a stripped-down copy here; it
        // ignores the strips itself, but sharing one object is what stops the
        // two disagreeing about what a line says.
        ...(() => {
          const cv = {
            id: v.id,
            lines: lines.map((l) => ({
              id: l.id,
              label: l.label,
              qty: l.qty,
              unit: l.unit,
              element_id: l.elementId,
              scaleAuto: l.scaleAuto,
              scaleAmounts: l.scaleAmounts,
              scaleUnits: l.scaleUnits,
            })),
            scale_labels: v.scale_labels,
            scale_multipliers: v.scale_multipliers,
            cost_column: v.cost_column === null ? null : Number(v.cost_column),
          };
          const cols = scaleColumns(v.scale_labels, v.scale_multipliers);
          const base = cols.filter((c) => !c.isPercent)[0];
          return {
            // Resolved on the SERVER, because pricing a labour element needs the
            // costing graph — and MATERIALIZED, because the sheet is a client
            // component and a function cannot cross that boundary. See
            // `laborCells`.
            labor: laborCells(
              cv, graph!.byId, costs, cols, base?.multiplier ?? 1, base?.index ?? 0
            ),
            batchCost: versionBatchCost(cv, graph!.byId, costs),
          };
        })(),
      };
    });


  const trail = parseTrail(rawParams, { href: "/recipes", label: "Recipes" });

  // The section and the version both come off the URL — view state, this app's
  // rule, and here also what keeps the two tabs agreeing about which version
  // you are reading. A `?v=` naming nothing falls through to the master rather
  // than to an empty screen, so a link shared before a version was retired
  // still lands on the recipe.
  const tab = parseRecipeTab(rawParams.tab);
  const wanted = parseRecipeVersion(rawParams.v);
  const current =
    versions.find((v) => v.version_label === wanted) ??
    versions.find((v) => v.is_master) ??
    versions[0] ??
    null;

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={recipe.name as string}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} carry={["tab"]} />}
      />

      {/* The identity block sits ABOVE the split and is INDENTED to the content
          column: `lg:ml-36` is the sidebar's `lg:w-28` plus the row's `lg:gap-8`.
          THOSE THREE VALUES ARE COUPLED — change one and the heading drifts off
          the content it belongs to. The employee record is the worked example,
          and it keeps the wider `w-40`: it has five sections with longer words
          ("Employment"), where this has two. */}
      <div className="space-y-3 lg:ml-36">
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

        {current ? (
          <RecipeVersions
            recipeId={id}
            recipeName={recipe.name as string}
            orgName={session.orgName}
            versions={versions}
            current={current}
            tab={tab}
            params={rawParams}
          />
        ) : null}
      </div>

      {!current ? (
        <p className="text-[13px] text-muted">This recipe has no versions yet.</p>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Two orientations in their own visibility wrappers rather than a
              responsive utility on the control: Tailwind resolves competing
              utilities by STYLESHEET order, so a `hidden` passed in className
              would not reliably beat the component's own `flex`. */}
          <div className="lg:hidden">
            <SectionNav
              orientation="horizontal"
              ariaLabel="Recipe sections"
              value={tab}
              items={RECIPE_TABS.map((key) => ({
                key,
                label: RECIPE_TAB_LABEL[key],
                href: recipeHref(id, { tab: key, version: wanted }, rawParams),
              }))}
            />
          </div>
          {/* NARROWER THAN THE EMPLOYEE RECORD'S, and the width is the point (Mark,
              2026-08-11: "the area with the vertical menu on the left side is
              much larger than it needs to be — you can make it smaller to free
              up space for the ingredient list"). It was 160px for two words.
              It went to 64 on that instruction and back up to 128 the same day,
              when the split into three tabs made the longest label
              "Ingredients" rather than "Recipe" — MEASURED at 91px, so 112
              holds it with room. The width follows whatever the labels
              actually are; it is not a number written down once.
              Still 32px narrower than the employee record's, which has five
              sections. */}
          <div className="hidden shrink-0 lg:block lg:w-28">
            <SectionNav
              ariaLabel="Recipe sections"
              value={tab}
              items={RECIPE_TABS.map((key) => ({
                key,
                label: RECIPE_TAB_LABEL[key],
                href: recipeHref(id, { tab: key, version: wanted }, rawParams),
              }))}
            />
          </div>

          {/* Keyed by version: every editor below seeds `useState` from props,
              so without this switching versions would show the old one's values
              in the new one's cells. The order guide's lesson, 2026-07-26. */}
          <div className="min-w-0 flex-1" key={current.id}>
            {tab === "info" ? (
              <RecipeInfo
                recipeId={id}
                version={current}
                versions={versions}
                locationCode={session.activeLocation?.code ?? null}
                editable={editable}
                params={rawParams}
              />
            ) : (
              <RecipeVersionSheet
                version={current}
                editable={editable}
                elementOptions={elementOptions}
                show={tab === "procedure" ? "procedure" : "ingredients"}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
