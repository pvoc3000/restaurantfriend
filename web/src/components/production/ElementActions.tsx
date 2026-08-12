"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { RowMenu } from "@/components/ui/RowMenu";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";
import {
  canDeleteElement,
  deleteBlockers,
  describeDeleteError,
  hasCascadeLosses,
  listNames,
  type ElementBlocker,
  type ElementUsage,
} from "@/lib/productionElements";

/**
 * Deleting an element (Mark, 2026-08-11: "I need a way to delete elements …
 * list view and detail view").
 *
 * `VendorItemActions`' shape — a catalog row's own commands, offered in both
 * places — rather than `EmployeeActions`', which is detail-only because a
 * delete beside each of 445 PEOPLE is a two-tap route to destroying somebody.
 * An element is a catalog row, and 155 of the 470 are uncosted FileMaker
 * residue somebody has to work through; making them go back to a record one at
 * a time to remove each is the case this exists for.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER DELETE IN THE APP is that the
 * database has an opinion. Five of the seven references REFUSE (`lib/
 * productionElements` lists them), so "Delete anyway" is not always on the
 * table — where something blocks, the dialog says what and offers only
 * Deactivate. Everywhere else in this app a confirm names what's unresolved and
 * lets you through; that posture assumes the human can overrule the machine,
 * and here they cannot.
 */
export function ElementActions({
  elementId,
  name,
  isActive,
  variant,
  afterDelete = "refresh",
}: {
  elementId: string;
  /** What to call it in the dialog and the menu's aria label. */
  name: string;
  isActive: boolean;
  /**
   * `row` — the ⋯ in a list's last column. `button` — a labelled red button for
   * a detail screen, where a bare glyph alone at the end of a page "failed the
   * only test that matters" (Mark, 2026-08-02, on the employee record).
   */
  variant: "row" | "button";
  /** A list refreshes in place; a detail screen is looking at nothing and has
   *  to navigate. An href rather than a callback, because half the callers are
   *  server components and a function cannot cross that boundary. */
  afterDelete?: "refresh" | { href: string };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [usage, setUsage] = useState<ElementUsage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openConfirm() {
    setConfirming(true);
    setUsage(null);
    setError(null);
    setUsage(await readUsage(supabase, elementId));
  }

  async function deactivate() {
    setBusy("deactivate");
    setError(null);
    const { data, error: writeError } = await supabase
      .from("production_elements")
      .update({ is_active: false })
      .eq("id", elementId)
      .select("id");
    setBusy(null);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("Nothing changed — the database refused the write and said nothing.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    // `.select()` on a delete is the only way to know it HAPPENED: with no
    // matching RLS policy Postgres removes zero rows and PostgREST returns no
    // error, so a bare `.delete()` reports a cheerful success. 036 does create
    // a purchaser+ delete policy — but 036 is applied by hand, like every
    // migration here, and this is the failure that has now bitten twice.
    const { data, error: deleteError } = await supabase
      .from("production_elements")
      .delete()
      .eq("id", elementId)
      .select("id");
    setBusy(null);
    if (deleteError) {
      setError(describeDeleteError(deleteError));
      return;
    }
    if (!data || data.length === 0) {
      setError(
        "Nothing was deleted — the database refused it and said nothing. " +
          "That is what it looks like when the delete policy from migration 036 " +
          "is missing, or when this element is not one you may write to."
      );
      return;
    }
    setConfirming(false);
    if (afterDelete === "refresh") router.refresh();
    else router.push(afterDelete.href);
  }

  const blockers = usage ? deleteBlockers(usage) : [];
  const deletable = usage !== null && canDeleteElement(usage);

  return (
    <>
      {variant === "row" ? (
        <RowMenu
          label={`Actions for ${name}`}
          items={[
            {
              label: "Delete element…",
              hint: "Shows what would go with it",
              danger: true,
              disabled: busy !== null,
              onSelect: () => void openConfirm(),
            },
          ]}
        />
      ) : (
        // RED like every destructive trigger on a screen, and bordered rather
        // than filled — a filled cell would read as the primary action of the
        // screen, which deleting an element is emphatically not.
        <button
          type="button"
          onClick={() => void openConfirm()}
          disabled={busy !== null}
          className={`${DANGER_BUTTON_CLASS} inline-flex shrink-0 items-center whitespace-nowrap`}
        >
          Delete element
        </button>
      )}

      {confirming && (
        <Dialog
          title="Delete element"
          onClose={() => setConfirming(false)}
          busy={busy !== null}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              {/* Absent, not disabled, when something blocks. A greyed control
                  explains itself only on hover and the iPad has none — and the
                  paragraph above it has already said why in words. */}
              {deletable && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy !== null}
                  className={DIALOG_DANGER_CLASS}
                >
                  {busy === "delete" ? "Deleting…" : "Delete"}
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={() => void deactivate()}
                  disabled={busy !== null}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {busy === "deactivate" ? "Deactivating…" : "Deactivate instead"}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-ink">{name}</p>

          {usage === null ? (
            <p className="mt-3 text-sm text-subtle">Checking what uses it…</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {blockers.length > 0 && (
                <div className="space-y-2 border border-ink bg-mark-fill px-3 py-2 text-ink">
                  <p className="font-semibold">This element cannot be deleted.</p>
                  {blockers.map((b) => (
                    <p key={b.key}>{blockerSentence(b)}</p>
                  ))}
                  <p>
                    Take it off those first, or deactivate it — which keeps
                    everything and takes it out of the pickers, the recipe sheets
                    and the uncosted queue.
                  </p>
                </div>
              )}

              {usage.unreadable.length > 0 && (
                <p className="border border-ink bg-mark-fill px-3 py-2 text-ink">
                  <span className="font-semibold">
                    Could not check {listNames(usage.unreadable, 5)}.
                  </span>{" "}
                  Until that reads, deleting is not offered — an unread count is
                  not the same as nothing, and the database would refuse it
                  anyway.
                </p>
              )}

              {deletable && hasCascadeLosses(usage) && (
                <div className="space-y-2 border border-ink bg-mark-fill px-3 py-2 text-ink">
                  <p className="font-semibold">These go with it.</p>
                  {usage.locations > 0 && (
                    <p>
                      Its per-shop settings at {usage.locations}{" "}
                      {usage.locations === 1 ? "location" : "locations"} — the
                      par, the stock count and whether it sits on the weekly log.
                    </p>
                  )}
                  {usage.scheduledDays > 0 && (
                    <p>
                      {usage.scheduledDays}{" "}
                      {usage.scheduledDays === 1 ? "row" : "rows"} of the weekly
                      element schedule, which is what tells a kitchen to make it
                      and how many batches.
                    </p>
                  )}
                </div>
              )}

              {deletable && !hasCascadeLosses(usage) && (
                <p className="text-muted">
                  Nothing uses this element — no recipe, no item, no batch, no
                  per-shop settings and nothing on the weekly schedule. Deleting
                  it removes one row and loses nothing.
                </p>
              )}

              {error && <p className="text-accent">{error}</p>}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/** One blocker, in words a person can act on. */
function blockerSentence(b: ElementBlocker): string {
  const n = b.count;
  const names = listNames(b.names);
  switch (b.key) {
    case "recipes":
      return `${n} ${n === 1 ? "recipe describes" : "recipes describe"} it — ${names}. Deleting it would take a versioned document with it.`;
    case "ingredientIn":
      return `It is an ingredient in ${n} ${n === 1 ? "recipe" : "recipes"} — ${names}.`;
    case "componentOf":
      return `${n} ${n === 1 ? "item is" : "items are"} made from it — ${names}.`;
    case "doughFor":
      return `It is the dough for ${n} ${n === 1 ? "item" : "items"} — ${names}.`;
    case "batches":
      return `${n} ${n === 1 ? "batch has" : "batches have"} been logged against it. That is production history.`;
  }
}

/**
 * Everything the dialog needs, in one wave.
 *
 * A COUNT THAT ERRORS IS RECORDED AS UNREADABLE RATHER THAN AS ZERO, which
 * matters more here than anywhere else in the app: a blocker read as zero would
 * offer a delete the database then refuses. Note a HEAD count cannot tell empty
 * from missing at all — it has no body to carry the message — so the three
 * counts that use one are the cascading pair plus batches, and a missing
 * `production_batches` degrades to the FK error rather than to a silent yes.
 */
async function readUsage(
  supabase: ReturnType<typeof createClient>,
  elementId: string
): Promise<ElementUsage> {
  const unreadable: string[] = [];

  const [recipes, lines, components, dough, batches, locations, days] = await Promise.all([
    supabase.from("production_recipes").select("name").eq("element_id", elementId),
    // Two levels of embed: a line belongs to a VERSION, and the version is what
    // knows its recipe. The recipe is what a person recognises, so that is what
    // gets read out — the version label alone ("v11") names nothing.
    supabase
      .from("production_recipe_lines")
      .select("id, production_recipe_versions ( production_recipes ( name ) )")
      .eq("element_id", elementId),
    supabase
      .from("production_item_elements")
      .select("production_items ( name )")
      .eq("element_id", elementId),
    supabase.from("production_items").select("name").eq("base_element_id", elementId),
    supabase
      .from("production_batches")
      .select("*", { count: "exact", head: true })
      .eq("element_id", elementId),
    supabase
      .from("production_element_locations")
      .select("*", { count: "exact", head: true })
      .eq("element_id", elementId),
    supabase
      .from("production_element_days")
      .select("*", { count: "exact", head: true })
      .eq("element_id", elementId),
  ]);

  const note = (label: string, error: unknown) => {
    if (error) unreadable.push(label);
  };
  note("the recipes", recipes.error);
  note("the recipe ingredients", lines.error);
  note("the items made from it", components.error);
  note("the items it is the dough for", dough.error);
  note("the batch log", batches.error);
  note("its per-shop settings", locations.error);
  note("the weekly schedule", days.error);

  return {
    recipes: (recipes.data ?? []).map((r) => String(r.name)),
    // Distinct: a recipe naming the same element on three lines is one recipe
    // to go and fix, not three.
    ingredientIn: [
      ...new Set(
        (lines.data ?? [])
          .map((l) => recipeNameOf(l))
          .filter((n): n is string => n !== null)
      ),
    ],
    componentOf: [
      ...new Set(
        (components.data ?? [])
          .map((c) => embeddedName(c.production_items))
          .filter((n): n is string => n !== null)
      ),
    ],
    doughFor: (dough.data ?? []).map((d) => String(d.name)),
    batches: batches.count ?? 0,
    locations: locations.count ?? 0,
    scheduledDays: days.count ?? 0,
    unreadable,
  };
}

/**
 * PostgREST returns a to-one embed as an object and a to-many as an array, and
 * which one you get depends on the keys it infers — so both shapes are handled
 * rather than asserted. Getting this wrong reads as "nothing uses it".
 */
function embeddedName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const name = (row as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function recipeNameOf(line: unknown): string | null {
  if (!line || typeof line !== "object") return null;
  const versions = (line as { production_recipe_versions?: unknown }).production_recipe_versions;
  const version = Array.isArray(versions) ? versions[0] : versions;
  if (!version || typeof version !== "object") return null;
  return embeddedName((version as { production_recipes?: unknown }).production_recipes);
}
