// scheduleDraft — a special order's items becoming a night's schedule lines.
//
// The anchor case is real: order #7769, "Birthday 07/15/2023", 21 lines that
// spell HAPPY BIRTHDAY VINNY. Every one of its 18 letters points at the SAME
// production item, because `production_items` has one generic `Letter` subtype
// per flavour and no per-character rows. Group by item alone and the decorator
// gets "18 x Rites of Sprinkles - Letter"; group by (item, cut) and they get
// the word. That is the whole reason migration 067 moves the unique key.
//
// The negative cases are the ones that matter most here, and each was checked
// by breaking the code: fold the letter spellings together wrongly and the
// three-spelling case goes red; group by item instead of (item, cut) and VINNY
// collapses from 12 lines to 2; treat an untyped line as money and the ordinary
// donut vanishes off the kitchen sheet.

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
    }),
    line({
      name: "Rites of Sprinkles - Mini",
      production_item_id: VANILLA,
      item_cut: "Promise Ring",
      item_size: "Mini",
      qty: 50,
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

test("scheduleDraft: #7769's 18 letters become one line per character", () => {
  const draft = scheduleDraft(order7769());

  // 11 DISTINCT letters in HAPPYBIRTHDAYVINNY (H A P Y B I R T D V N), plus
  // the Mini promise ring. Eighteen order lines, twelve things to make.
  eq(draft.lines.length, 12, "line count");
  eq(draft.blocked.length, 0, "blocked");
  eq(draft.skippedMisc, 1, "Misc lines skipped");

  // 18 letters + 100 minis. The Misc line's 4 is NOT in here.
  eq(draft.total, 118, "total donuts");

  const byCut = new Map(draft.lines.map((l) => [l.subtype, l.par]));
  // The repeated letters SUM. This is the assertion that fails if the group
  // key becomes the order line rather than (item, cut).
  eq(byCut.get(`Letter - "Y"`), 3, "Y");
  eq(byCut.get(`Letter - "H"`), 2, "H");
  eq(byCut.get(`Letter - "A"`), 2, "A");
  eq(byCut.get(`Letter - "P"`), 2, "P");
  eq(byCut.get(`Letter - "I"`), 2, "I");
  eq(byCut.get(`Letter - "N"`), 2, "N");
  eq(byCut.get(`Letter - "B"`), 1, "B");
  eq(byCut.get(`Letter - "R"`), 1, "R");
  eq(byCut.get(`Letter - "T"`), 1, "T");
  eq(byCut.get(`Letter - "D"`), 1, "D");
  eq(byCut.get(`Letter - "V"`), 1, "V");

  // The two identical Mini lines are a TRUE duplicate and merge into one 100,
  // and the merge is COUNTED, so the dialog can show it rather than quietly
  // dropping one of the two names.
  eq(byCut.get("Promise Ring"), 100, "the minis");
  const minis = draft.lines.find((l) => l.subtype === "Promise Ring");
  eq(minis?.sources, 2, "two order lines merged");
  eq(draft.lines.find((l) => l.subtype === `Letter - "B"`)?.sources, 1, "a lone letter");
  eq(draft.lines.find((l) => l.subtype === `Letter - "Y"`)?.sources, 3, "three Y lines");
});

test("scheduleDraft: grouping by item alone would give 2 lines, not 12", () => {
  const draft = scheduleDraft(order7769());
  const items = new Set(draft.lines.map((l) => l.item_id));
  // Two items across twelve lines — the cut is doing the work. If this ever
  // reads 2 items / 2 lines, the group key has lost the cut.
  eq(items.size, 2, "distinct production items");
  ok(draft.lines.length > items.size, "more lines than items");
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

test("scheduleDraft: three spellings of A are one line of three", () => {
  const draft = scheduleDraft([
    line({ item_cut: `Letter - "A"` }),
    line({ item_cut: `Letter "A"` }),
    line({ item_cut: `Letter. "a"` }),
  ]);
  eq(draft.lines.length, 1, "line count");
  eq(draft.lines[0].subtype, `Letter - "A"`, "canonical spelling wins");
  eq(draft.lines[0].par, 3, "summed");
});

test("canonicalCut: a bare Letter is its own group, never folded into one", () => {
  // 935 real rows: letters ordered, the word not yet settled. Folding this
  // into any character would invent a decision nobody made.
  eq(canonicalCut("Letter"), "Letter", "bare");
  const draft = scheduleDraft([
    line({ item_cut: "Letter" }),
    line({ item_cut: `Letter - "A"` }),
  ]);
  eq(draft.lines.length, 2, "kept apart");
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
  const draft = scheduleDraft([
    line({ item_cut: `Letter - "A"`, qty: 0 }),
    line({ name: "short (dropped bin)", item_cut: "Promise Ring", qty: -30 }),
    line({ item_cut: `Letter - "B"`, qty: 2 }),
  ]);
  eq(draft.lines.length, 1, "only the real one");
  eq(draft.lines[0].subtype, `Letter - "B"`, "which one");
  eq(draft.total, 2, "total");
});

test("scheduleDraft: an order with nothing schedulable is an empty draft", () => {
  const draft = scheduleDraft([line({ name: "Delivery Fee", item_type: "Misc" })]);
  eq(draft.lines.length, 0, "lines");
  eq(draft.total, 0, "total");
});

/* ==========================================================================
 * Sort and title
 * ========================================================================== */

test("scheduleDraft: lines sort by name then cut, and number from 1", () => {
  const draft = scheduleDraft([
    line({ name: "Zebra", item_cut: `Letter - "B"` }),
    line({ name: "Apple", item_cut: `Letter - "Z"` }),
    line({ name: "Apple", item_cut: `Letter - "A"` }),
  ]);
  eq(
    draft.lines.map((l) => `${l.item_name} ${l.subtype}`),
    [`Apple Letter - "A"`, `Apple Letter - "Z"`, `Zebra Letter - "B"`],
    "order"
  );
  eq(draft.lines.map((l) => l.sort), [1, 2, 3], "sort");
});

test("scheduleTitle: number and order name, and the number alone without one", () => {
  eq(scheduleTitle("9885", "Fay wedding"), "#9885 · Fay wedding", "both");
  eq(scheduleTitle("9885", null), "#9885", "no name");
  eq(scheduleTitle("9885", "   "), "#9885", "blank name");
  eq(scheduleTitle("3932 cont.", "Rehearsal"), "#3932 cont. · Rehearsal", "text number");
});
