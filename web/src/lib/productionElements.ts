/**
 * What deleting an element would cost, and whether the database will even allow
 * it (Mark, 2026-08-11: "I need a way to delete elements").
 *
 * THE FOREIGN KEYS AROUND `production_elements` ARE SPLIT DOWN THE MIDDLE, and
 * that split is the whole of this module. Two references CASCADE and four
 * REFUSE, so unlike every other delete in this app the answer is not "warn and
 * let the human through" — for half the catalog Postgres will simply say no.
 *
 *   cascade  production_element_locations (036) · production_element_days (040)
 *   restrict production_recipes (036) · production_recipe_lines (036)
 *            production_item_elements (037)
 *   no action production_batches (044)
 *
 * `production_items.base_element_id` WAS A FIFTH, and migration 049 dropped
 * the column. This module went on reading it until 2026-10-08, so the check
 * errored on every element, landed in `unreadable`, and NO element could be
 * deleted from the app at all — the dialog said it "could not check the items
 * it is the dough for" (Mark: "prevented for a couple different reasons I
 * don't understand"). `ProductionItemActions` had already learned this one:
 * probe the live columns, don't read the migration that created them.
 *
 * 036 wrote down the intent when it chose `restrict`: "deleting an element that
 * has recipes would take a versioned document with it. The app counts them and
 * says so, the way 023's employee delete does." This is that counting.
 *
 * A BLOCKED DELETE IS REPORTED, NOT OFFERED. `closeReadiness`' posture — name
 * what's unresolved and let them through anyway — is right when the human can
 * overrule the machine, and wrong here: pressing "Delete anyway" against a
 * restrict FK produces a raw Postgres error and changes nothing, which teaches
 * the reader that the button lies. Deactivate is offered instead, which is what
 * they wanted in nearly every case.
 */

/** Everything a delete would touch, counted before anything is offered. */
export type ElementUsage = {
  /** Recipes that DESCRIBE this element — `production_recipes.element_id`. */
  recipes: string[];
  /** Recipes using it as an INGREDIENT — `production_recipe_lines.element_id`. */
  ingredientIn: string[];
  /** Items whose BOM names it — `production_item_elements`. */
  componentOf: string[];
  /** Batches ever logged against it — `production_batches`. */
  batches: number;
  /** Per-shop rows that would go with it — cascade. */
  locations: number;
  /** Rows of the weekly element schedule that would go with it — cascade. */
  scheduledDays: number;
  /**
   * A count that could not be read at all.
   *
   * It is NOT the same as zero and must never be folded into one: a table this
   * app cannot see reads as "nothing blocks", which would turn a refusal into a
   * raw FK error at the worst moment. The dialog says so out loud instead.
   */
  unreadable: string[];
};

export const EMPTY_ELEMENT_USAGE: ElementUsage = {
  recipes: [],
  ingredientIn: [],
  componentOf: [],
  batches: 0,
  locations: 0,
  scheduledDays: 0,
  unreadable: [],
};

export type ElementBlocker = {
  /** Which reference is in the way. */
  key: "recipes" | "ingredientIn" | "componentOf" | "batches";
  /** How many rows hold it. */
  count: number;
  /**
   * A few of them by name, for the dialog to read out. Empty for batches, which
   * are numbered rather than named and whose count is the whole story.
   */
  names: string[];
};

/** How many names a blocker reads out before it starts saying "and n more". */
export const NAMES_SHOWN = 4;

/**
 * The references that will refuse the delete, in the order a person would want
 * to hear them: what this element IS, then what uses it, then what it made.
 */
export function deleteBlockers(usage: ElementUsage): ElementBlocker[] {
  const out: ElementBlocker[] = [];
  const named = (
    key: Extract<ElementBlocker["key"], "recipes" | "ingredientIn" | "componentOf">,
    names: string[]
  ) => {
    if (names.length > 0) out.push({ key, count: names.length, names });
  };
  named("recipes", usage.recipes);
  named("ingredientIn", usage.ingredientIn);
  named("componentOf", usage.componentOf);
  if (usage.batches > 0) out.push({ key: "batches", count: usage.batches, names: [] });
  return out;
}

/**
 * Whether the delete can go ahead.
 *
 * FALSE WHENEVER A COUNT COULD NOT BE READ, which is the conservative half and
 * the reason `unreadable` exists. Refusing a delete that would have worked
 * costs one sentence explaining why; offering one the database refuses costs
 * the reader's trust in every confirm after it.
 */
export function canDeleteElement(usage: ElementUsage): boolean {
  return deleteBlockers(usage).length === 0 && usage.unreadable.length === 0;
}

/**
 * Whether the ONLY thing in the way is the recipes that make this element.
 *
 * That is the one blocker the dialog can clear itself (Mark, 2026-10-08:
 * "maybe the app should present the user with the options to do what's needed
 * so the element can be deleted"): a recipe belongs to this element alone, so
 * deleting both is one decision. An ingredient line or an item's component
 * sits inside somebody else's record and is fixed there, and a logged batch is
 * history nothing clears.
 */
export function canDeleteWithRecipes(usage: ElementUsage): boolean {
  const blockers = deleteBlockers(usage);
  return (
    blockers.length === 1 && blockers[0].key === "recipes" && usage.unreadable.length === 0
  );
}

/** What a permitted delete still takes with it — the cascading side. */
export function cascadeLosses(usage: ElementUsage): { locations: number; scheduledDays: number } {
  return { locations: usage.locations, scheduledDays: usage.scheduledDays };
}

/** True when a permitted delete would take something else down with it. */
export function hasCascadeLosses(usage: ElementUsage): boolean {
  return usage.locations > 0 || usage.scheduledDays > 0;
}

/** "Raised Dough, Glaze A and 2 more" — a blocker's names, read out. */
export function listNames(names: string[], shown = NAMES_SHOWN): string {
  const head = names.slice(0, shown);
  const rest = names.length - head.length;
  const joined =
    head.length <= 1
      ? (head[0] ?? "")
      : `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

/**
 * A Postgres foreign-key violation, said in words.
 *
 * The belt to `canDeleteElement`'s braces: the counts are read a moment before
 * the delete and the database is the only authority on the answer, so a race —
 * or a count this app could not see — still has to land somewhere readable
 * rather than as `update or delete on table "production_elements" violates
 * foreign key constraint …`.
 */
export function describeDeleteError(error: { code?: string; message: string }): string {
  if (error.code !== "23503") return error.message;
  return (
    "The database refused it: something still refers to this element — a recipe, " +
    "an item that is made from it, or a batch logged against it. Deactivating " +
    "it keeps all of that and takes it out of the pickers."
  );
}
