import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateTitle } from "@/lib/productionPlans";
import { RECIPE_IMAGE_BUCKET, recipeImagePath } from "@/lib/recipeImages";

/**
 * The recipe record's two whole-family writes — Duplicate and Delete — for the
 * title row's Actions menu (Mark, 2026-09-12). Neither existed before.
 */

type Row = Record<string, unknown>;

/**
 * Columns never carried onto a copy. The rest are copied as `select("*")`
 * returns them, so a column added by a later migration comes along without
 * this list having to learn about it — `ProductionItemActions`' lesson that a
 * hand-written column list goes stale (049 dropped one it named).
 *
 * `legacy_id` is FileMaker's identity; two rows claiming it would corrupt any
 * reconciliation against the export. `source_payload` holds FMP's modified
 * stamp, which the record reads as MODIFIED — a copy made today was not
 * modified in 2022.
 */
const NEVER_COPIED = new Set([
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "legacy_id",
  "source_payload",
]);

function strip(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!NEVER_COPIED.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Copy a recipe family: the recipe, every version, every line and step, and
 * each step's picture as its OWN storage object — 041's policies authorise off
 * the folder, and a shared object would vanish from both when either removed it.
 *
 * THE COPY KEEPS ITS ORIGINAL'S ACTIVE FLAG. That is safe here where a
 * duplicated plan is not: costing takes an element's recipe as the FIRST FAMILY
 * BY NAME (`loadProductionGraph`), and "… copy" sorts after its original, so a
 * copy never changes what anything costs.
 *
 * Parent first, versions one at a time so old→new is certain. No transaction
 * spans it; a failure part way through keeps what it made and says so.
 */
export async function duplicateRecipe(
  supabase: SupabaseClient,
  recipeId: string
): Promise<{ id: string; warning?: string } | { error: string; id?: string }> {
  const { data: recipe, error } = await supabase
    .from("production_recipes")
    .select("*, production_recipe_versions ( *, production_recipe_lines ( * ), production_recipe_steps ( * ) )")
    .eq("id", recipeId)
    .maybeSingle();
  if (error || !recipe) return { error: error?.message ?? "The recipe could not be read." };

  const { data: names } = await supabase.from("production_recipes").select("name");
  const title = duplicateTitle(
    (names ?? []).map((n) => String(n.name)),
    String(recipe.name)
  );

  const { production_recipe_versions: versions, ...head } = recipe as Row & {
    production_recipe_versions: (Row & {
      production_recipe_lines: Row[];
      production_recipe_steps: Row[];
    })[];
  };

  const { data: made, error: recipeError } = await supabase
    .from("production_recipes")
    .insert({ ...strip(head), name: title })
    .select("id")
    .single();
  if (recipeError || !made) {
    return { error: recipeError?.message ?? "The copy could not be created." };
  }
  const newId = made.id as string;
  const orgId = String(head.org_id);
  let lostImages = 0;

  for (const v of versions ?? []) {
    const { production_recipe_lines: lines, production_recipe_steps: steps, ...version } = v;
    const { data: nv, error: vErr } = await supabase
      .from("production_recipe_versions")
      .insert({ ...strip(version), recipe_id: newId })
      .select("id")
      .single();
    if (vErr || !nv) {
      return {
        id: newId,
        error: `${title} was created, but version v${version.version_label} could not be copied: ${vErr?.message ?? "nothing was written"}`,
      };
    }
    const versionId = nv.id as string;

    if (lines?.length) {
      const rows = lines.map((l) => ({ ...strip(l), version_id: versionId }));
      const { data, error: lErr } = await supabase
        .from("production_recipe_lines")
        .insert(rows)
        .select("id");
      if (lErr || data?.length !== rows.length) {
        return {
          id: newId,
          error: `${title} was created, but the ingredients of v${version.version_label} could not be copied: ${lErr?.message ?? "not every line was written"}`,
        };
      }
    }

    if (steps?.length) {
      const rows: Row[] = [];
      for (const s of steps) {
        const row: Row = { ...strip(s), version_id: versionId };
        const from = s.image_path as string | null;
        if (from) {
          const to = recipeImagePath(orgId, versionId, (s.image_name as string | null) ?? from);
          const { error: copyErr } = await supabase.storage.from(RECIPE_IMAGE_BUCKET).copy(from, to);
          if (copyErr) {
            row.image_path = null;
            row.image_name = null;
            lostImages += 1;
          } else {
            row.image_path = to;
          }
        }
        rows.push(row);
      }
      const { data, error: sErr } = await supabase
        .from("production_recipe_steps")
        .insert(rows)
        .select("id");
      if (sErr || data?.length !== rows.length) {
        return {
          id: newId,
          error: `${title} was created, but the procedure of v${version.version_label} could not be copied: ${sErr?.message ?? "not every step was written"}`,
        };
      }
    }
  }

  return lostImages > 0
    ? { id: newId, warning: `${lostImages} step picture${lostImages === 1 ? "" : "s"} could not be copied.` }
    : { id: newId };
}

/** What a delete takes with it, counted before asking. */
export async function recipeDeleteCounts(
  supabase: SupabaseClient,
  recipeId: string
): Promise<
  | { versions: number; lines: number; steps: number; batches: number; imagePaths: string[] }
  | { error: string }
> {
  const { data, error } = await supabase
    .from("production_recipe_versions")
    .select("id, production_recipe_lines ( id ), production_recipe_steps ( id, image_path )")
    .eq("recipe_id", recipeId);
  if (error) return { error: error.message };
  const versions = (data ?? []) as {
    id: string;
    production_recipe_lines: { id: string }[];
    production_recipe_steps: { id: string; image_path: string | null }[];
  }[];
  const ids = versions.map((v) => v.id);
  let batches = 0;
  if (ids.length) {
    const { count } = await supabase
      .from("production_batches")
      .select("id", { count: "exact", head: true })
      .in("recipe_version_id", ids);
    batches = count ?? 0;
  }
  return {
    versions: versions.length,
    lines: versions.reduce((n, v) => n + v.production_recipe_lines.length, 0),
    steps: versions.reduce((n, v) => n + v.production_recipe_steps.length, 0),
    batches,
    imagePaths: versions.flatMap((v) =>
      v.production_recipe_steps.map((s) => s.image_path).filter((p): p is string => !!p)
    ),
  };
}

/** The confirm's wording — pure, so the sentence can be read in one place. */
export function recipeDeleteMessage(
  name: string,
  c: { versions: number; lines: number; steps: number; batches: number }
): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    plural(c.versions, "version", "versions"),
    plural(c.lines, "ingredient line", "ingredient lines"),
    plural(c.steps, "procedure step", "procedure steps"),
  ];
  return (
    `Delete "${name}"?\n\n` +
    `Its ${parts.join(", ")} go with it. This cannot be undone.` +
    (c.batches > 0
      ? `\n\n${plural(c.batches, "batch log entry names", "batch log entries name")} one of its versions; ${c.batches === 1 ? "it keeps" : "they keep"} its record but lose the link.`
      : "")
  );
}

/**
 * Delete the family. 036 cascades versions, and those their lines and steps;
 * `production_batches.recipe_version_id` goes null (044). Row FIRST, then the
 * step pictures — an orphan object is invisible and harmless, where a removed
 * picture with its row still naming it is not.
 */
export async function deleteRecipe(
  supabase: SupabaseClient,
  recipeId: string,
  imagePaths: string[]
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await supabase
    .from("production_recipes")
    .delete()
    .eq("id", recipeId)
    .select("id");
  if (error) return { error: error.message };
  // A delete matching no policy removes zero rows and returns NO error.
  if (!data?.length) return { error: "Nothing was deleted — you may not have permission." };
  if (imagePaths.length) await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove(imagePaths);
  return { ok: true };
}
