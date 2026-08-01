// lib/columnOrder — the pure half of drag-to-move columns: how a stored order
// is applied to the declared columns, and how a drop rewrites the store.
//
// The cases to trust are the reconciliation ones: pinned and control columns
// holding their slots, a stored key whose column is gone, and a column ADDED
// after the user dragged — the failure mode of storing an order is a new
// column being shoved to the end for anyone who ever dragged, so that case is
// pinned in the direction of "it appears where the code declared it".

import { applyColumnOrder, movedColumnOrder } from "../../src/lib/columnOrder";
import { eq, test } from "./harness";

type Col = { key: string; label: string; pinned?: boolean };

const col = (key: string, opts: Partial<Col> = {}): Col => ({
  key,
  label: opts.label ?? key.toUpperCase(),
  pinned: opts.pinned,
});
const keys = (cols: Col[]) => cols.map((c) => c.key);

// --- applyColumnOrder -------------------------------------------------------

test("no stored order → declared order, untouched", () => {
  const cols = [col("a"), col("b"), col("c")];
  eq(applyColumnOrder(cols, []), cols, "same array back");
});

test("stored order permutes the movable columns", () => {
  const cols = [col("a"), col("b"), col("c")];
  eq(keys(applyColumnOrder(cols, ["c", "a", "b"])), ["c", "a", "b"]);
});

test("a pinned column holds its declared slot while others move around it", () => {
  const cols = [col("name", { pinned: true }), col("a"), col("b"), col("c")];
  eq(keys(applyColumnOrder(cols, ["c", "a", "b"])), ["name", "c", "a", "b"]);
});

test("a pinned column in the middle stays in the middle", () => {
  const cols = [col("a"), col("name", { pinned: true }), col("b")];
  eq(keys(applyColumnOrder(cols, ["b", "a"])), ["b", "name", "a"]);
});

test("a control column (empty label) holds its slot", () => {
  const cols = [col("select", { label: "" }), col("a"), col("b")];
  eq(keys(applyColumnOrder(cols, ["b", "a"])), ["select", "b", "a"]);
});

test("a stored key whose column is gone drops out", () => {
  const cols = [col("a"), col("b")];
  eq(keys(applyColumnOrder(cols, ["gone", "b", "a"])), ["b", "a"]);
});

test("a column added since the drag appears at its declared position", () => {
  // Declared a, b, NEW, c — the user's stored order predates NEW. It should
  // surface third among the movable set (its declared index), not last.
  const cols = [col("a"), col("b"), col("new"), col("c")];
  eq(keys(applyColumnOrder(cols, ["c", "a", "b"])), ["c", "a", "new", "b"]);
});

test("a declared-first new column surfaces first", () => {
  const cols = [col("new"), col("a"), col("b")];
  eq(keys(applyColumnOrder(cols, ["b", "a"])), ["new", "b", "a"]);
});

// --- movedColumnOrder -------------------------------------------------------

test("move before an earlier column", () => {
  eq(movedColumnOrder(["a", "b", "c"], "c", { before: "a" }), ["c", "a", "b"]);
});

test("move before a later column lands ahead of it", () => {
  eq(movedColumnOrder(["a", "b", "c"], "a", { before: "c" }), ["b", "a", "c"]);
});

test("move after the last column", () => {
  eq(movedColumnOrder(["a", "b", "c"], "a", { after: "c" }), ["b", "c", "a"]);
});

test("an unknown anchor is a no-op", () => {
  eq(movedColumnOrder(["a", "b", "c"], "a", { before: "z" }), ["a", "b", "c"]);
});

test("dropping after the last VISIBLE column stays ahead of trailing hidden ones", () => {
  // "z" is hidden: the drop resolved to {after: "b"} (the last visible), so
  // the dragged column lands between b and z rather than after the hidden z.
  eq(movedColumnOrder(["a", "b", "z"], "a", { after: "b" }), ["b", "a", "z"]);
});
