"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { RowMenu } from "@/components/ui/RowMenu";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { LinkRecipe, type LinkableRecipe } from "./LinkRecipe";
import { duplicateTitle } from "@/lib/productionPlans";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";
import { deleteRecipe, recipeDeleteCounts } from "./recipeWrites";
import {
  canDeleteElement,
  canDeleteWithRecipes,
  deleteBlockers,
  describeDeleteError,
  hasCascadeLosses,
  listNames,
  type ElementBlocker,
  type ElementUsage,
} from "@/lib/productionElements";

/** A record a blocker names, so the dialog can link to where it is fixed. */
type Ref = { id: string; name: string };

/** The blockers' records, beside the counts `ElementUsage` holds by name. */
type ElementRefs = { recipes: Ref[]; ingredientIn: Ref[]; componentOf: Ref[] };

/** What deleting this element's own recipes would take with them. */
type RecipeLoss = {
  versions: number;
  lines: number;
  steps: number;
  /** Batch log entries that name one of the versions and would lose the link. */
  batches: number;
  /** Step pictures to remove from storage, per recipe id. */
  imagePaths: Map<string, string[]>;
};

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
 * database has an opinion. Four of the six references REFUSE (`lib/
 * productionElements` lists them), so "Delete anyway" is not always on the
 * table — where something blocks, the dialog says what and offers only
 * Deactivate. Everywhere else in this app a confirm names what's unresolved and
 * lets you through; that posture assumes the human can overrule the machine,
 * and here they cannot.
 *
 * WHAT IT CAN DO ABOUT A BLOCKER, IT OFFERS (Mark, 2026-10-08, on being told to
 * "take it off those first": "it's unclear what 'those' refer to … maybe the
 * app should present the user with the options"). Each blocker now names its
 * records as links and says what to do there. Where the element's OWN recipes
 * are all that is in the way, Delete takes them too, after saying what they
 * hold. A logged batch says outright that deactivating is the only choice.
 */
export function ElementActions({
  elementId,
  name,
  isActive,
  variant,
  afterDelete = "refresh",
  linkRecipes,
}: {
  elementId: string;
  /** What to call it in the dialog and the menu's aria label. */
  name: string;
  isActive: boolean;
  /**
   * `row` — the ⋯ in a list's last column. `menu` — the record's Actions menu,
   * top right of the title row (Mark, 2026-09-30: "an actionmenu in our usual
   * spot … 'Duplicate Element' and 'Delete Element'"), which replaced the red
   * Delete button at the foot of the record.
   */
  variant: "row" | "menu";
  /** A list refreshes in place; a detail screen is looking at nothing and has
   *  to navigate. An href rather than a callback, because half the callers are
   *  server components and a function cannot cross that boundary. */
  afterDelete?: "refresh" | { href: string };
  /**
   * `menu` only: every recipe family, which puts Link Recipe… in the menu.
   * Passed for a MADE element — only a made element is costed from a recipe.
   */
  linkRecipes?: LinkableRecipe[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [usage, setUsage] = useState<ElementUsage | null>(null);
  const [refs, setRefs] = useState<ElementRefs>({ recipes: [], ingredientIn: [], componentOf: [] });
  const [recipeLoss, setRecipeLoss] = useState<RecipeLoss | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openConfirm() {
    setConfirming(true);
    setUsage(null);
    setError(null);
    setRecipeLoss(null);
    const read = await readUsage(supabase, elementId);
    setRefs(read.refs);
    setRecipeLoss(read.recipeLoss);
    setUsage(read.usage);
  }

  /**
   * DUPLICATE COPIES WHAT THE ELEMENT IS (Mark, 2026-09-30) — the master row,
   * its per-kitchen rows (Active, Par, Note) and its per-shop
   * manual costs, `ProductionItemActions`' rule. NOT its recipes: a recipe is a
   * versioned document with its own Duplicate on its own record, and two
   * elements silently sharing a copied method is how one gets edited believing
   * it is the other. Nor the FileMaker identity (`legacy_id`, `source`), which
   * belongs to the original alone.
   *
   * Named "… copy" (`duplicateTitle`) because the name is unique per org, and
   * written parent-first, every write checked; the screen lands on the copy.
   */
  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    try {
      const newId = await duplicateElement();
      router.refresh();
      router.push(`/elements/${newId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function duplicateElement(): Promise<string> {
    const [{ data: source, error: readErr }, { data: names, error: namesErr }] =
      await Promise.all([
        supabase
          .from("production_elements")
          .select(
            "org_id, kind, name, element_type, type_sort, schedule_class, inventory_item_id, manual_cost, manual_cost_unit, is_active, notes"
          )
          .eq("id", elementId)
          .maybeSingle(),
        // ~470 rows, inside PostgREST's 1,000 cap; the range says so out loud.
        supabase.from("production_elements").select("name").range(0, 1999),
      ]);
    if (readErr || !source) throw new Error(readErr?.message ?? "That element is no longer there.");
    if (namesErr) throw new Error(namesErr.message);

    const { data: created, error: createErr } = await supabase
      .from("production_elements")
      .insert({
        ...source,
        name: duplicateTitle(
          (names ?? []).map((n) => String(n.name)),
          String(source.name)
        ),
      })
      .select("id")
      .single();
    if (createErr || !created)
      throw new Error(createErr?.message ?? "The copy could not be created.");
    const newId = created.id as string;

    const { data: kitchens, error: kErr } = await supabase
      .from("production_element_locations")
      .select(
        "org_id, location_id, stock_count, stock_size, stock_unit, is_active, notes"
      )
      .eq("element_id", elementId);
    if (kErr) throw new Error(kErr.message);
    if (kitchens && kitchens.length > 0) {
      const { error } = await supabase
        .from("production_element_locations")
        .insert(kitchens.map((k) => ({ ...k, element_id: newId })))
        .select("id");
      if (error) throw new Error(error.message);
    }

    const { data: costs, error: cErr } = await supabase
      .from("production_element_location_costs")
      .select("org_id, location_id, cost")
      .eq("element_id", elementId);
    if (cErr) throw new Error(cErr.message);
    if (costs && costs.length > 0) {
      const { error } = await supabase
        .from("production_element_location_costs")
        .insert(costs.map((c) => ({ ...c, element_id: newId })))
        .select("element_id");
      if (error) throw new Error(error.message);
    }

    return newId;
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

  /**
   * The element's own recipes first, then the element — the foreign key
   * refuses the other order. No transaction spans it: a failure part way
   * through keeps what is left and says which recipe stopped it.
   */
  async function removeWithRecipes() {
    if (!recipeLoss) return;
    setBusy("delete");
    setError(null);
    for (const recipe of refs.recipes) {
      const result = await deleteRecipe(
        supabase,
        recipe.id,
        recipeLoss.imagePaths.get(recipe.id) ?? []
      );
      if ("error" in result) {
        setBusy(null);
        setError(`“${recipe.name}” could not be deleted: ${result.error}`);
        return;
      }
    }
    await remove();
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

  const actionMenu = (linkRow: ActionMenuItem | null) => (
    <ActionMenu
      label={busy === "duplicate" ? "Duplicating…" : "Actions"}
      ariaLabel={`Actions for ${name}`}
      disabled={busy !== null}
      items={[
        { label: "Duplicate Element", onSelect: () => void duplicate() },
        ...(linkRow ? [linkRow] : []),
        {
          label: "Delete Element…",
          danger: true,
          separatorBefore: true,
          onSelect: () => void openConfirm(),
        },
      ]}
    />
  );

  const blockers = usage ? deleteBlockers(usage) : [];
  const deletable = usage !== null && canDeleteElement(usage);
  // Its own recipes are all that blocks, and what they hold could be counted.
  const withRecipes = usage !== null && canDeleteWithRecipes(usage) && recipeLoss !== null;
  const hasBatches = (usage?.batches ?? 0) > 0;

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
        <span className="flex items-center gap-3">
          {/* A failed duplicate has no dialog to report in, so it is said here. */}
          {error && !confirming ? <span className="text-sm text-accent">{error}</span> : null}
          {linkRecipes ? (
            <LinkRecipe elementId={elementId} elementName={name} recipes={linkRecipes}>
              {(linkRow) => actionMenu(linkRow)}
            </LinkRecipe>
          ) : (
            actionMenu(null)
          )}
        </span>
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
              {withRecipes && (
                <button
                  type="button"
                  onClick={() => void removeWithRecipes()}
                  disabled={busy !== null}
                  className={DIALOG_DANGER_CLASS}
                >
                  {busy === "delete"
                    ? "Deleting…"
                    : `Delete element and ${refs.recipes.length === 1 ? "recipe" : "recipes"}`}
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
                  <p className="font-semibold">
                    {withRecipes
                      ? `Deleting this element deletes its ${refs.recipes.length === 1 ? "recipe" : "recipes"} too.`
                      : "This element cannot be deleted yet."}
                  </p>
                  {blockers.map((b) => (
                    <p key={b.key}>
                      <BlockerLine
                        blocker={b}
                        refs={refs}
                        takesRecipes={withRecipes}
                        onNavigate={() => setConfirming(false)}
                      />
                    </p>
                  ))}
                  {withRecipes && recipeLoss ? <p>{recipeLossSentence(recipeLoss)}</p> : null}
                  {hasBatches ? (
                    <p>
                      {isActive
                        ? "It can only be deactivated, which keeps everything and takes it out of the pickers."
                        : "It can only be deactivated, and it already is, so it is out of the pickers."}
                    </p>
                  ) : null}
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

              {(deletable || withRecipes) && hasCascadeLosses(usage) && (
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

/**
 * One blocker: what is in the way, each record a link to where it is fixed,
 * and what to do there.
 */
function BlockerLine({
  blocker,
  refs,
  takesRecipes,
  onNavigate,
}: {
  blocker: ElementBlocker;
  refs: ElementRefs;
  /** Whether Delete will take the recipes too, or they have to go by hand. */
  takesRecipes: boolean;
  /** Close the dialog on the way out — a list keeps it mounted otherwise. */
  onNavigate: () => void;
}) {
  const n = blocker.count;
  const links = (rows: Ref[], href: (id: string) => string) =>
    rows.map((r, i) => (
      <Fragment key={r.id}>
        {i > 0 ? ", " : ""}
        <Link href={href(r.id)} onClick={onNavigate} className="font-medium underline">
          {r.name}
        </Link>
      </Fragment>
    ));
  switch (blocker.key) {
    case "recipes":
      return (
        <>
          {n === 1 ? "A recipe makes it: " : `${n} recipes make it: `}
          {links(refs.recipes, (id) => `/recipes/${id}`)}.{" "}
          {takesRecipes
            ? `To keep ${n === 1 ? "the recipe" : "one"}, open it and change its Makes field to another element.`
            : `Open ${n === 1 ? "it" : "each"} and delete it, or change its Makes field to another element.`}
        </>
      );
    case "ingredientIn":
      return (
        <>
          It is an ingredient in {n === 1 ? "a recipe" : `${n} recipes`}:{" "}
          {links(refs.ingredientIn, (id) => `/recipes/${id}?tab=ingredients`)}. Open{" "}
          {n === 1 ? "it" : "each"} and remove that ingredient, or choose another, in every
          version that has it.
        </>
      );
    case "componentOf":
      return (
        <>
          {n === 1 ? "An item is made from it: " : `${n} items are made from it: `}
          {links(refs.componentOf, (id) => `/production-items/${id}`)}. Open{" "}
          {n === 1 ? "it" : "each"} and remove this element from its components.
        </>
      );
    case "batches":
      return (
        <>
          {n} {n === 1 ? "batch has" : "batches have"} been logged against it. That is
          production history, and nothing removes it.
        </>
      );
  }
}

/** What the element's recipes hold, said before they are deleted with it. */
function recipeLossSentence(loss: RecipeLoss): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    `That takes ${plural(loss.versions, "version", "versions")}, ` +
    `${plural(loss.lines, "ingredient line", "ingredient lines")} and ` +
    `${plural(loss.steps, "procedure step", "procedure steps")}. This cannot be undone.` +
    (loss.batches > 0
      ? ` ${plural(loss.batches, "batch log entry names", "batch log entries name")} one of those versions and will lose the link.`
      : "")
  );
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
): Promise<{ usage: ElementUsage; refs: ElementRefs; recipeLoss: RecipeLoss | null }> {
  const unreadable: string[] = [];

  const [recipes, lines, components, batches, locations, days] = await Promise.all([
    supabase.from("production_recipes").select("id, name").eq("element_id", elementId).order("name"),
    // Two levels of embed: a line belongs to a VERSION, and the version is what
    // knows its recipe. The recipe is what a person recognises, so that is what
    // gets read out — the version label alone ("v11") names nothing.
    supabase
      .from("production_recipe_lines")
      .select("id, production_recipe_versions ( production_recipes ( id, name ) )")
      .eq("element_id", elementId),
    supabase
      .from("production_item_elements")
      .select("production_items ( id, name )")
      .eq("element_id", elementId),
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
  note("the batch log", batches.error);
  note("its per-shop settings", locations.error);
  note("the weekly schedule", days.error);

  // Distinct BY ID: a recipe naming the same element on three lines is one
  // recipe to go and fix, not three.
  const distinct = (rows: (Ref | null)[]): Ref[] => [
    ...new Map(rows.filter((r): r is Ref => r !== null).map((r) => [r.id, r])).values(),
  ];
  const refs: ElementRefs = {
    recipes: (recipes.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name) })),
    ingredientIn: distinct((lines.data ?? []).map((l) => recipeOf(l))),
    componentOf: distinct((components.data ?? []).map((c) => embedded(c.production_items))),
  };

  // What the element's own recipes hold, for the delete that takes them too.
  // A count that cannot be read leaves it null, and that delete is not offered.
  let recipeLoss: RecipeLoss | null = null;
  if (refs.recipes.length > 0) {
    const counts = await Promise.all(
      refs.recipes.map((r) => recipeDeleteCounts(supabase, r.id))
    );
    if (counts.every((c) => !("error" in c))) {
      recipeLoss = { versions: 0, lines: 0, steps: 0, batches: 0, imagePaths: new Map() };
      counts.forEach((c, i) => {
        if ("error" in c) return;
        recipeLoss!.versions += c.versions;
        recipeLoss!.lines += c.lines;
        recipeLoss!.steps += c.steps;
        recipeLoss!.batches += c.batches;
        recipeLoss!.imagePaths.set(refs.recipes[i].id, c.imagePaths);
      });
    }
  }

  return {
    usage: {
      recipes: refs.recipes.map((r) => r.name),
      ingredientIn: refs.ingredientIn.map((r) => r.name),
      componentOf: refs.componentOf.map((r) => r.name),
      batches: batches.count ?? 0,
      locations: locations.count ?? 0,
      scheduledDays: days.count ?? 0,
      unreadable,
    },
    refs,
    recipeLoss,
  };
}

/**
 * PostgREST returns a to-one embed as an object and a to-many as an array, and
 * which one you get depends on the keys it infers — so both shapes are handled
 * rather than asserted. Getting this wrong reads as "nothing uses it".
 */
function embedded(value: unknown): Ref | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const { id, name } = row as { id?: unknown; name?: unknown };
  return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}

function recipeOf(line: unknown): Ref | null {
  if (!line || typeof line !== "object") return null;
  const versions = (line as { production_recipe_versions?: unknown }).production_recipe_versions;
  const version = Array.isArray(versions) ? versions[0] : versions;
  if (!version || typeof version !== "object") return null;
  return embedded((version as { production_recipes?: unknown }).production_recipes);
}
