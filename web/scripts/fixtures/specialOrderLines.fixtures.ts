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
  addedLineName,
  needsLetterChoice,
  parseLetters,
  cutLetter,
  cutOptions,
  donutOptions,
  groupLines,
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

/* -- adding a line from the menu ------------------------------------------- */

test("addedLineName: a Mini or a Giant carries its size, a Regular does not", () => {
  eq(addedLineName({ name: "Rites of Sprinkles - Straw", size: "Mini" }, null), "Rites of Sprinkles - Straw - Mini");
  eq(addedLineName({ name: "Old Fashioned", size: "Giant" }, null), "Old Fashioned - Giant");
  eq(addedLineName({ name: "Angry Samoa", size: "Regular" }, null), "Angry Samoa");
  eq(addedLineName({ name: "Angry Samoa", size: null }, null), "Angry Samoa");
});

test("addedLineName: the letter goes last, after any size", () => {
  eq(addedLineName({ name: "Rites of Sprinkles - Straw", size: "Regular" }, "A"), "Rites of Sprinkles - Straw - Letter A");
  eq(addedLineName({ name: "Angry Samoa", size: "Mini" }, "<3"), "Angry Samoa - Mini - Letter <3");
});

test("needsLetterChoice: only a bare Letter cut asks", () => {
  ok(needsLetterChoice("Letter"));
  ok(needsLetterChoice(" letter "));
  no(needsLetterChoice('Letter "<3"'), "the heart names its character");
  no(needsLetterChoice("Promise Ring"), "not a letter");
  no(needsLetterChoice(null), "no cut");
});

/* -- several letters in one box (Mark, 2026-09-22) ------------------------- */

test("parseLetters: commas separate, in the order typed, repeats kept", () => {
  eq(parseLetters("H, A, P, P, Y"), ["H", "A", "P", "P", "Y"]);
  eq(parseLetters("h,a"), ["H", "A"]);
});

test("parseLetters: nothing but a comma separates", () => {
  eq(parseLetters("HAPPY"), ["HAPPY"], "no commas is one character, as before");
  eq(parseLetters("OP"), ["OP"]);
  eq(parseLetters("H A"), ["H A"], "a space is not a separator");
});

test("parseLetters: the heart and the punctuation survive whole", () => {
  eq(parseLetters("<3, !, -, &"), ["<3", "!", "-", "&"]);
});

test("parseLetters: blanks are dropped, and nothing typed is an empty list", () => {
  eq(parseLetters("H,,A,"), ["H", "A"]);
  eq(parseLetters(""), []);
  eq(parseLetters(" , "), []);
});

/* -- the Items tab's Group by (Mark, 2026-09-29) ------------------------- */

const L = (id: string, item_donut: string | null, item_type: string | null, unit_price: number | null, name = `${item_donut} - Letter ${id}`) =>
  ({ id, name, item_donut, item_type, unit_price });
// SO-10092's shape: a letter order, every line named apart.
const LETTERS = [
  L("T", "Give Up the Toast", "Raised", 5.1),
  L("H", "Compassion Fruit", "Raised", 5.1),
  L("A", "Strawberry So Far", "Raised", 5.6),
  L("K", "Promise Ring - Glazed", "Raised", 4.6),
  L("E", "Give Up the Toast", "Cake", 4.6),
  L("X", null, null, null, "Delivery box"),
];

test("groupLines: None is the document, untouched", () => {
  const g = groupLines(LETTERS, "none");
  eq(g.length, 1);
  eq(g[0].label, "");
  eq(g[0].rows.map((r) => r.id), ["T", "H", "A", "K", "E", "X"]);
});

test("groupLines: Price runs low to high, and keeps document order inside a run", () => {
  const g = groupLines(LETTERS, "price");
  eq(g.map((x) => x.label), ["$4.60", "$5.10", "$5.60", "No price"]);
  eq(g[0].rows.map((r) => r.id), ["K", "E"], "K before E, as the document has them");
  eq(g[1].rows.map((r) => r.id), ["T", "H"]);
});

test("groupLines: Item is the DONUT, so two letters of one donut share a band", () => {
  const g = groupLines(LETTERS, "item");
  const toast = g.find((x) => x.label === "Give Up the Toast")!;
  eq(toast.rows.map((r) => r.id), ["T", "E"]);
  // No donut recorded: the line's name stands in, rather than a "No item" band.
  ok(g.some((x) => x.label === "Delivery box"));
  eq(g.map((x) => x.label), ["Compassion Fruit", "Delivery box", "Give Up the Toast", "Promise Ring - Glazed", "Strawberry So Far"]);
});

test("groupLines: Item type A→Z, the empty type last", () => {
  const g = groupLines(LETTERS, "type");
  eq(g.map((x) => x.label), ["Cake", "Raised", "No type"]);
  eq(g[1].rows.map((r) => r.id), ["T", "H", "A", "K"]);
});

test("groupLines: Price is ordered as a NUMBER — $12.00 after $4.60", () => {
  const g = groupLines([L("Z", "Giant", "Raised", 12), L("A", "Mini", "Raised", 4.6)], "price");
  eq(g.map((x) => x.label), ["$4.60", "$12.00"]);
});

test("groupLines: Item cut bands every letter as ONE cut, and Item size by size", () => {
  const rows = [
    { ...L("T", "Toast", "Raised", 5.1), item_cut: 'Letter - "T"', item_size: "Regular" },
    { ...L("H", "Fruit", "Raised", 5.1), item_cut: 'Letter - "H"', item_size: "Regular" },
    { ...L("M", "Samoa", "Raised", 3), item_cut: "Promise Ring", item_size: "Mini" },
    { ...L("N", "Plain", "Raised", 3), item_cut: null, item_size: null },
  ];
  const cut = groupLines(rows, "cut");
  eq(cut.map((x) => x.label), ["Letter", "Promise Ring", "No cut"]);
  eq(cut[0].rows.map((r) => r.id), ["T", "H"]);
  eq(groupLines(rows, "size").map((x) => x.label), ["Mini", "Regular", "No size"]);
});
