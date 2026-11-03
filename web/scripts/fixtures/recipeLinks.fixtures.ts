// Pointing a recipe at a different element.
//
// A recipe makes exactly one element, so linking is a move, and costing takes
// an element's FIRST recipe by name that has a master version. These pin what
// the confirm says a move will do to both elements' costs.

import { costingRecipe, nextRecipeVersion, recipeMoveNotes, sortBelow, type RecipeLink } from "../../src/lib/recipes";
import { test, eq } from "./harness";

const NAMES: Record<string, string> = { glaze: "Chocolate Glaze", cream: "Vanilla Cream", bare: "Sprinkles" };
const name = (id: string) => NAMES[id] ?? id;

const RECIPES: RecipeLink[] = [
  { id: "r1", name: "Chocolate Glaze", elementId: "glaze", hasMaster: true },
  { id: "r2", name: "Chocolate Glaze copy", elementId: "glaze", hasMaster: true },
  { id: "r3", name: "Vanilla Cream", elementId: "cream", hasMaster: true },
  { id: "r4", name: "A draft", elementId: "cream", hasMaster: false },
];

test("an element is costed from its first recipe by name", () => {
  eq(costingRecipe(RECIPES, "glaze")?.id, "r1", "glaze");
});

test("a recipe with no master version is passed over, whatever its name", () => {
  eq(costingRecipe(RECIPES, "cream")?.id, "r3", "cream");
});

test("an element with no recipe is costed from none", () => {
  eq(costingRecipe(RECIPES, "bare"), null, "bare");
});

test("moving to the element it already makes is nothing", () => {
  eq(recipeMoveNotes(RECIPES, "r1", "glaze", name), [], "notes");
});

test("moving the costing recipe hands its element to the next one", () => {
  eq(
    recipeMoveNotes(RECIPES, "r1", "bare", name),
    [
      "“Chocolate Glaze” will make Sprinkles instead of Chocolate Glaze.",
      "Chocolate Glaze will be costed from “Chocolate Glaze copy”.",
      "Sprinkles will be costed from “Chocolate Glaze”.",
    ],
    "notes"
  );
});

test("moving an element's only costed recipe leaves it with none", () => {
  eq(
    recipeMoveNotes(RECIPES, "r3", "bare", name)[1],
    "Vanilla Cream will have no recipe to cost it from.",
    "from"
  );
});

test("a recipe that sorts first takes over the element it joins", () => {
  eq(
    recipeMoveNotes(RECIPES, "r1", "cream", name)[2],
    "Vanilla Cream is costed from “Vanilla Cream” today. It will be costed from “Chocolate Glaze”, which comes first by name.",
    "to"
  );
});

test("a recipe that sorts later changes nothing where it lands", () => {
  eq(
    recipeMoveNotes(RECIPES, "r3", "glaze", name)[2],
    "Chocolate Glaze will still be costed from “Chocolate Glaze”, which comes first by name.",
    "to"
  );
});

test("a recipe that is not the costing one leaves its old element alone", () => {
  eq(recipeMoveNotes(RECIPES, "r2", "bare", name).length, 2, "notes");
});

test("a recipe with no master version costs nothing where it lands", () => {
  eq(
    recipeMoveNotes(RECIPES, "r4", "bare", name)[1],
    "“A draft” has no master version, so Sprinkles will have no cost from it.",
    "to"
  );
});

/* New Version's number — Pavemint's real labels are 04 and 5. */

test("a new version is one past the highest, written with two digits", () => {
  const next = nextRecipeVersion([
    { version_label: "04", version_sort: 4 },
    { version_label: "5", version_sort: 5 },
  ]);
  eq(next.label, "06", "label");
  eq(next.sort, 6, "sort");
});

test("a lettered or sortless FileMaker label still counts", () => {
  eq(nextRecipeVersion([{ version_label: "27a", version_sort: 27.1 }]).label, "28", "27a");
  eq(nextRecipeVersion([{ version_label: "38", version_sort: null }]).label, "39", "no sort");
  eq(nextRecipeVersion([{ version_label: "9", version_sort: 12 }]).label, "13", "sort wins");
});

test("a recipe with no versions starts at 01", () => {
  eq(nextRecipeVersion([]).label, "01", "empty");
});

/* Adding a line BELOW another (2026-11-03). */

test("below the last line: ten past it", () => {
  eq(sortBelow([10, 20, 30], 2), { sort: 40, renumber: null });
});

test("into a gap: halfway, nothing else moves", () => {
  eq(sortBelow([10, 20, 30], 0), { sort: 15, renumber: null });
  eq(sortBelow([1, 2, 3, 4, 10, 90], 4), { sort: 50, renumber: null }, "FileMaker's 10 → 90");
});

test("no room between: renumber in tens, then five past", () => {
  eq(sortBelow([1, 2, 3], 0), { sort: 15, renumber: [10, 20, 30] });
});

test("a null anywhere renumbers, since a null would sort last", () => {
  eq(sortBelow([10, null, 30], 2), { sort: 35, renumber: [10, 20, 30] });
});
