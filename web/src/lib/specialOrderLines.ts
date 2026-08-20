/**
 * A SPECIAL ORDER LINE'S TAXONOMY — the five fields under the customized name,
 * and the one of them that carries a letter.
 *
 * Decision 5 makes a line an editable COPY of a production item: the snapshot
 * arrives from the menu and then the line owns it. The name, quantity, price
 * and note have been editable since the module shipped; the taxonomy —
 * donut · type · cut · finish · size — was rendered as plain text, so the five
 * fields that decide what the KITCHEN document says were the only ones on the
 * row nobody could correct. This module is the vocabulary each of them offers.
 *
 * Pure, and fixture-tested. Nothing here touches the database or the DOM.
 *
 * ---------------------------------------------------------------------------
 * THE CUT IS WHERE THE LETTER LIVES, and that is a measurement rather than a
 * design (Mark, 2026-08-19: "If the item is a letter donut, the app should
 * allow the user to select the cut that represents the actual letter").
 *
 * A letter donut is cut into a character — that is what makes it a letter
 * donut — and FileMaker recorded which character IN THE CUT, not beside it.
 * Measured over the 47,814 migrated lines: 9,926 carry a cut beginning
 * "Letter", and 8,991 of those name the character in the cut itself. The
 * dominant spelling is `Letter - "A"` (1,167 of the 1,185 A's; `Letter "A"`
 * accounts for 17, and a handful read `Letter. "A"`), so that is the form
 * `letterCut` composes and the odd spellings are read but never written.
 *
 * The remaining 935 read a bare `Letter` — which is a REAL STATE and not a
 * gap: an order for three dozen glazed letters whose word nobody has decided
 * yet. So "no character" stays reachable and is never inferred.
 *
 * THE CHARACTER SET IS THE REAL ONE. All 26 letters and all 10 digits appear
 * in the history, and so do `<3` (277 lines — the Valentine's heart, which the
 * menu even carries as its own subtype `Letter "<3"`), `!` (160), `+` (20),
 * `&` (6), `?` (4) and `-` (2). Those six earn their place in the list by
 * being ordered hundreds of times between them. Anything rarer — `OP`, `AB`,
 * `)` , `*`, one line each — is why the cut cell keeps `allowNew`: this is a
 * vocabulary that legitimately grows, and a check constraint over it would
 * refuse real orders (051's own lesson about `todo`).
 */

import type { PickOption } from "@/components/ui/PickList";

/** The five snapshot columns, in the order the row prints them. */
export type LineTaxonomy = {
  item_donut: string | null;
  item_type: string | null;
  item_cut: string | null;
  item_finish: string | null;
  item_size: string | null;
};

/** What a menu item offers each of those fields. `AddOrderLine`'s `MenuItem`. */
export type TaxonomySource = {
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  name: string;
};

/* ==========================================================================
 * 1. LETTERS
 * ========================================================================== */

/** A–Z, then 0–9, then the six characters the twelve years of orders hold. */
export const LETTER_CHARACTERS: string[] = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
  "<3",
  "!",
  "?",
  "&",
  "+",
  "-",
];

/** What each of the six non-alphanumerics is, said in the picker's hint. */
export const LETTER_HINT: Record<string, string> = {
  "<3": "heart",
  "!": "exclamation mark",
  "?": "question mark",
  "&": "ampersand",
  "+": "plus",
  "-": "dash",
};

/**
 * Is this line a letter donut?
 *
 * The test is the CUT and nothing else. It deliberately does not look at the
 * item's name: "Donut Letters", "Angry Samoa" and "Bananaversary" are all cut
 * into letters and only one of them says so, while a "Letterman jacket" line
 * somebody types is money, not a cut.
 *
 * Prefix-insensitive, because the history's spellings differ after the word
 * and never before it — `Letter`, `Letter - "A"`, `Letter "A"`, `Letter. "A"`,
 * `Letter "<3"` (a real menu subtype) are all the same family.
 */
export function isLetterCut(cut: string | null | undefined): boolean {
  return /^\s*letter\b/i.test(cut ?? "");
}

/** The stored cut for a character — the canonical spelling, always. */
export function letterCut(character: string): string {
  return `Letter - "${character}"`;
}

/**
 * The character a cut names, or null for a bare `Letter`.
 *
 * Reads every spelling the export holds, since a migrated line must show its
 * own letter as CHOSEN rather than as an unrecognised value. Two real rows end
 * with a stray closing quote and no opening one (`Letter - U"`), which the
 * trailing-quote strip handles; folding case is deliberate, because `Letter -
 * "y"` and `Letter - "Y"` are one order of the same donut.
 */
export function cutLetter(cut: string | null | undefined): string | null {
  if (!isLetterCut(cut)) return null;
  const rest = (cut ?? "").replace(/^\s*letter\b/i, "").trim();
  // Drop the separator FileMaker's various spellings put between the word and
  // the character: `- "A"`, `. "A"`, `"A"`, `- A"`.
  const inner = rest.replace(/^[-.\s]+/, "").replace(/^"+/, "").replace(/"+$/, "").trim();
  if (inner === "") return null;
  // A single letter is upper-cased; `<3` and the punctuation are left alone.
  return /^[a-z]$/.test(inner) ? inner.toUpperCase() : inner;
}

/**
 * The cut options for one line.
 *
 * Two groups, and the first appears ONLY for a letter donut:
 *
 *   · **Letter** — one option per character, whose VALUE is the composed cut.
 *     So choosing the letter IS choosing the cut, which is Mark's sentence
 *     exactly, and no composition happens at write time: the cell writes the
 *     option's value into `item_cut` like any other pick cell.
 *   · **Cut** — every distinct subtype the live menu carries, which is what a
 *     cut is everywhere else in the app (`production_items.subtype`).
 *
 * HIDING THE LETTERS ON A NON-LETTER LINE IS THE WHOLE OF THE CARE. A donut
 * that is not cut into a character has no letter to choose, and forty-two
 * options that mean nothing to it would bury the twenty-two that do. You get
 * there by choosing `Letter` from the cuts, which the menu carries (56 of the
 * 307 items) — one extra step, taken only when you are deliberately turning a
 * ring into a letter.
 *
 * WHEN THEY DO APPEAR THEY LEAD, because on a letter line the character is the
 * only thing you opened the list to change; behind twenty-two cuts it is a
 * scroll or a search away. The cuts stay listed under them, which is how you
 * leave.
 *
 * And the letter-family SUBTYPES come out of the cuts while the group is
 * showing — `Letter` and `Letter "<3"` are what the Letter group is made of,
 * so listing them twice would offer the same donut under two spellings, one of
 * them not the canonical one.
 */
export function cutOptions(
  menu: readonly TaxonomySource[],
  current: string | null | undefined
): PickOption[] {
  const subtypes = distinct(menu.map((m) => m.subtype));
  const letters = isLetterCut(current);
  const cuts = subtypes
    .filter((value) => !letters || !isLetterCut(value))
    .map((value) => ({ value, label: value, group: "Cut" }));
  if (!letters) return cuts;

  return [
    // The bare family, kept reachable: 935 real lines are a letter order whose
    // character has not been decided, and that is a state you must be able to
    // return a line to.
    { value: "Letter", label: "Letter", hint: "character not decided", group: "Letter" },
    ...LETTER_CHARACTERS.map((c) => ({
      value: letterCut(c),
      // The LETTER is the label. `Letter - "A"` as a label would make forty-two
      // rows that differ in their last two characters.
      label: c,
      hint: LETTER_HINT[c],
      group: "Letter",
    })),
    ...cuts,
  ];
}

/* ==========================================================================
 * 2. THE OTHER FOUR FIELDS
 * ========================================================================== */

/**
 * The distinct live values of one taxonomy field, as pick options.
 *
 * Sourced from the MENU the screen already has rather than from a settings
 * list, so the vocabulary is whatever the catalog actually says today and
 * cannot drift from it. Every one of these cells carries `allowNew` at the
 * call site: decision 5 says a line is a customized copy, and "Raised, but
 * baked" is a thing somebody will legitimately need to type.
 */
export function taxonomyOptions(
  menu: readonly TaxonomySource[],
  field: "item_type" | "subtype" | "finish" | "size"
): PickOption[] {
  return distinct(menu.map((m) => m[field])).map((value) => ({ value, label: value }));
}

/**
 * The DONUT the line started from — the menu item's own name.
 *
 * Offered as a list because `item_donut` is nearly always one of the 307 menu
 * names (the snapshot writes it), and typing "Bananaversary" from memory is
 * how a kitchen sheet ends up with two spellings of one donut. `allowNew`
 * covers the rest.
 */
export function donutOptions(menu: readonly TaxonomySource[]): PickOption[] {
  return distinct(menu.map((m) => m.name)).map((value) => ({ value, label: value }));
}

/** Non-empty, de-duplicated, ordered the way a person reads a list. */
function distinct(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t !== "") seen.add(t);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
