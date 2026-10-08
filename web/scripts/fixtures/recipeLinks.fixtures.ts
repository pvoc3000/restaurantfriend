// Pointing a recipe at a different element.
//
// A recipe makes exactly one element, so linking is a move, and costing takes
// an element's FIRST recipe by name that has a master version. These pin what
// the confirm says a move will do to both elements' costs.

import { costingRecipe, recipeMoveNotes, type RecipeLink } from "../../src/lib/recipes";
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
