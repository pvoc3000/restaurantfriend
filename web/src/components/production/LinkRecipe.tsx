"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { recipeMoveNotes, type RecipeLink } from "@/lib/recipes";
import { moveRecipe } from "./recipeWrites";

/** A recipe family, with what the picker says about it. */
export type LinkableRecipe = RecipeLink & { elementName: string; isActive: boolean };

/**
 * Point an existing recipe at this element, from the element's own record —
 * the other end of `RecipeMakes`, writing the same column.
 *
 * EVERY RECIPE ALREADY MAKES SOMETHING, so this is always a move. Each option
 * names the element the recipe makes today, and choosing one spells out what
 * the move does to both elements' costs before anything is written.
 */
export function LinkRecipe({
  elementId,
  elementName,
  recipes,
}: {
  elementId: string;
  elementName: string;
  /** Every recipe family in the org, this element's own included. */
  recipes: LinkableRecipe[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const elementNames = new Map(recipes.map((r) => [r.elementId, r.elementName]));
  elementNames.set(elementId, elementName);
  const notes = recipeId
    ? recipeMoveNotes(recipes, recipeId, elementId, (id) => elementNames.get(id) ?? "—")
    : [];

  function close() {
    if (busy) return;
    setOpen(false);
    setRecipeId("");
    setFailed(null);
  }

  async function link() {
    if (!recipeId || busy) return;
    setBusy(true);
    setFailed(null);
    const result = await moveRecipe(supabase, recipeId, elementId);
    setBusy(false);
    if ("error" in result) {
      setFailed(result.error);
      return;
    }
    setOpen(false);
    setRecipeId("");
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        Link recipe
      </button>

      {open && (
        <Dialog
          title={`Link a recipe to ${elementName}`}
          onClose={close}
          busy={busy}
          onSubmit={() => void link()}
          width="max-w-lg"
          footer={
            <>
              <button type="button" onClick={close} disabled={busy} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void link()}
                disabled={!recipeId || busy}
                className={DIALOG_COMMIT_CLASS}
              >
                {busy ? "Linking…" : "Link recipe"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Recipe
              </span>
              <PickList
                variant="field"
                value={recipeId}
                onPick={setRecipeId}
                options={recipes
                  .filter((r) => r.elementId !== elementId)
                  .map((r) => ({
                    value: r.id,
                    label: r.name,
                    hint: `makes ${r.elementName}`,
                    inactive: !r.isActive,
                  }))}
                ariaLabel="Recipe to link"
                placeholder="Choose a recipe"
              />
            </div>

            {notes.map((note) => (
              <p key={note} className="text-[13px] text-muted">
                {note}
              </p>
            ))}

            {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      )}
    </>
  );
}
