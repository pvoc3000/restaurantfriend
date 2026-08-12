// Deleting an element — which of the seven references block it, and which
// merely go with it.
//
// Each case was checked by breaking the code it pins.

import {
  EMPTY_ELEMENT_USAGE,
  canDeleteElement,
  cascadeLosses,
  deleteBlockers,
  describeDeleteError,
  hasCascadeLosses,
  listNames,
  type ElementUsage,
} from "../../src/lib/productionElements";
import { test, eq, ok } from "./harness";

const usage = (over: Partial<ElementUsage> = {}): ElementUsage => ({
  ...EMPTY_ELEMENT_USAGE,
  ...over,
});

// ---------------------------------------------------------------------------
// Nothing in the way
// ---------------------------------------------------------------------------

test("an unused element deletes and loses nothing", () => {
  const u = usage();
  eq(deleteBlockers(u).length, 0, "blockers");
  ok(canDeleteElement(u), "deletable");
  ok(!hasCascadeLosses(u), "no cascade losses");
});

// ---------------------------------------------------------------------------
// The five references that REFUSE
// ---------------------------------------------------------------------------

test("a recipe describing it blocks the delete", () => {
  const u = usage({ recipes: ["Raised Donut"] });
  eq(deleteBlockers(u).map((b) => b.key), ["recipes"], "blockers");
  ok(!canDeleteElement(u), "blocked");
});

test("being an ingredient in someone else's recipe blocks it", () => {
  const u = usage({ ingredientIn: ["Chocolate Glaze", "Vanilla Glaze"] });
  eq(deleteBlockers(u)[0].count, 2, "count");
  ok(!canDeleteElement(u), "blocked");
});

test("an item made from it blocks it", () => {
  ok(!canDeleteElement(usage({ componentOf: ["Angry Samoa"] })), "blocked");
});

test("being an item's dough blocks it", () => {
  ok(!canDeleteElement(usage({ doughFor: ["Bananaversary"] })), "blocked");
});

test("a logged batch blocks it — that is production history", () => {
  const u = usage({ batches: 26 });
  eq(deleteBlockers(u).map((b) => b.key), ["batches"], "blockers");
  eq(deleteBlockers(u)[0].count, 26, "count");
  ok(!canDeleteElement(u), "blocked");
});

test("blockers are reported in the order a person would want to hear them", () => {
  const u = usage({
    batches: 3,
    doughFor: ["Bananaversary"],
    componentOf: ["Angry Samoa"],
    ingredientIn: ["Chocolate Glaze"],
    recipes: ["Raised Donut"],
  });
  // What it IS, then what uses it, then what it made — NOT the order the
  // object literal happens to be written in.
  eq(
    deleteBlockers(u).map((b) => b.key),
    ["recipes", "ingredientIn", "componentOf", "doughFor", "batches"],
    "order"
  );
});

test("a blocker with no rows is not reported at all", () => {
  // The empty arrays must not become blockers with a count of zero, which
  // would render as "0 recipes describe it".
  eq(deleteBlockers(usage({ recipes: [], batches: 0 })).length, 0, "blockers");
});

// ---------------------------------------------------------------------------
// The two that CASCADE
// ---------------------------------------------------------------------------

test("per-shop settings and schedule rows go with it, and do not block", () => {
  const u = usage({ locations: 2, scheduledDays: 6 });
  eq(deleteBlockers(u).length, 0, "blockers");
  ok(canDeleteElement(u), "still deletable");
  ok(hasCascadeLosses(u), "has losses");
  eq(cascadeLosses(u), { locations: 2, scheduledDays: 6 }, "losses");
});

test("a cascade loss on its own is enough to warn about", () => {
  ok(hasCascadeLosses(usage({ locations: 1 })), "locations alone");
  ok(hasCascadeLosses(usage({ scheduledDays: 1 })), "schedule alone");
});

// ---------------------------------------------------------------------------
// An unread count is not a zero
// ---------------------------------------------------------------------------

test("a count that could not be read refuses the delete", () => {
  // The conservative half, and the whole reason `unreadable` exists: read as
  // zero this would offer a delete the database then refuses.
  const u = usage({ unreadable: ["the batch log"] });
  eq(deleteBlockers(u).length, 0, "no blockers known");
  ok(!canDeleteElement(u), "still refused");
});

// ---------------------------------------------------------------------------
// Reading the names out
// ---------------------------------------------------------------------------

test("names are read out as a sentence", () => {
  eq(listNames([]), "", "none");
  eq(listNames(["Glaze A"]), "Glaze A", "one");
  eq(listNames(["Glaze A", "Glaze B"]), "Glaze A and Glaze B", "two");
  eq(listNames(["A", "B", "C"]), "A, B and C", "three");
});

test("a long list is capped and says how many it kept back", () => {
  eq(listNames(["A", "B", "C", "D", "E", "F"]), "A, B, C and D and 2 more", "capped");
  eq(listNames(["A", "B", "C"], 2), "A and B and 1 more", "custom cap");
});

// ---------------------------------------------------------------------------
// The database's own refusal, in words
// ---------------------------------------------------------------------------

test("an FK violation is translated; anything else is passed through", () => {
  const fk = describeDeleteError({
    code: "23503",
    message: 'update or delete on table "production_elements" violates foreign key constraint',
  });
  ok(!fk.includes("foreign key constraint"), "raw text is gone");
  ok(fk.includes("Deactivating"), "says what to do instead");

  eq(
    describeDeleteError({ code: "42501", message: "permission denied" }),
    "permission denied",
    "other errors are passed through"
  );
  eq(
    describeDeleteError({ message: "network error" }),
    "network error",
    "an error with no code is passed through"
  );
});
