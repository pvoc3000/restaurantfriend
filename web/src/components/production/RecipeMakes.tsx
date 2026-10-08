"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { OpenRecordLink } from "@/components/ui/OpenRecordLink";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { recipeMoveNotes, type RecipeLink } from "@/lib/recipes";
import { moveRecipe } from "./recipeWrites";

/**
 * Which element a recipe makes — the Makes field at the head of the recipe's
 * Info tab (Mark, 2026-10-08: "move the 'makes' field into the info tab above
 * the description. Give it a regular picklist"). The element record's
 * Inventory item field is the pattern: a boxed picklist, with the arrow past
 * its right edge opening the record it points at.
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
    <span className="flex flex-col items-start gap-1">
      <span className="relative w-full">
        <PickList
          boxed={BOXED_FIELDS}
          value={elementId}
          options={elements}
          onPick={(next) => void pick(next)}
          disabled={busy}
          ariaLabel="Which element this recipe makes"
        />
        <OpenRecordLink href={elementHref} label="Open the element" />
      </span>
      {error ? <span className="text-[13px] text-accent">{error}</span> : null}
    </span>
  );
}
