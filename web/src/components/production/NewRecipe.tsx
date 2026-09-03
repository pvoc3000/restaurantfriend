"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * Add a recipe — `NewElement`'s template, with one thing that template does not
 * have to do.
 *
 * IT WRITES TWO ROWS, AND A RECIPE WITH NO VERSION WOULD BE USELESS. Every
 * reader here goes through the MASTER version — costing, the printed sheet, the
 * Costs matrix, the record's own default tab — so the create makes v01 and
 * marks it master in the same act. 036 enforces one master per family with a
 * PARTIAL unique index, which is why this is safe on a family that has none and
 * why promoting a version later stays a two-statement job.
 *
 * If the version write fails the recipe still EXISTS, so this says what
 * happened and lands on it anyway rather than reporting a failure over a record
 * that is really there.
 *
 * It asks for the family's own fields and stops. Ingredients, steps, the scale
 * strip and the yield are the recipe sheet's, which is a screen in its own
 * right.
 */
export function NewRecipe({
  orgId,
  elements,
  types,
}: {
  orgId: string;
  /** Every element, retired ones sunk under their own heading. */
  elements: PickOption[];
  /** The `recipe_type` vocabulary already in use — FMP's Glaze/Cake/Mix. */
  types: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [elementId, setElementId] = useState("");
  const [recipeType, setRecipeType] = useState("");

  // BOTH are required, and the element is the half that is not obvious:
  // `production_recipes.element_id` is NOT NULL, because a recipe is how one
  // element gets made.
  const ready = name.trim() !== "" && elementId !== "";

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setElementId("");
    setRecipeType("");
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("production_recipes")
        .insert({
          // EXPLICITLY — design rule 1.
          org_id: orgId,
          element_id: elementId,
          name: name.trim(),
          recipe_type: recipeType.trim() === "" ? null : recipeType.trim(),
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The recipe could not be created.");
        return;
      }

      const id = data.id as string;
      const { error: versionError } = await supabase
        .from("production_recipe_versions")
        .insert({
          org_id: orgId,
          recipe_id: id,
          // BARE, no "v" — every reader prefixes it (`v{version_label}` in
          // RecipeVersions, RecipeInfo, RecipesList and BatchRecipe), so a
          // stored "v01" renders as "vv01". Verified against the live data.
          version_label: "01",
          version_sort: 1,
          is_master: true,
        });

      if (versionError) {
        setFailed(
          `The recipe was created, but its first version was not: ${versionError.message}`
        );
        return;
      }

      router.refresh();
      router.push(`/recipes/${id}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New recipe
      </button>

      {open && (
        <Dialog
          title="New recipe"
          onClose={close}
          busy={pending}
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Add recipe"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Name">
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Banana Cake Donut"
                aria-label="Recipe name"
                autoFocus
              />
            </Field>

            <Field label="Makes">
              <PickList
                variant="field"
                value={elementId}
                onPick={setElementId}
                options={elements}
                ariaLabel="Which element this recipe makes"
                placeholder="Choose an element"
              />
            </Field>

            <Field label="Type">
              <PickList
                variant="field"
                value={recipeType}
                onPick={setRecipeType}
                options={types.map((t) => ({ value: t, label: t }))}
                allowNew
                clearable
                ariaLabel="Recipe type"
                placeholder="Glaze, Cake, Mix…"
              />
            </Field>

            <p className="text-[13px] text-muted">
              It starts at v01, which is the master until another version takes
              over. Ingredients and steps are written on the recipe sheet.
            </p>

            {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
