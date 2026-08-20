// A special order line's taxonomy, and the letter that lives in its cut.
//
// Every case here is a real shape out of the 47,814 migrated lines — the
// canonical `Letter - "A"`, the three older spellings, the bare `Letter` that
// means "not decided yet", and the two rows with a stray closing quote. The
// negative cases are the point: the letter group must NOT appear on a Promise
// Ring, and `isLetterCut` must not fire on a line that merely mentions letters.

import { test, eq, ok, no } from "./harness";
import {
  LETTER_CHARACTERS,
  cutLetter,
  cutOptions,
  donutOptions,
  isLetterCut,
  letterCut,
  taxonomyOptions,
  type TaxonomySource,
} from "../../src/lib/specialOrderLines";

/** A slice of the real menu: two letter donuts, a ring, a cake, a heart. */
const MENU: TaxonomySource[] = [
  { name: "Angry Samoa", item_type: "Raised", subtype: "Letter", finish: "Plain", size: "Regular" },
  { name: "Bananaversary", item_type: "Raised", subtype: "Letter", finish: "Plain", size: "Regular" },
  { name: "Promise Ring - Choc", item_type: "Raised", subtype: "Promise Ring", finish: "Plain", size: "Mini" },
  { name: "Old Fashioned", item_type: "Old Fashioned", subtype: "Old Fashioned", finish: "Plain", size: "Giant" },
  { name: "VDay Heart Stripe Van", item_type: "Raised", subtype: 'Letter "<3"', finish: "Plain", size: "Regular" },
];

/* -- is it a letter donut ------------------------------------------------- */

test("isLetterCut: the canonical stored form", () => {
  ok(isLetterCut('Letter - "A"'));
});

test("isLetterCut: the three older spellings and the menu's own heart subtype", () => {
  for (const cut of ['Letter "A"', 'Letter. "U"', 'Letter- "Y"', 'Letter "<3"', "Letter"]) {
    ok(isLetterCut(cut), cut);
  }
});

test("isLetterCut: a cut that is not a letter, and no cut at all", () => {
  for (const cut of ["Promise Ring", "Bismark", "Bullseye", null, undefined, ""]) {
    no(isLetterCut(cut), String(cut));
  }
});

test("isLetterCut: matches the WORD, not a prefix of another one", () => {
  // The `\b` is what does this. Without it a "Lettering" cut somebody types
  // would grow a letter picker and the line would claim to be a letter donut.
  no(isLetterCut("Lettering"));
  no(isLetterCut("Letterman"));
});

/* -- reading the character back ------------------------------------------- */

test("cutLetter: every spelling in the export reads the same character", () => {
  for (const cut of ['Letter - "A"', 'Letter "A"', 'Letter. "A"', 'Letter- "A"', 'Letter - A"']) {
    eq(cutLetter(cut), "A", cut);
  }
});

test("cutLetter: the heart and the punctuation are left exactly as they are", () => {
  eq(cutLetter('Letter - "<3"'), "<3");
  eq(cutLetter('Letter "<3"'), "<3");
  eq(cutLetter('Letter - "!"'), "!");
  eq(cutLetter('Letter - "+"'), "+");
});

test("cutLetter: a lower-case letter folds up — one order, one donut", () => {
  // `Letter - "y"` (2 lines) and `Letter - "Y"` (763) are the same thing, and a
  // fold is what makes the stored one show as CHOSEN in the picker.
  eq(cutLetter('Letter - "y"'), "Y");
  eq(cutLetter('Letter - "k"'), "K");
});

test("cutLetter: a bare Letter is null — a real state, never inferred", () => {
  // 935 real lines. An order for three dozen glazed letters whose word nobody
  // has settled is not the same as an order for the letter L.
  eq(cutLetter("Letter"), null);
  eq(cutLetter("Letter - "), null);
});

test("cutLetter: nothing to read off a cut that is not a letter", () => {
  eq(cutLetter("Promise Ring"), null);
  eq(cutLetter(null), null);
});

test("cutLetter: a two-character oddity survives whole", () => {
  // `Letter - "OP"` and `Letter - "AB"` are one line each. They are not folded
  // or truncated — `allowNew` is why they are still enterable at all.
  eq(cutLetter('Letter - "OP"'), "OP");
});

test("letterCut writes the canonical spelling, and round-trips", () => {
  eq(letterCut("A"), 'Letter - "A"');
  eq(letterCut("<3"), 'Letter - "<3"');
  for (const c of LETTER_CHARACTERS) eq(cutLetter(letterCut(c)), c, c);
});

test("the character set is the one the twelve years of orders hold", () => {
  eq(LETTER_CHARACTERS.length, 42, "26 letters + 10 digits + 6 marks");
  for (const c of ["A", "Z", "0", "9", "<3", "!", "?", "&", "+", "-"]) {
    ok(LETTER_CHARACTERS.includes(c), c);
  }
});

/* -- what the cut cell offers --------------------------------------------- */

test("a Promise Ring is offered cuts and NOT the forty-two characters", () => {
  const opts = cutOptions(MENU, "Promise Ring");
  eq(opts.map((o) => o.value), ["Letter", 'Letter "<3"', "Old Fashioned", "Promise Ring"]);
  no(opts.some((o) => o.group === "Letter"), "no letter group");
});

test("a letter donut is offered the characters, grouped, plus the bare family", () => {
  const opts = cutOptions(MENU, 'Letter - "D"');
  const letters = opts.filter((o) => o.group === "Letter");
  // The bare `Letter` and one option per character.
  eq(letters.length, LETTER_CHARACTERS.length + 1);
  ok(letters.some((o) => o.value === "Letter"), "the undecided state stays reachable");
  // The option's VALUE is the composed cut, so choosing the letter IS choosing
  // the cut — no composition happens at write time.
  const d = letters.find((o) => o.label === "D");
  eq(d?.value, 'Letter - "D"');
});

test("the letters LEAD on a letter line — it is what you opened the list for", () => {
  const opts = cutOptions(MENU, 'Letter - "D"');
  eq(opts[0].group, "Letter");
  // ...and the cuts follow, so leaving is still one tap.
  ok(opts.some((o) => o.group === "Cut"), "the cuts are still there");
  const firstCut = opts.findIndex((o) => o.group === "Cut");
  ok(firstCut > opts.filter((o) => o.group === "Letter").length - 1, "letters come first");
});

test("the letter family is not listed twice — the group IS those subtypes", () => {
  // The menu carries `Letter` and `Letter "<3"` as subtypes. While the Letter
  // group is showing they come out of the cuts, or the same donut is offered
  // under two spellings and one of them is not the canonical one.
  const opts = cutOptions(MENU, 'Letter - "D"');
  eq(opts.filter((o) => o.group === "Cut" && isLetterCut(o.value)).length, 0);
  eq(opts.filter((o) => o.value === "Letter").length, 1);
  // On a NON-letter line they must still be there — that is how you get in.
  const plain = cutOptions(MENU, "Promise Ring");
  ok(plain.some((o) => o.value === "Letter"), "the way into letters survives");
});

test("the chosen letter is a real option, so the picker can tick it", () => {
  // The reason `cutOptions` takes the CURRENT value: a migrated line reading
  // `Letter - "Y"` must show Y as chosen rather than as an unrecognised value.
  const opts = cutOptions(MENU, 'Letter - "Y"');
  ok(opts.some((o) => o.value === 'Letter - "Y"'));
});

test("the base cuts are still offered on a letter line — you can leave", () => {
  const opts = cutOptions(MENU, 'Letter - "D"');
  ok(opts.some((o) => o.value === "Promise Ring" && o.group === "Cut"));
});

test("an odd migrated spelling still gets its picker", () => {
  // `Letter. "U"` is not in the options and PickList surfaces it under
  // "Current"; what matters here is that the group is offered at all, so the
  // line can be corrected to the canonical form.
  const opts = cutOptions(MENU, 'Letter. "U"');
  ok(opts.some((o) => o.group === "Letter"));
});

/* -- the other four fields ------------------------------------------------ */

test("taxonomy options are the menu's own distinct values, sorted", () => {
  eq(taxonomyOptions(MENU, "item_type").map((o) => o.value), ["Old Fashioned", "Raised"]);
  eq(taxonomyOptions(MENU, "size").map((o) => o.value), ["Giant", "Mini", "Regular"]);
  eq(taxonomyOptions(MENU, "finish").map((o) => o.value), ["Plain"]);
});

test("an empty or missing value is not offered as an option", () => {
  const menu: TaxonomySource[] = [
    ...MENU,
    { name: "Holes", item_type: null, subtype: "  ", finish: "", size: "Regular" },
  ];
  eq(taxonomyOptions(menu, "item_type").map((o) => o.value), ["Old Fashioned", "Raised"]);
  no(cutOptions(menu, "Promise Ring").some((o) => o.value.trim() === ""), "no blank cut");
});

test("donut options are the menu's names, de-duplicated", () => {
  const menu = [...MENU, { ...MENU[0] }];
  eq(donutOptions(menu).length, 5);
  eq(donutOptions(menu)[0].value, "Angry Samoa");
});
