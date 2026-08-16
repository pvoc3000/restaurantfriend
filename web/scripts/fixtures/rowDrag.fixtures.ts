// lib/rowDrag — `renumber`, the persistence half of dragging a row up or down.
//
// This is the first multi-row order write in the app, and it is the half with no
// precedent: every other sort column here is typed one row at a time through an
// `InlineValue`. The two rules worth pinning are the ones a "simplification"
// would undo.
//
// THE WHOLE LIST IS RENUMBERED, not just the row that moved. Every reader treats
// a null sort as LAST, and the migrated data is null everywhere, so writing one
// row's sort puts that row FIRST rather than where it was dropped — the exact
// trap `ItemComponents` documents for its insert path. The all-null case below
// is the one that goes red if someone "optimises" this to a single write.
//
// ONLY THE ROWS THAT MOVE ARE WRITTEN, so a no-op drop writes nothing and a drag
// in a numbered list writes the affected span rather than the table.
//
// `moveInOrder` itself is `movedColumnOrder` under an alias and is already
// pinned by columnOrder.fixtures; the two cases here only assert that the
// re-export is wired to the thing it claims to be.

import { moveInOrder, renumber } from "../../src/lib/rowDrag";
import { eq, test } from "./harness";

const current = (entries: [string, number | null][]) => new Map(entries);

// --- renumber ---------------------------------------------------------------

test("all-null (the migrated state) → every row is written, 1..n", () => {
  eq(
    renumber(["b", "a", "c"], current([["a", null], ["b", null], ["c", null]])),
    [
      { id: "b", sort: 1 },
      { id: "a", sort: 2 },
      { id: "c", sort: 3 },
    ],
    "a single write would put one row first, not where it was dropped"
  );
});

test("an already-numbered list, one row moved → only the affected span", () => {
  // 1,2,3,4 with the last row dragged to the front: d takes 1, and a/b/c each
  // shift by one. Nothing else exists to write.
  eq(
    renumber(
      ["d", "a", "b", "c"],
      current([["a", 1], ["b", 2], ["c", 3], ["d", 4]])
    ),
    [
      { id: "d", sort: 1 },
      { id: "a", sort: 2 },
      { id: "b", sort: 3 },
      { id: "c", sort: 4 },
    ]
  );
});

test("a move within a numbered list leaves the rows above it alone", () => {
  // 1..5, with the fourth row dropped just after the second: a and b keep their
  // numbers and are not written.
  eq(
    renumber(
      ["a", "b", "d", "c", "e"],
      current([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]])
    ),
    [
      { id: "d", sort: 3 },
      { id: "c", sort: 4 },
    ],
    "e is already 5 and must not be rewritten either"
  );
});

test("dropped back where it started → nothing is written at all", () => {
  eq(
    renumber(["a", "b", "c"], current([["a", 1], ["b", 2], ["c", 3]])),
    [],
    "a no-op update is a round trip and an updated_at bump for a change nobody made"
  );
});

test("a row the map has never heard of is still numbered", () => {
  // A row added since the order was read: `current.get` is undefined, which is
  // not the sort it needs, so it is written like any other.
  eq(renumber(["a", "b"], current([["a", 1]])), [{ id: "b", sort: 2 }]);
});

test("a stored sort that is not 1-based is renumbered to 1..n", () => {
  // FileMaker's tens, or a hand-typed 5/10/15: the order is right and the
  // numbers are not, and a drag is what normalises them.
  eq(
    renumber(["a", "b", "c"], current([["a", 10], ["b", 20], ["c", 30]])),
    [
      { id: "a", sort: 1 },
      { id: "b", sort: 2 },
      { id: "c", sort: 3 },
    ]
  );
});

test("an empty list writes nothing", () => {
  eq(renumber([], current([])), []);
});

// --- moveInOrder (the re-export is wired to columnOrder's splice) ------------

test("moveInOrder puts the dragged id before its anchor", () => {
  eq(moveInOrder(["a", "b", "c"], "c", { before: "a" }), ["c", "a", "b"]);
});

test("moveInOrder puts the dragged id after its anchor, and an unknown anchor is a no-op", () => {
  eq(moveInOrder(["a", "b", "c"], "a", { after: "c" }), ["b", "c", "a"]);
  eq(moveInOrder(["a", "b", "c"], "a", { before: "zz" }), ["a", "b", "c"]);
});
