"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { type PickOption } from "@/components/ui/PickList";
import { confirmDialog, splitConfirmMessage, alertDialog } from "@/lib/confirm";
import { recipeHref, type RecipeTab } from "@/lib/recipes";
import { NewRecipe } from "./NewRecipe";
import { AddIngredientDialog } from "./AddIngredientDialog";
import { AddStepDialog } from "./AddStepDialog";
import { PrintRecipe } from "./PrintRecipe";
import type { SheetVersion } from "./RecipeVersionSheet";
import {
  deleteRecipe,
  duplicateRecipe,
  newRecipeVersion,
  recipeDeleteCounts,
  recipeDeleteMessage,
} from "./recipeWrites";

/**
 * THE RECIPE RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12), in the
 * title row where Print sheet stood:
 *
 *   New Recipe… · Duplicate Recipe · New Version · — · Print Sheet · — ·
 *   Delete Recipe…
 *
 * Adding ingredient lines, dividers, spacers and steps is each ROW's ⋯ since
 * 2026-11-03 (the new row goes below it). Add Ingredient… and Add Procedure…
 * stay here only for a version with no lines or no steps, which has no row to
 * open a ⋯ on.
 *
 * NEW VERSION (2026-11-03) copies the version on screen into this recipe as
 * the next number and opens it on Info, where Make master is — the copy is not
 * the master until you say so (`newRecipeVersion`).
 *
 * `NewRecipe` and `PrintRecipe` keep owning their dialog and their window and
 * hand their rows out through render props (`OrderCommandMenu`'s arrangement).
 *
 * BOTH ADDS ARE DIALOGS (Mark, 2026-09-12), written against the version on
 * screen so they work from any tab, and each takes you to its own tab once the
 * row is in. The add rows that stood under the two lists are gone.
 *
 * Below the Page Permissions sheet's write cell the menu holds Print Sheet
 * alone, which is a read.
 */
export function RecipeCommandMenu({
  recipeId,
  recipeName,
  orgId,
  orgName,
  version,
  tab,
  params,
  editable,
  elements,
  types,
}: {
  recipeId: string;
  recipeName: string;
  orgId: string;
  orgName: string;
  /** The version on screen, or null for a recipe with none. */
  version: SheetVersion | null;
  tab: RecipeTab;
  params: Record<string, string | string[] | undefined>;
  editable: boolean;
  elements: PickOption[];
  types: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ADD PROCEDURE… moved to each step's ⋯ too (2026-11-03), adding below that
  // step; a version with NO steps keeps it here, having no step to open one on.
  const [stepOpen, setStepOpen] = useState(false);

  // ADD INGREDIENT, DIVIDER AND SPACER MOVED to each ingredient row's ⋯
  // (Mark, 2026-11-03), where they add BELOW that row. Only a version with NO
  // lines keeps Add Ingredient… here, because it has no row to open a ⋯ on.
  const [lineOpen, setLineOpen] = useState(false);

  async function duplicate() {
    setBusy("Duplicating…");
    setError(null);
    const result = await duplicateRecipe(supabase, recipeId);
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      if (result.id) router.push(`/recipes/${result.id}`);
      return;
    }
    if (result.warning) {
      await alertDialog({ title: "Recipe duplicated", body: result.warning });
    }
    router.push(`/recipes/${result.id}`);
  }

  async function addVersion() {
    if (!version) return;
    setBusy("Copying…");
    setError(null);
    const result = await newRecipeVersion(supabase, recipeId, version.id);
    setBusy(null);
    if ("error" in result) setError(result.error);
    else if (result.warning) await alertDialog({ title: `v${result.label} created`, body: result.warning });
    if (result.label) {
      router.push(recipeHref(recipeId, { tab: "info", version: result.label }, params));
      router.refresh();
    }
  }

  async function remove() {
    setError(null);
    const counts = await recipeDeleteCounts(supabase, recipeId);
    if ("error" in counts) {
      setError(counts.error);
      return;
    }
    const ok = await confirmDialog({
      ...splitConfirmMessage(recipeDeleteMessage(recipeName, counts)),
      confirmLabel: "Delete recipe",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("Deleting…");
    const result = await deleteRecipe(supabase, recipeId, counts.imagePaths);
    if ("error" in result) {
      setBusy(null);
      setError(result.error);
      return;
    }
    router.push("/recipes");
    router.refresh();
  }

  const menu = (newRow: ActionMenuItem | null, printRow: ActionMenuItem | null) => {
    const items: ActionMenuItem[] = [];
    if (editable) {
      if (newRow) items.push(newRow);
      items.push({ label: "Duplicate Recipe", onSelect: () => void duplicate() });
      items.push({ label: "New Version", onSelect: () => void addVersion(), disabled: !version });
      if (version && version.lines.length === 0) {
        items.push({ label: "Add Ingredient…", onSelect: () => setLineOpen(true), separatorBefore: true });
      }
      if (version && version.steps.length === 0) {
        items.push({
          label: "Add Procedure…",
          onSelect: () => setStepOpen(true),
          separatorBefore: version.lines.length !== 0,
        });
      }
    }
    items.push(
      printRow
        ? { ...printRow, separatorBefore: editable }
        : { label: "Print Sheet", disabled: true, separatorBefore: editable }
    );
    if (editable) {
      items.push({
        label: "Delete Recipe…",
        onSelect: () => void remove(),
        danger: true,
        separatorBefore: true,
      });
    }
    return (
      <ActionMenu
        label={busy ?? "Actions"}
        disabled={busy !== null}
        ariaLabel={`Actions for ${recipeName}`}
        minWidth={220}
        items={items}
      />
    );
  };

  const withPrint = (newRow: ActionMenuItem | null) =>
    version ? (
      <PrintRecipe recipeName={recipeName} orgName={orgName} version={version}>
        {(printRow) => menu(newRow, printRow)}
      </PrintRecipe>
    ) : (
      menu(newRow, null)
    );

  return (
    <div className="flex flex-col items-end gap-2">
      {editable ? (
        <NewRecipe orgId={orgId} elements={elements} types={types}>
          {(newRow) => withPrint(newRow)}
        </NewRecipe>
      ) : (
        withPrint(null)
      )}
      {error ? <p className="max-w-sm text-right text-[13px] text-accent">{error}</p> : null}

      {lineOpen && version ? (
        <AddIngredientDialog
          orgId={version.org_id}
          versionId={version.id}
          versionLabel={version.version_label}
          elements={elements}
          placement={{ sort: 10, renumber: [] }}
          onClose={() => setLineOpen(false)}
          onAdded={() => {
            setLineOpen(false);
            if (tab !== "ingredients") {
              const v = params.v;
              router.push(
                recipeHref(recipeId, { tab: "ingredients", version: Array.isArray(v) ? v[0] : v ?? null }, params)
              );
            } else {
              router.refresh();
            }
          }}
        />
      ) : null}

      {stepOpen && version ? (
        <AddStepDialog
          orgId={version.org_id}
          versionId={version.id}
          versionLabel={version.version_label}
          placement={{ sort: 10, renumber: [] }}
          onClose={() => setStepOpen(false)}
          onAdded={() => {
            setStepOpen(false);
            if (tab !== "procedure") {
              const v = params.v;
              router.push(
                recipeHref(recipeId, { tab: "procedure", version: Array.isArray(v) ? v[0] : v ?? null }, params)
              );
            } else {
              router.refresh();
            }
          }}
        />
      ) : null}
    </div>
  );
}
