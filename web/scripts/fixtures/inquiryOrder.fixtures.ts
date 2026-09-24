// `lib/inquiryOrder` — the inquiry form's basket (special orders 4b).
//
// The minimums are pinned at EVERY boundary (23/24, 5/6, 9/10) because a rule
// that is off by one reads as working on every order but the one it matters to.
// Migration 133 states the same rules in SQL; the Docker harness pins that side.

import { test, eq, ok, no } from "./harness";
import {
  EMPTY_BASKET,
  EMPTY_RULES,
  alignAssign,
  basketIsEmpty,
  basketLines,
  basketPayload,
  basketProblems,
  displayMessage,
  estimateTotals,
  letterCount,
  newLetterRequest,
  readMenu,
  splitMessage,
  todayIn,
  unassignedLetters,
  type Basket,
  type InquiryMenuItem,
  type InquiryRules,
  type LetterRequest,
} from "../../src/lib/inquiryOrder";

const MENU: InquiryMenuItem[] = [
  { id: "r1", name: "Angry Samoa", category: "regular", price: 5.45, quoted: false, description: null },
  { id: "r2", name: "Promise Ring - Glazed", category: "regular", price: 3.45, quoted: false, description: null },
  { id: "m1", name: "Angry Samoa", category: "mini", price: 1.9, quoted: false, description: null },
  { id: "m2", name: "Mint Town", category: "mini", price: 2.25, quoted: false, description: null },
  { id: "g1", name: "Angry Samoa", category: "giant", price: 15.5, quoted: false, description: null },
  { id: "l1", name: "Angry Samoa", category: "letter", price: 6.6, quoted: false, description: null },
  { id: "l2", name: "Promise Ring - Glazed", category: "letter", price: 4.6, quoted: false, description: null },
  { id: "x1", name: "Catering Platter", category: "extra", price: 0, quoted: true, description: null },
  { id: "x2", name: "Ice Cream Container - 3 Gallons", category: "extra", price: 9, quoted: false, description: null },
];

const MINS = { regular: 24, mini: 24, mini_per_flavor: 6, letter: 10, giant: 1 };

const RULES: InquiryRules = {
  ...EMPTY_RULES,
  minimums: MINS,
  tax_rate: 0.0975,
};

function letters(over: Partial<LetterRequest>): LetterRequest {
  return { ...newLetterRequest("k"), ...over };
}

function basket(qty: Record<string, number>, reqs: LetterRequest[] = []): Basket {
  return { qty, letters: reqs };
}

const cats = (b: Basket) => basketProblems(b, MENU, MINS).map((p) => p.category);

/* -------------------------------------------------------------------------
 * splitMessage
 * ---------------------------------------------------------------------- */

test("splitMessage: upper-cases, drops spaces, keeps repeats in order", () => {
  eq(splitMessage("happy  bday").characters, ["H", "A", "P", "P", "Y", "B", "D", "A", "Y"]);
  eq(splitMessage("HI\nMOM").characters, ["H", "I", "M", "O", "M"]);
});

test("splitMessage: every spelling of a heart is the <3 cut", () => {
  eq(splitMessage("I<3U").characters, ["I", "<3", "U"]);
  eq(splitMessage("I ♥ U").characters, ["I", "<3", "U"]);
  eq(splitMessage("I ❤️ U").characters, ["I", "<3", "U"], "❤ with its emoji selector");
  eq(splitMessage("I ❤ U").characters, ["I", "<3", "U"]);
});

test("splitMessage: digits and the five punctuation cuts are makeable", () => {
  eq(splitMessage("40!?&+-").characters, ["4", "0", "!", "?", "&", "+", "-"]);
  eq(splitMessage("40!?&+-").invalid, []);
});

test("splitMessage: what we can't cut is reported once each, in order", () => {
  const r = splitMessage("A@B#C@é");
  eq(r.characters, ["A", "B", "C"]);
  eq(r.invalid, ["@", "#", "é"]);
});

test("splitMessage: a lone < or 3 is not a heart", () => {
  eq(splitMessage("3<").characters, ["3"]);
  eq(splitMessage("3<").invalid, ["<"]);
});

test("displayMessage: as typed, upper-cased, hearts as ♥", () => {
  eq(displayMessage("  happy  40th <3 "), "HAPPY 40TH ♥");
  eq(displayMessage("i ❤️ u"), "I ♥ U");
});

test("letterCount: characters × sets, spaces free", () => {
  eq(letterCount({ message: "HELLO", sets: 2 }), 10);
  eq(letterCount({ message: "HI MOM", sets: 1 }), 5);
  eq(letterCount({ message: "", sets: 3 }), 0);
});

/* -------------------------------------------------------------------------
 * alignAssign
 * ---------------------------------------------------------------------- */

test("alignAssign: keeps choices by position, pads and trims", () => {
  eq(alignAssign(["l1", "l2"], 3, ["l1", "l2"]), ["l1", "l2", null]);
  eq(alignAssign(["l1", "l2", "l1"], 2, ["l1", "l2"]), ["l1", "l2"]);
});

test("alignAssign: storing never fills in a choice the customer did not make", () => {
  eq(alignAssign([], 3, ["l1"], false), [null, null, null]);
  eq(alignAssign([], 3, ["l1"]), ["l1", "l1", "l1"], "pricing does");
});

test("after ticking one flavour, then a second: nothing pre-chosen", () => {
  // The browser bug: the first tick filled every letter with it.
  const req = letters({ message: "ABC", flavors: ["l1", "l2"], assign: [null, "l2", null] });
  eq(basketLines(basket({}, [req]), MENU).map((l) => [l.qty, l.unitPrice]), [
    [2, 5.6],
    [1, 4.6],
  ]);
});

test("alignAssign: a flavour taken off the list clears its letters", () => {
  eq(alignAssign(["l1", "l2"], 2, ["l2"]), ["l2", "l2"], "one flavour left fills the gap");
  eq(alignAssign(["l1", "l2"], 2, ["l2", "l3"]), [null, "l2"]);
});

/* -------------------------------------------------------------------------
 * The minimums — every boundary
 * ---------------------------------------------------------------------- */

test("an empty basket is fine: describing it in words is a whole inquiry", () => {
  eq(cats(EMPTY_BASKET), []);
  ok(basketIsEmpty(EMPTY_BASKET));
  ok(basketIsEmpty(basket({ r1: 0 }, [letters({ message: "   " })])));
  no(basketIsEmpty(basket({ g1: 1 })));
});

test("regulars: 23 is short, 24 is not, across flavours", () => {
  eq(cats(basket({ r1: 23 })), ["regular"]);
  eq(cats(basket({ r1: 24 })), []);
  eq(cats(basket({ r1: 12, r2: 12 })), [], "the minimum is a total, not per flavour");
});

test("minis: 24 in total AND 6 of each flavour", () => {
  eq(cats(basket({ m1: 23 })), ["mini"]);
  eq(cats(basket({ m1: 24 })), []);
  eq(cats(basket({ m1: 18, m2: 6 })), []);
  eq(cats(basket({ m1: 19, m2: 5 })), ["mini"], "total met, one flavour at 5");
  const msg = basketProblems(basket({ m1: 19, m2: 5 }), MENU, MINS)[0].message;
  ok(msg.includes("Mint Town has 5"), "names the flavour that is short");
  eq(cats(basket({ m1: 3, m2: 3 })), ["mini", "mini"], "both rules at once");
});

test("letters: 9 is short, 10 is not, and sets count", () => {
  eq(cats(basket({}, [letters({ message: "HAPPYBDAY", flavors: ["l1"] })])), ["letter"]);
  eq(cats(basket({}, [letters({ message: "HAPPY BDAY!", flavors: ["l1"] })])), []);
  eq(cats(basket({}, [letters({ message: "HELLO", flavors: ["l1"], sets: 2 })])), []);
  eq(
    cats(basket({}, [letters({ message: "HI", flavors: ["l1"] }), letters({ message: "MOM!!!!!", flavors: ["l2"] })])),
    [],
    "the minimum spans every letters request"
  );
});

test("giants: one is enough", () => {
  eq(cats(basket({ g1: 1 })), []);
});

test("EACH CATEGORY ORDERED MEETS ITS OWN: 12 regulars + 1 giant is refused", () => {
  eq(cats(basket({ r1: 12, g1: 1 })), ["regular"]);
  eq(cats(basket({ r1: 24, g1: 1, m1: 24 })), []);
});

test("letters with no flavour, or characters we can't cut, are problems", () => {
  eq(cats(basket({}, [letters({ message: "HAPPY BIRTHDAY" })])), ["letter"]);
  eq(cats(basket({}, [letters({ message: "HAPPY @ BIRTHDAY", flavors: ["l1"] })])), ["letter"]);
});

/* -------------------------------------------------------------------------
 * Lines and the estimate
 * ---------------------------------------------------------------------- */

test("basketLines: donuts, minis and giants price at the menu's price", () => {
  const lines = basketLines(basket({ r1: 24, m2: 6, g1: 1 }), MENU);
  eq(lines.map((l) => [l.label, l.qty, l.total]), [
    ["Angry Samoa", 24, 130.8],
    ["Mint Town (Mini)", 6, 13.5],
    ["Angry Samoa (Giant)", 1, 15.5],
  ]);
});

test("basketLines: one flavour means every letter is that flavour", () => {
  const lines = basketLines(basket({}, [letters({ message: "HI MOM", flavors: ["l1"], sets: 2 })]), MENU);
  eq(lines.map((l) => [l.label, l.qty, l.unitPrice]), [["“HI MOM” letters — Angry Samoa", 10, 6.6]]);
});

test("basketLines: letters not chosen yet keep the total honest at the average", () => {
  const lines = basketLines(basket({}, [letters({ message: "HELLO", flavors: ["l1", "l2"] })]), MENU);
  eq(lines.map((l) => [l.label, l.qty, l.unitPrice, l.total]), [
    ["“HELLO” letters — flavor not chosen yet", 5, 5.6, 28],
  ]);
});

test("basketLines: per-letter choices group by flavour; unchosen ones average", () => {
  const req = letters({
    message: "ABC",
    flavors: ["l1", "l2"],
    assign: ["l1", "l2", null],
  });
  eq(basketLines(basket({}, [req]), MENU).map((l) => [l.qty, l.unitPrice]), [
    [1, 6.6],
    [1, 4.6],
    [1, 5.6],
  ]);
});

test("estimate: tax on goods only; rush inside two business days", () => {
  const lines = basketLines(basket({ r1: 24 }), MENU); // 130.80
  const far = estimateTotals({ lines, rules: RULES, eventDate: "2026-10-30", today: "2026-09-24", deliveryFee: null });
  eq([far.subtotal, far.rushFee, far.tax, far.delivery, far.total], [130.8, null, 12.75, null, 143.55]);

  // Thursday → Friday is one business day: rush is max($25, 30%) = 39.24.
  const rush = estimateTotals({ lines, rules: RULES, eventDate: "2026-09-25", today: "2026-09-24", deliveryFee: 40 });
  eq([rush.rushFee, rush.tax, rush.delivery, rush.total], [39.24, 12.75, 40, 222.79]);

  // Thursday → Monday is exactly two business days: no rush.
  const edge = estimateTotals({ lines, rules: RULES, eventDate: "2026-09-28", today: "2026-09-24", deliveryFee: null });
  eq(edge.rushFee, null);
});

test("estimate: an unknown tax rate is null, not zero", () => {
  const lines = basketLines(basket({ g1: 1 }), MENU);
  const e = estimateTotals({ lines, rules: { ...RULES, tax_rate: null }, eventDate: null, today: "2026-09-24", deliveryFee: null });
  eq([e.tax, e.total], [null, 15.5]);
});

/* -------------------------------------------------------------------------
 * The wire
 * ---------------------------------------------------------------------- */

test("basketPayload: quantities only, never a price", () => {
  const p = basketPayload(basket({ r1: 24, m1: 0, g1: 1, nope: 5 }), MENU);
  eq(p.lines, [
    { item_id: "r1", qty: 24 },
    { item_id: "g1", qty: 1 },
  ]);
  no(JSON.stringify(p).includes("price"), "no price on the wire");
});

test("basketPayload: the assignment always goes; one flavour fills it", () => {
  const one = basketPayload(basket({}, [letters({ message: "hi<3", flavors: ["l1"] })]), MENU);
  eq(one.letters, [{ characters: ["H", "I", "<3"], flavors: ["l1"], assign: ["l1", "l1", "l1"], sets: 1 }]);
  const two = basketPayload(
    basket({}, [letters({ message: "HI", flavors: ["l1", "l2"], assign: ["l2", "l1"] })]),
    MENU
  );
  eq(two.letters[0].assign, ["l2", "l1"]);
});

test("EVERY LETTER NEEDS A FLAVOUR (Mark, 2026-09-24): with two flavours, each is chosen", () => {
  const req = (assign: (string | null)[]) =>
    letters({ message: "HAPPY 40TH!", flavors: ["l1", "l2"], assign });
  eq(cats(basket({}, [req([])])), ["letter"], "none chosen");
  const nine = ["l1", "l2", "l1", "l2", "l1", "l2", "l1", "l2", "l1", null];
  const msg = basketProblems(basket({}, [req(nine)]), MENU, MINS).map((p) => p.message);
  eq(msg, ["Choose a flavor for every letter of “HAPPY 40TH!” — 1 still to go."]);
  eq(cats(basket({}, [req(["l1", "l2", "l1", "l2", "l1", "l2", "l1", "l2", "l1", "l2"])])), []);
  eq(cats(basket({}, [letters({ message: "HAPPY 40TH!", flavors: ["l1"] })])), [], "one flavour needs no choosing");
});

test("unassignedLetters: counts what is left, and a lone flavour leaves nothing", () => {
  const ids = new Set(["l1", "l2"]);
  eq(unassignedLetters(letters({ message: "ABC", flavors: ["l1", "l2"], assign: ["l1"] }), ids), 2);
  eq(unassignedLetters(letters({ message: "ABC", flavors: ["l1"] }), ids), 0);
  eq(unassignedLetters(letters({ message: "ABC" }), ids), 3, "no flavour at all");
});

test("basketPayload: a request with no letters or no flavour is left off", () => {
  const p = basketPayload(
    basket({}, [letters({ message: "", flavors: ["l1"] }), letters({ message: "HI" }), letters({ message: "OK", flavors: ["r1"] })]),
    MENU
  );
  eq(p.letters, [], "a regular donut is not a letter flavour");
});

test("readMenu: numeric strings become numbers; unknown categories drop", () => {
  const m = readMenu({
    items: [
      { id: "a", name: "A", category: "regular", price: "3.45", description: "" },
      { id: "b", name: "B", category: "scrap", price: 1 },
    ],
    rules: { minimums: { regular: "24" }, tax_rate: "0.0975", delivery_estimate: true },
  });
  eq(m.items, [{ id: "a", name: "A", category: "regular", price: 3.45, quoted: false, description: null }]);
  eq([m.rules.minimums.regular, m.rules.minimums.mini, m.rules.tax_rate, m.rules.delivery_estimate], [24, 0, 0.0975, true]);
  eq(readMenu(null).items, []);
});

test("EXTRAS (134): no minimum, last in the summary, unpriced ones flagged quoted", () => {
  eq(cats(basket({ x1: 1 })), [], "an extras-only order is fine");
  eq(cats(basket({ r1: 12, x1: 1 })), ["regular"], "an extra does not help the donut minimum");
  const lines = basketLines(basket({ x1: 2, x2: 1, r1: 24 }), MENU);
  eq(lines.map((l) => [l.label, l.qty, l.total, l.quoted ?? false]), [
    ["Angry Samoa", 24, 130.8, false],
    ["Catering Platter", 2, 0, true],
    ["Ice Cream Container - 3 Gallons", 1, 9, false],
  ]);
  eq(basketPayload(basket({ x1: 2 }), MENU).lines, [{ item_id: "x1", qty: 2 }]);
});

test("readMenu: an unpriced EXTRA stays as quoted; an unpriced donut is dropped", () => {
  const m = readMenu({
    items: [
      { id: "p", name: "Catering Platter", category: "extra", price: null },
      { id: "d", name: "Mystery Donut", category: "regular", price: null },
    ],
  });
  eq(m.items.map((i) => [i.id, i.price, i.quoted]), [["p", 0, true]]);
});

test("todayIn: the org's day, not the host's", () => {
  // 02:00 UTC on the 25th is still the 24th in Los Angeles.
  eq(todayIn("America/Los_Angeles", new Date("2026-09-25T02:00:00Z")), "2026-09-24");
  eq(todayIn("Not/A_Zone", new Date("2026-09-25T02:00:00Z")), "2026-09-25");
});
