// The recipe record's own address: which section you are reading, and which
// version of the recipe you are reading it for.
//
// Both live in the URL, which is this app's rule for view state and is what
// makes the two agree: the sections are real addresses (`ui/SectionNav`, not a
// `TabPicker`), and a version held in client state instead would be lost the
// moment you moved between them.

export type RecipeTab = "info" | "ingredients" | "procedure";

export const RECIPE_TABS: RecipeTab[] = ["info", "ingredients", "procedure"];

export const RECIPE_TAB_LABEL: Record<RecipeTab, string> = {
  info: "Info",
  ingredients: "Ingredients",
  procedure: "Procedure",
};

/**
 * Tab slugs that no longer exist, and where they now go.
 *
 * `recipe` held the ingredients AND the procedure on one screen until
 * 2026-08-11, when they were split because the two lists sharing one viewport
 * left both crowded (Mark: "it's a little crowded vertically"). Falling back to
 * `info` like any other unrecognised value would be wrong for this one: it is
 * not a typo, it is every link, bookmark and remembered nav path written before
 * the split, and they all meant the ingredients.
 */
const RETIRED_TABS: Record<string, RecipeTab> = { recipe: "ingredients" };

/**
 * The tab a request is asking for. Anything unrecognised — a stale bookmark, a
 * typo, a missing parameter — falls back to `info` rather than throwing or
 * rendering an empty shell: a bad tab should show you the record, not an error.
 */
export function parseRecipeTab(raw: string | string[] | undefined): RecipeTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if ((RECIPE_TABS as string[]).includes(value ?? "")) return value as RecipeTab;
  return RETIRED_TABS[value ?? ""] ?? "info";
}

/**
 * The version label a request is asking for, or null for "whichever is master".
 *
 * The LABEL and not the id, because this is the one identifier on the screen a
 * person reads and says out loud — `?v=11` is a URL somebody can check at a
 * glance, and a uuid is not. A label that matches nothing falls through to the
 * master, so a version deleted after a link was shared still lands on the
 * recipe.
 */
export function parseRecipeVersion(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A link to one section of the recipe you are already on, at one version.
 *
 * It carries the CURRENT params through — `from` and `fromLabel` above all, or
 * moving between tabs would quietly strip the breadcrumb trail that led here and
 * the record book would lose its found set.
 *
 * The defaults write NO parameter: `info` is the plain record address, and so is
 * the master version. That keeps every link already stored elsewhere — the
 * list's rows, the found set, a pasted URL — pointing at something canonical.
 */
export function recipeHref(
  id: string,
  {
    tab,
    version,
  }: {
    tab: RecipeTab;
    /** The version label, or null for the master. */
    version?: string | null;
  },
  params: Record<string, string | string[] | undefined> = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || key === "v") continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  if (tab !== "info") search.set("tab", tab);
  if (version) search.set("v", version);
  const query = search.toString();
  return `/recipes/${id}${query ? `?${query}` : ""}`;
}

/**
 * What the ingredient picker was asked for — an element from the catalog, a
 * name that isn't one, or nothing.
 *
 * The picker is ONE `PickList` with `allowNew`, so both answers arrive as the
 * same string and only the caller's option list can tell them apart. That is
 * the whole of the correctness here: an element id written into `label` gives a
 * line named `0b39de9c-…`, and a typed name written into `element_id` is a
 * foreign-key violation. Neither is recoverable by looking at the row.
 *
 * Why one control rather than two fields: a recipe line is EITHER a catalog
 * element or a bare name (036 made `element_id` nullable for FileMaker's
 * "pinch of salt" lines), and asking which before asking what would put a mode
 * switch in front of the common case. Choosing from the list is the common
 * case; typing something the catalog has never heard of is the exception, and
 * `allowNew` is exactly the shape the rest of the app uses for that.
 */
export type IngredientChoice =
  | { kind: "element"; elementId: string }
  | { kind: "label"; label: string }
  | { kind: "clear" };

export function ingredientChoice(
  next: string,
  elementIds: ReadonlySet<string>
): IngredientChoice {
  const value = next.trim();
  if (!value) return { kind: "clear" };
  if (elementIds.has(value)) return { kind: "element", elementId: value };
  return { kind: "label", label: value };
}

/**
 * The columns that choice writes onto `production_recipe_lines`.
 *
 * LINKING AN ELEMENT DOES NOT TOUCH `label`, and that is deliberate: on a line
 * somebody typed a name into, that text is their own words and the sheet
 * already knows what to do with it — it renders under the element's name as
 * FileMaker's `columnName_t` override, and hides itself when the two agree.
 * Clearing it would silently destroy what they wrote in the act of improving
 * the row.
 *
 * A typed name likewise leaves `element_id` alone: this control is only ever
 * offered on a line that has none, so there is nothing to unlink.
 */
export function ingredientUpdate(
  choice: IngredientChoice
): { element_id?: string; label?: string | null } {
  switch (choice.kind) {
    case "element":
      return { element_id: choice.elementId };
    case "label":
      return { label: choice.label };
    case "clear":
      return { label: null };
  }
}
