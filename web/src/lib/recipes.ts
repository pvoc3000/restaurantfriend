// The recipe record's own address: which section you are reading, and which
// version of the recipe you are reading it for.
//
// Both live in the URL, which is this app's rule for view state and is what
// makes the two agree: the sections are real addresses (`ui/SectionNav`, not a
// `TabPicker`), and a version held in client state instead would be lost the
// moment you moved between them.

export type RecipeTab = "info" | "recipe";

export const RECIPE_TABS: RecipeTab[] = ["info", "recipe"];

export const RECIPE_TAB_LABEL: Record<RecipeTab, string> = {
  info: "Info",
  recipe: "Recipe",
};

/**
 * The tab a request is asking for. Anything unrecognised — a stale bookmark, a
 * typo, a missing parameter — falls back to `info` rather than throwing or
 * rendering an empty shell: a bad tab should show you the record, not an error.
 */
export function parseRecipeTab(raw: string | string[] | undefined): RecipeTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (RECIPE_TABS as string[]).includes(value ?? "") ? (value as RecipeTab) : "info";
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
