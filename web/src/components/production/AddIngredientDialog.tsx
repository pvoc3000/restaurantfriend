"use client";

import { useState, useTransition } from "react";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { UNIT_PICK_OPTIONS } from "@/lib/units";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { createClient } from "@/lib/supabase/client";
import { ingredientChoice } from "@/lib/recipes";

/**
 * WHERE A NEW LINE GOES: its Sort, and the existing lines that must be
 * renumbered first to make room (`sortBelow`). An empty `renumber` moves
 * nothing.
 */
export type LinePlacement = {
  sort: number;
  renumber: { id: string; sort: number }[];
};

/**
 * Write a placement's renumbering, then insert the line — in that order, so the
 * new line's Sort is never shared with one still waiting to move. Each write
 * `.select()`s its row: an update RLS filters to nothing returns no error.
 * Shared by Add Ingredient… and the row menu's Add Divider / Add Spacer.
 */
export async function insertLine(
  supabase: ReturnType<typeof createClient>,
  placement: LinePlacement,
  row: Record<string, unknown>
): Promise<string | null> {
  const moved = await Promise.all(
    placement.renumber.map((w) =>
      supabase.from("production_recipe_lines").update({ sort: w.sort }).eq("id", w.id).select("id")
    )
  );
  const failed = moved.find((r) => r.error || !r.data?.length);
  if (failed) return failed.error?.message ?? "The lines could not be renumbered to make room.";
  const { data, error } = await supabase
    .from("production_recipe_lines")
    .insert({ ...row, sort: placement.sort })
    .select("id");
  if (error || !data?.length) return error?.message ?? "Nothing was added — the database refused the insert.";
  return null;
}

/**
 * ADD INGREDIENT… — a dialog (Mark, 2026-09-12), opened since 2026-11-03 from a
 * row's ⋯ and adding BELOW that row; it was the Actions menu's until then.
 *
 * The element is chosen from the catalog, and a name the catalog has never
 * heard of still writes `label` — `ingredientChoice` tells the two apart.
 * Amount and unit are optional: a line is often added first and weighed later.
 */
export function AddIngredientDialog({
  orgId,
  versionId,
  versionLabel,
  elements,
  placement,
  onClose,
  onAdded,
}: {
  orgId: string;
  versionId: string;
  versionLabel: string;
  elements: PickOption[];
  placement: LinePlacement;
  onClose: () => void;
  onAdded: () => void;
}) {
  const supabase = createClient();
  const [choice, setChoice] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const elementIds = new Set(elements.map((o) => o.value));
  const qtyValid = qty.trim() === "" || Number.isFinite(Number(qty));
  const ready = choice.trim() !== "" && qtyValid;

  function close() {
    if (!pending) onClose();
  }

  function add() {
    if (!ready) return;
    const picked = ingredientChoice(choice, elementIds);
    if (picked.kind === "clear") return;
    setError(null);
    start(async () => {
      const failed = await insertLine(supabase, placement, {
        // EXPLICITLY — design rule 1.
        org_id: orgId,
        version_id: versionId,
        ...(picked.kind === "element" ? { element_id: picked.elementId } : { label: picked.label }),
        qty: qty.trim() === "" ? null : Number(qty),
        unit: unit.trim() === "" ? null : unit.trim(),
      });
      if (failed) {
        setError(failed);
        return;
      }
      onAdded();
    });
  }

  return (
    <Dialog
      title={`Add an ingredient to v${versionLabel}`}
      onClose={close}
      busy={pending}
      width="max-w-lg"
      onSubmit={() => {
        if (ready && !pending) add();
      }}
      footer={
        <>
          <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            disabled={pending || !ready}
            className={DIALOG_COMMIT_CLASS}
          >
            {pending ? "Adding…" : "Add Ingredient"}
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
            value={choice}
            onPick={setChoice}
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
            <TextInput value={qty} onValueChange={setQty} inputMode="decimal" aria-label="Amount" fullWidth />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Unit
            </span>
            <PickList
              variant="field"
              value={unit}
              onPick={setUnit}
              options={UNIT_PICK_OPTIONS}
              allowNew
              clearable
              ariaLabel="Unit"
              className="w-full"
            />
          </label>
        </div>
        {!qtyValid ? <p className="text-[13px] text-accent">The amount has to be a number.</p> : null}
        {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
