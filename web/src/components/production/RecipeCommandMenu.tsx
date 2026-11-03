"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { type PickOption } from "@/components/ui/PickList";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { confirmDialog, splitConfirmMessage, alertDialog } from "@/lib/confirm";
import { recipeHref, type RecipeTab } from "@/lib/recipes";
import { NewRecipe } from "./NewRecipe";
import { AddIngredientDialog } from "./AddIngredientDialog";
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
 *   New Recipe… · Duplicate Recipe · New Version · — · Add Procedure… · — ·
 *   Print Sheet · — · Delete Recipe…
 *
 * Adding ingredient lines, dividers and spacers is each ROW's ⋯ since
 * 2026-11-03 (the line goes below the row). Add Ingredient… stays here only
 * for a version with no lines, which has no row to open a ⋯ on.
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

  // ADD PROCEDURE IS A DIALOG (Mark, 2026-09-12: "can we use a dialogue box
  // instead of putting something in the footer?"). A step is prose, and a
  // one-line box at the foot of the pane was a cramped place to write a
  // paragraph. Written here, against the version on screen, so it works from
  // any tab; on another tab it takes you to Procedure once the step is in.
  const [stepOpen, setStepOpen] = useState(false);
  const [stepBody, setStepBody] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepPending, startStep] = useTransition();

  function closeStep() {
    if (stepPending) return;
    setStepOpen(false);
    setStepBody("");
    setStepError(null);
  }

  function addStep() {
    if (!version || stepBody.trim() === "") return;
    const lastSort = version.steps.reduce<number>(
      (a, st) => (st.sort === null ? a : Math.max(a, st.sort)),
      0
    );
    setStepError(null);
    startStep(async () => {
      const { data, error: e } = await supabase
        .from("production_recipe_steps")
        .insert({
          // EXPLICITLY — design rule 1.
          org_id: version.org_id,
          version_id: version.id,
          // Last plus ten, FileMaker's habit, so a step can go between two.
          sort: lastSort + 10,
          body: stepBody.trim(),
        })
        .select("id");
      if (e || !data?.length) {
        setStepError(e?.message ?? "Nothing was added — the database refused the insert.");
        return;
      }
      setStepOpen(false);
      setStepBody("");
      if (tab !== "procedure") {
        const v = params.v;
        router.push(
          recipeHref(recipeId, { tab: "procedure", version: Array.isArray(v) ? v[0] : v ?? null }, params)
        );
      } else {
        router.refresh();
      }
    });
  }

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
      items.push({
        label: "Add Procedure…",
        onSelect: () => setStepOpen(true),
        disabled: !version,
        separatorBefore: !(version && version.lines.length === 0),
      });
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
        <Dialog
          title={`Add a step to v${version.version_label}`}
          onClose={closeStep}
          busy={stepPending}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={closeStep}
                disabled={stepPending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addStep}
                disabled={stepPending || stepBody.trim() === ""}
                className={DIALOG_COMMIT_CLASS}
              >
                {stepPending ? "Adding…" : "Add Step"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <textarea
              value={stepBody}
              onChange={(e) => setStepBody(e.target.value)}
              onKeyDown={(e) => {
                // ⌘↵ adds, the app's multiline commit; a plain Enter is a newline.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  addStep();
                }
              }}
              rows={6}
              autoFocus
              aria-label="What happens in this step"
              className={FORM_TEXTAREA}
            />
            {stepError ? <p className="text-[13px] text-accent">{stepError}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
