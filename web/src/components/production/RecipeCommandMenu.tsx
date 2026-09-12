"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import type { PickOption } from "@/components/ui/PickList";
import { confirmDialog, splitConfirmMessage, alertDialog } from "@/lib/confirm";
import { recipeHref, type RecipeTab } from "@/lib/recipes";
import { requestRecipeAdd, type RecipeAddKind } from "@/lib/recipeAddRequest";
import { NewRecipe } from "./NewRecipe";
import { PrintRecipe } from "./PrintRecipe";
import type { SheetVersion } from "./RecipeVersionSheet";
import {
  deleteRecipe,
  duplicateRecipe,
  recipeDeleteCounts,
  recipeDeleteMessage,
} from "./recipeWrites";

/**
 * THE RECIPE RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12), in the
 * title row where Print sheet stood:
 *
 *   New Recipe… · Duplicate Recipe · — · Add Ingredient… · Add Procedure… · — ·
 *   Print Sheet · — · Delete Recipe…
 *
 * `NewRecipe` and `PrintRecipe` keep owning their dialog and their window and
 * hand their rows out through render props (`OrderCommandMenu`'s arrangement).
 *
 * THE ADD ROWS ASK THE SHEET. The sheet's add row lives inside a tab, and the
 * two are siblings under a server component; the menu posts a request
 * (`lib/recipeAddRequest`) and, when you are on another tab, navigates to the
 * right one first — the request is a module value, so it survives the trip.
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

  function add(what: RecipeAddKind) {
    const wantTab: RecipeTab = what === "ingredient" ? "ingredients" : "procedure";
    requestRecipeAdd(what);
    if (tab !== wantTab) {
      const v = params.v;
      router.push(
        recipeHref(recipeId, { tab: wantTab, version: Array.isArray(v) ? v[0] : v ?? null }, params)
      );
    }
  }

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
      items.push({
        label: "Add Ingredient…",
        onSelect: () => add("ingredient"),
        disabled: !version,
        separatorBefore: true,
      });
      items.push({ label: "Add Procedure…", onSelect: () => add("step"), disabled: !version });
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
    </div>
  );
}
