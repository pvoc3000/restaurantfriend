"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { OpenRecordLink } from "@/components/ui/OpenRecordLink";
import { recipeMoveNotes, type RecipeLink } from "@/lib/recipes";
import { moveRecipe } from "./recipeWrites";

/**
 * Which element a recipe makes, editable where it is read — the "Makes" line
 * under the recipe's name.
 *
 * Until this the element was chosen once, in New Recipe, and a recipe created
 * against the wrong one could not be put right.
 *
 * IT ASKS BEFORE IT WRITES, unlike every other picklist, where choosing is the
 * edit. A recipe makes exactly one element, so a pick here is a move, and a
 * move can change what two elements cost; `recipeMoveNotes` says how.
 */
export function RecipeMakes({
  recipeId,
  elementId,
  elementHref,
  elements,
  recipes,
}: {
  recipeId: string;
  elementId: string;
  /** The element's record, carrying the breadcrumb back to this recipe. */
  elementHref: string;
  /** Every element, retired ones sunk under their own heading. */
  elements: PickOption[];
  /** Every recipe family, for what the move does to costs. */
  recipes: RecipeLink[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(next: string) {
    if (!next || next === elementId) return;
    const nameOf = (id: string) => elements.find((e) => e.value === id)?.label ?? "that element";
    const notes = recipeMoveNotes(recipes, recipeId, next, nameOf);
    const ok = await confirmDialog({
      title: `Make ${nameOf(next)} instead?`,
      body: notes.join("\n\n"),
      confirmLabel: "Change element",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const result = await moveRecipe(supabase, recipeId, next);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <span className="inline-flex items-center gap-1 font-medium text-ink">
        <PickList
          value={elementId}
          options={elements}
          onPick={(next) => void pick(next)}
          disabled={busy}
          ariaLabel="Which element this recipe makes"
          panelMinWidth={280}
        />
        <OpenRecordLink href={elementHref} label="Open the element" placement="inline" />
      </span>
      {error ? <span className="text-accent">{error}</span> : null}
    </>
  );
}
