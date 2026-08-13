// Naming a recipe ingredient — an element off the catalog, or a bare name.
//
// The whole correctness of the ingredient picker: one control, one string back,
// two different columns. An element id written into `label` gives a line named
// `0b39de9c-…`; a typed name written into `element_id` is a foreign-key
// violation. Each case was checked by breaking the code it pins.

import { ingredientChoice, ingredientUpdate } from "../../src/lib/recipes";
import { test, eq } from "./harness";

const ELEMENT_IDS = new Set([
  "0b39de9c-d24f-483c-a4b9-916d4297cd80",
  "2fa5d463-5c94-49fc-9f67-87d460ffb593",
]);

test("a value on the element list is an element", () => {
  eq(
    ingredientChoice("2fa5d463-5c94-49fc-9f67-87d460ffb593", ELEMENT_IDS),
    { kind: "element", elementId: "2fa5d463-5c94-49fc-9f67-87d460ffb593" },
    "choice"
  );
});

test("anything else is a bare name", () => {
  eq(
    ingredientChoice("pinch of salt", ELEMENT_IDS),
    { kind: "label", label: "pinch of salt" },
    "choice"
  );
});

test("a uuid-shaped string that is NOT on the list is still a name", () => {
  // The discrimination is MEMBERSHIP, never shape. Guessing from shape would
  // write an id nobody has into `element_id` and refuse the row.
  eq(
    ingredientChoice("ffffffff-ffff-ffff-ffff-ffffffffffff", ELEMENT_IDS),
    { kind: "label", label: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
    "choice"
  );
});

test("empty clears, and whitespace is empty", () => {
  eq(ingredientChoice("", ELEMENT_IDS), { kind: "clear" }, "empty");
  eq(ingredientChoice("   ", ELEMENT_IDS), { kind: "clear" }, "spaces");
});

test("a typed name is trimmed", () => {
  eq(
    ingredientChoice("  Scrap Dough  ", ELEMENT_IDS),
    { kind: "label", label: "Scrap Dough" },
    "trimmed"
  );
});

test("linking an element does NOT touch the label", () => {
  // The free text somebody typed is their own words, and the sheet renders it
  // under the element's name as FileMaker's override. Clearing it here would
  // destroy what they wrote in the act of improving the row.
  eq(ingredientUpdate({ kind: "element", elementId: "abc" }), { element_id: "abc" }, "update");
});

test("a name writes only the label, and clearing writes null", () => {
  eq(
    ingredientUpdate({ kind: "label", label: "pinch of salt" }),
    { label: "pinch of salt" },
    "label"
  );
  eq(ingredientUpdate({ kind: "clear" }), { label: null }, "clear");
});
