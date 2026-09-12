"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { UNIT_PICK_OPTIONS } from "@/lib/units";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { confirmDialog, splitConfirmMessage, alertDialog } from "@/lib/confirm";
import { ingredientChoice, recipeHref, type RecipeTab } from "@/lib/recipes";
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

  // ADD INGREDIENT IS A DIALOG TOO (Mark, the same day: "same with the add
  // ingredient action"). The element is chosen from the catalog, and a name the
  // catalog has never heard of still writes `label` — `ingredientChoice` tells
  // the two apart, the rule the old add row followed. Amount and unit are
  // optional: a line is often added first and weighed later.
  const [lineOpen, setLineOpen] = useState(false);
  const [lineChoice, setLineChoice] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineUnit, setLineUnit] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);
  const [linePending, startLine] = useTransition();
  const elementIds = new Set(elements.map((o) => o.value));
  const qtyValid = lineQty.trim() === "" || Number.isFinite(Number(lineQty));
  const lineReady = lineChoice.trim() !== "" && qtyValid;

  function closeLine() {
    if (linePending) return;
    setLineOpen(false);
    setLineChoice("");
    setLineQty("");
    setLineUnit("");
    setLineError(null);
  }

  function addLine() {
    if (!version || !lineReady) return;
    const choice = ingredientChoice(lineChoice, elementIds);
    if (choice.kind === "clear") return;
    const lastSort = version.lines.reduce<number>(
      (a, l) => (l.sort === null ? a : Math.max(a, l.sort)),
      0
    );
    setLineError(null);
    startLine(async () => {
      const { data, error: e } = await supabase
        .from("production_recipe_lines")
        .insert({
          org_id: version.org_id,
          version_id: version.id,
          sort: lastSort + 10,
          ...(choice.kind === "element" ? { element_id: choice.elementId } : { label: choice.label }),
          qty: lineQty.trim() === "" ? null : Number(lineQty),
          unit: lineUnit.trim() === "" ? null : lineUnit.trim(),
        })
        .select("id");
      if (e || !data?.length) {
        setLineError(e?.message ?? "Nothing was added — the database refused the insert.");
        return;
      }
      setLineOpen(false);
      setLineChoice("");
      setLineQty("");
      setLineUnit("");
      if (tab !== "ingredients") {
        const v = params.v;
        router.push(
          recipeHref(recipeId, { tab: "ingredients", version: Array.isArray(v) ? v[0] : v ?? null }, params)
        );
      } else {
        router.refresh();
      }
    });
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
        onSelect: () => setLineOpen(true),
        disabled: !version,
        separatorBefore: true,
      });
      items.push({ label: "Add Procedure…", onSelect: () => setStepOpen(true), disabled: !version });
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
        <Dialog
          title={`Add an ingredient to v${version.version_label}`}
          onClose={closeLine}
          busy={linePending}
          width="max-w-lg"
          onSubmit={() => {
            if (lineReady && !linePending) addLine();
          }}
          footer={
            <>
              <button
                type="button"
                onClick={closeLine}
                disabled={linePending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addLine}
                disabled={linePending || !lineReady}
                className={DIALOG_COMMIT_CLASS}
              >
                {linePending ? "Adding…" : "Add Ingredient"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Ingredient
              </span>
              <PickList
                variant="field"
                value={lineChoice}
                onPick={setLineChoice}
                options={elements}
                allowNew
                activateTable="production_elements"
                ariaLabel="Ingredient"
                placeholder="Choose an element…"
                className="w-full"
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Amount
                </span>
                <TextInput
                  value={lineQty}
                  onValueChange={setLineQty}
                  inputMode="decimal"
                  aria-label="Amount"
                  fullWidth
                />
              </label>
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Unit
                </span>
                <PickList
                  variant="field"
                  value={lineUnit}
                  onPick={setLineUnit}
                  options={UNIT_PICK_OPTIONS}
                  allowNew
                  clearable
                  ariaLabel="Unit"
                  className="w-full"
                />
              </label>
            </div>
            {!qtyValid ? <p className="text-[13px] text-accent">The amount has to be a number.</p> : null}
            {lineError ? <p className="text-[13px] text-accent">{lineError}</p> : null}
          </div>
        </Dialog>
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
