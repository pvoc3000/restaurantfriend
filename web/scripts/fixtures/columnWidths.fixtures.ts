// The column resize rule — `lib/columnWidths` `resizeWeights` (Mark,
// 2026-09-05: the column you drag moves, ONE other column pays, nothing else
// jumps). Every clause of the rule's comment is a case here.

import { test, eq } from "./harness";
import { resizeWeights, MIN_COLUMN_WIDTH } from "../../src/lib/columnWidths";

const order = ["a", "b", "c", "d"];
const w = { a: 100, b: 200, c: 300, d: 400 };
const sum = (x: Record<string, number>) => Object.values(x).reduce((n, v) => n + v, 0);

test("growing a column takes exactly that much from the LAST column", () => {
  eq(resizeWeights(w, order, "b", 50), { d: 350, b: 250 });
  eq(sum({ ...w, ...resizeWeights(w, order, "b", 50) }), sum(w), "sum preserved");
});

test("shrinking a column hands all the slack to the last column", () => {
  eq(resizeWeights(w, order, "a", -30), { a: 70, d: 430 });
});

test("dragging the last column borrows from its left neighbour", () => {
  eq(resizeWeights(w, order, "d", 40), { c: 260, d: 440 });
  eq(resizeWeights(w, order, "d", -40), { d: 360, c: 340 });
});

test("a payer at its floor passes the remainder leftwards", () => {
  // d can give 400-48 = 352; the other 48 must come from c.
  eq(resizeWeights(w, order, "a", 400), { d: MIN_COLUMN_WIDTH, c: 252, a: 500 });
});

test("the drag is capped at what can be paid for", () => {
  // b, c, d can give (200-48)+(300-48)+(400-48) = 756 in total.
  eq(resizeWeights(w, order, "a", 5000), { d: 48, c: 48, b: 48, a: 856 });
});

test("the dragged column has a floor and nothing moves past it", () => {
  eq(resizeWeights(w, order, "a", -80), { a: MIN_COLUMN_WIDTH, d: 452 }, "clamped to the floor");
  eq(resizeWeights({ ...w, a: 48 }, order, "a", -10), null, "already at the floor");
});

test("nothing to do returns null, never an empty patch", () => {
  eq(resizeWeights(w, order, "a", 0), null);
  eq(resizeWeights(w, order, "zzz", 10), null, "not a visible column");
  eq(resizeWeights({ a: 48, b: 48 }, ["a", "b"], "a", 10), null, "nobody can pay");
  eq(resizeWeights({ a: 100 }, ["a"], "a", 10), null, "no other column");
});

test("a hidden column never pays — only the visible order is consulted", () => {
  // `c` is hidden: the payer is `d` (last visible), then `b`, and `c` is
  // neither read nor written.
  eq(resizeWeights(w, ["a", "b", "d"], "a", 10), { d: 390, a: 110 });
});

test("a per-column floor is honoured on the payer and on the dragged column", () => {
  const floor = (k: string) => (k === "d" ? 300 : MIN_COLUMN_WIDTH);
  // d has 400 and a floor of 300, so it can give only 100; c pays the rest.
  eq(resizeWeights(w, order, "a", 150, floor), { d: 300, c: 250, a: 250 });
  // and dragging d itself cannot take it under 300.
  eq(resizeWeights(w, order, "d", -200, floor), { d: 300, c: 400 });
});
