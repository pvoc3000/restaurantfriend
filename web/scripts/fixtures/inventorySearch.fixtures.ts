// The inventory-item search's word rule — what makes the link picker able to
// find anything in a comma-inverted catalog.
//
// Each case was checked by breaking the code it pins.

import { inventorySearchWords } from "../../src/lib/catalog";
import { test, eq, ok } from "./harness";

test("every word is returned, so the caller can AND them", () => {
  // The whole point: "Strawberries, Sliced" has to be findable by typing
  // "Sliced Strawberries", which a single %term% substring never matches.
  eq(inventorySearchWords("Sliced Strawberries"), ["sliced", "strawberries"]);
});

test("PARENTHESES ARE DROPPED — they are our packaging note, not their name", () => {
  // "Fig Jam (bag)" wants "Jam, Fig". ANDing "bag" against a catalog that never
  // uses the word turns a findable item into zero results — measured on the
  // real catalog, this one line took it from 0 hits to 3.
  eq(inventorySearchWords("Fig Jam (bag)"), ["fig", "jam"]);
});

test("punctuation and commas are separators, not characters to match", () => {
  eq(inventorySearchWords("Jam, Blackberry Bayleaf, Large"),
     ["jam", "blackberry", "bayleaf", "large"]);
});

test("one-letter noise is dropped", () => {
  // A lone "a" ANDed against 790 names matches nearly all of them, which is
  // the same as searching for nothing.
  eq(inventorySearchWords("Salt & a Pepper"), ["salt", "pepper"]);
});

test("a term of nothing but punctuation searches for NOTHING, not everything", () => {
  // The caller returns early on an empty list. Without that it would issue a
  // query with no filters and offer the first 25 items as though they matched.
  eq(inventorySearchWords("(((...)))"), []);
  eq(inventorySearchWords("   "), []);
});

test("accented and non-latin words survive", () => {
  // \p{L}, not [a-z]: "Crème" must not become "cr" + "me".
  eq(inventorySearchWords("Crème Fraîche"), ["crème", "fraîche"]);
});

test("digits are kept — they are how pack sizes are named", () => {
  eq(inventorySearchWords("Chocolate 66%"), ["chocolate", "66"]);
});

test("a sentence is capped at six words", () => {
  const many = inventorySearchWords("one two three four five six seven eight");
  eq(many.length, 6, "capped");
  ok(!many.includes("seven"), "and it is the TAIL that is dropped");
});
