// scheduleDraft — a special order's items becoming a night's schedule lines.
//
// The anchor case is real: order #7769, "Birthday 07/15/2023", 21 lines that
// spell HAPPY BIRTHDAY VINNY. NOTHING is rolled up (Mark, 2026-08-27) — one
// order line becomes one schedule line, carrying its note, in the order's own
// sequence, because on this order that sequence IS the word.
//
// The case that settled it is the pair of Mini lines: same item, same cut, same
// size, notes "chocolate glaze" and "vanilla glaze". Any roll-up prints them as
// one line of 100 and never tells the decorator that half are chocolate.
//
// The negative cases matter most, and each was checked by breaking the code:
// sort by name and VINNY becomes an anagram; drop the note and the two Minis
// are indistinguishable; sum by (item, cut) and 20 lines collapse to 12; treat
// an untyped line as money and the ordinary donut vanishes off the sheet.

import { cutLetter } from "../../src/lib/specialOrderLines";
import {
  canonicalCut,
  scheduleDraft,
  scheduleTitle,
  type SchedulableLine,
} from "../../src/lib/specialOrderSchedule";
import { eq, ok, test } from "./harness";

const CHOC = "item-rites-choc";
const VANILLA = "item-rites-vanilla";
const BITES = "item-small-brown-bites";

function line(over: Partial<SchedulableLine> = {}): SchedulableLine {
  return {
    name: "Rites of Sprinkles - Letter",
    production_item_id: CHOC,
    item_type: "Raised",
    item_cut: null,
    item_finish: "Plain",
    item_size: "Regular",
    qty: 1,
    ...over,
  };
}

/** #7769's letters, in the order they appear on the order. */
const VINNY = "HAPPYBIRTHDAYVINNY".split("");

/** The real order: two Mini lines, eighteen letters, one Misc line. */
function order7769(): SchedulableLine[] {
  return [
    line({
      name: "Rites of Sprinkles - Mini",
      production_item_id: VANILLA,
      item_cut: "Promise Ring",
      item_size: "Mini",
      qty: 50,
      notes: "chocolate glaze",
    }),
    line({
      name: "Rites of Sprinkles - Mini",
      production_item_id: VANILLA,
      item_cut: "Promise Ring",
      item_size: "Mini",
      qty: 50,
      notes: "vanilla glaze",
    }),
    ...VINNY.map((c) => line({ item_cut: `Letter - "${c}"` })),
    line({
      name: "Small Brown Bites (x12)",
      production_item_id: BITES,
      item_type: "Misc",
      item_cut: null,
      item_finish: null,
      item_size: null,
      qty: 4,
    }),
  ];
}

/* ==========================================================================
 * The anchor
 * ========================================================================== */

test("scheduleDraft: #7769 transcribes, one order line to one schedule line", () => {
  const draft = scheduleDraft(order7769());

  // 18 letters + 2 Minis. NOT 12 — that was the rolled-up answer, and the
  // assertion that fails first if anybody reintroduces grouping.
  eq(draft.lines.length, 20, "line count");
  eq(draft.blocked.length, 0, "blocked");
  eq(draft.skippedMisc, 1, "Misc lines skipped");
  eq(draft.total, 118, "total donuts");

  // Two P's stay two lines of one, not one line of two.
  const ps = draft.lines.filter((l) => l.subtype === `Letter - "P"`);
  eq(ps.length, 2, "two P lines");
  eq(ps.map((l) => l.par), [1, 1], "each of one");

  const ys = draft.lines.filter((l) => l.subtype === `Letter - "Y"`);
  eq(ys.length, 3, "three Y lines");
});

test("scheduleDraft: the order's line order survives, so the word does", () => {
  const draft = scheduleDraft(order7769());
  const letters = draft.lines
    .map((l) => cutLetter(l.subtype))
    .filter((c): c is string => c !== null);
  // Sorting by name would give A B D H H I I N N P P R T V Y Y Y — an anagram
  // of the same donuts and useless to whoever is laying them out.
  eq(letters.join(""), "HAPPYBIRTHDAYVINNY", "the word");
  eq(draft.lines.map((l) => l.sort), Array.from({ length: 20 }, (_, i) => i + 1), "sort");
});

test("scheduleDraft: the note travels, and is what tells the Minis apart", () => {
  const draft = scheduleDraft(order7769());
  const minis = draft.lines.filter((l) => l.subtype === "Promise Ring");
  eq(minis.length, 2, "two Mini lines");
  eq(minis.map((l) => l.par), [50, 50], "not summed to 100");
  eq(minis.map((l) => l.note), ["chocolate glaze", "vanilla glaze"], "notes");
});

test("scheduleDraft: an empty or whitespace note is null, never an empty string", () => {
  const draft = scheduleDraft([
    line({ notes: "   " }),
    line({ item_cut: `Letter - "B"`, notes: "  extra sprinkles " }),
    line({ item_cut: `Letter - "C"` }),
  ]);
  eq(draft.lines.map((l) => l.note), [null, "extra sprinkles", null], "notes");
});

test("scheduleDraft: the snapshot comes from the ORDER LINE", () => {
  const draft = scheduleDraft([
    line({ name: "Peeps bunny, custom", item_cut: `Letter - "A"`, item_finish: "BOH Glaze" }),
  ]);
  eq(draft.lines[0].item_name, "Peeps bunny, custom", "customized name");
  eq(draft.lines[0].finish, "BOH Glaze", "finish");
  eq(draft.lines[0].item_type, "Raised", "type");
  eq(draft.lines[0].size, "Regular", "size");
});

/* ==========================================================================
 * canonicalCut — the 93 spellings
 * ========================================================================== */

test("canonicalCut: every spelling of one letter is ONE group", () => {
  eq(canonicalCut(`Letter - "A"`), `Letter - "A"`, "canonical");
  eq(canonicalCut(`Letter "A"`), `Letter - "A"`, "no dash");
  eq(canonicalCut(`Letter. "A"`), `Letter - "A"`, "full stop");
  eq(canonicalCut(`Letter- "A"`), `Letter - "A"`, "tight dash");
  eq(canonicalCut(`Letter - "a"`), `Letter - "A"`, "lowercase");
  eq(canonicalCut(`Letter - A"`), `Letter - "A"`, "stray closing quote");
});

test("scheduleDraft: three spellings of A stay three lines, spelled one way", () => {
  // The canonicalisation survives the end of grouping, and its job changed:
  // it no longer decides what merges, it decides what the SHEET says.
  const draft = scheduleDraft([
    line({ item_cut: `Letter - "A"` }),
    line({ item_cut: `Letter "A"` }),
    line({ item_cut: `Letter. "a"` }),
  ]);
  eq(draft.lines.length, 3, "line count");
  eq(draft.lines.map((l) => l.subtype), [`Letter - "A"`, `Letter - "A"`, `Letter - "A"`], "one spelling");
});

test("canonicalCut: a bare Letter is its own group, never folded into one", () => {
  // 935 real rows: letters ordered, the word not yet settled. Folding this
  // into any character would invent a decision nobody made.
  eq(canonicalCut("Letter"), "Letter", "bare");
  eq(canonicalCut("Letter"), "Letter", "stays bare");
});

test("canonicalCut: punctuation characters survive, and are not upper-cased", () => {
  eq(canonicalCut(`Letter - "<3"`), `Letter - "<3"`, "heart");
  eq(canonicalCut(`Letter - "!"`), `Letter - "!"`, "bang");
});

test("canonicalCut: a non-letter cut is trimmed and left alone", () => {
  eq(canonicalCut("  Promise Ring "), "Promise Ring", "trimmed");
  eq(canonicalCut("Bismark"), "Bismark", "as typed");
  eq(canonicalCut(""), null, "empty is null");
  eq(canonicalCut(null), null, "null is null");
});

/* ==========================================================================
 * The three populations
 * ========================================================================== */

test("scheduleDraft: a production line with no item is BLOCKED, not dropped", () => {
  const draft = scheduleDraft([
    line({ name: "Peeps bunny", production_item_id: null }),
    line({ item_cut: `Letter - "A"` }),
  ]);
  eq(draft.lines.length, 1, "one schedulable line");
  eq(draft.blocked.length, 1, "one blocked");
  eq(draft.blocked[0].name, "Peeps bunny", "named");
  // It must not have been counted toward what the kitchen is told to make.
  eq(draft.total, 1, "total excludes the blocked line");
});

test("scheduleDraft: a Misc line is skipped silently, whatever its prefix", () => {
  const draft = scheduleDraft([
    line({ name: "Delivery Fee", item_type: "Misc", production_item_id: null, qty: 1 }),
    line({ name: "Cupcake liners", item_type: "Misc- Cupcake liners", production_item_id: BITES }),
  ]);
  eq(draft.lines.length, 0, "nothing to make");
  eq(draft.skippedMisc, 2, "both counted as Misc");
  // A Misc line with no production item is NOT a blocker — it was never
  // production, so naming it in the confirm would be noise.
  eq(draft.blocked.length, 0, "blocked");
});

test("scheduleDraft: a line with NO type is production, not money", () => {
  // 569 real lines carry no type and are ordinary donuts. The fallback has to
  // be this way round or they fall off the kitchen sheet in silence.
  const draft = scheduleDraft([line({ item_type: null, item_cut: null, qty: 12 })]);
  eq(draft.lines.length, 1, "scheduled");
  eq(draft.skippedMisc, 0, "not skipped");
  eq(draft.lines[0].par, 12, "par");
});

test("scheduleDraft: a zero or negative quantity never reaches the kitchen", () => {
  // Three real lines carry a negative qty — a credit for a short delivery.
  // Dropped PER LINE now, so a credit no longer cancels a sibling's donuts.
  const draft = scheduleDraft([
    line({ item_cut: `Letter - "A"`, qty: 0 }),
    line({ name: "short (dropped bin)", item_cut: "Promise Ring", qty: -30 }),
    line({ item_cut: `Letter - "B"`, qty: 2 }),
  ]);
  eq(draft.lines.length, 1, "only the real one");
  eq(draft.lines[0].subtype, `Letter - "B"`, "which one");
  eq(draft.total, 2, "total");
});

test("scheduleDraft: a credit does NOT cancel an identical positive line", () => {
  // Under the old roll-up +80 and -80 on one (item, cut) summed to zero and the
  // whole thing vanished off the sheet. Transcribing keeps the 80 to make.
  const draft = scheduleDraft([
    line({ item_cut: "Promise Ring", qty: 80 }),
    line({ name: "short s'morrisseys", item_cut: "Promise Ring", qty: -80 }),
  ]);
  eq(draft.lines.length, 1, "the credit drops, the donuts stay");
  eq(draft.total, 80, "total");
});

test("scheduleDraft: an order with nothing schedulable is an empty draft", () => {
  const draft = scheduleDraft([line({ name: "Delivery Fee", item_type: "Misc" })]);
  eq(draft.lines.length, 0, "lines");
  eq(draft.total, 0, "total");
});

/* ==========================================================================
 * Sort and title
 * ========================================================================== */

test("scheduleDraft: lines keep the order given, and number from 1", () => {
  const draft = scheduleDraft([
    line({ name: "Zebra", item_cut: `Letter - "B"` }),
    line({ name: "Apple", item_cut: `Letter - "Z"` }),
    line({ name: "Apple", item_cut: `Letter - "A"` }),
  ]);
  eq(
    draft.lines.map((l) => `${l.item_name} ${l.subtype}`),
    [`Zebra Letter - "B"`, `Apple Letter - "Z"`, `Apple Letter - "A"`],
    "order as given"
  );
  eq(draft.lines.map((l) => l.sort), [1, 2, 3], "sort");
});

test("scheduleTitle: number and order name, and the number alone without one", () => {
  eq(scheduleTitle("9885", "Fay wedding"), "#9885 · Fay wedding", "both");
  eq(scheduleTitle("9885", null), "#9885", "no name");
  eq(scheduleTitle("9885", "   "), "#9885", "blank name");
  eq(scheduleTitle("3932 cont.", "Rehearsal"), "#3932 cont. · Rehearsal", "text number");
});
