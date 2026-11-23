// matchesGuideFilter's "skipped" set — favorites still untouched — is also what
// the tablet's Next favorite button walks (GuideLine's data-next-favorite,
// OrderGuide's count). Until 2026-11-23 that button walked EVERY empty box, so
// under All it stopped on non-favorite sources. Pinned so the button and the
// Skipped filter can't drift apart again.

import { matchesGuideFilter, type GuideRow } from "../../src/lib/orderGuide";
import { eq, test } from "./harness";

const MONDAY = 1;

function row(fav: boolean): GuideRow {
  return {
    is_favorite: fav,
    should_order: fav,
    vendor_order_days: [MONDAY],
    item_order_days: [MONDAY],
  } as unknown as GuideRow;
}

const skipped = (r: GuideRow, qty: number | null, ignoreDays = false) =>
  matchesGuideFilter(r, { on_hand: null, qty_to_order: qty }, "skipped", MONDAY, ignoreDays);

test("next favorite: an untouched favorite is a target", () => {
  eq(skipped(row(true), null), true, "favorite, empty box");
});

test("next favorite: an untouched NON-favorite is not, though All shows it", () => {
  eq(matchesGuideFilter(row(false), undefined, "all", MONDAY, false), true, "visible under All");
  eq(skipped(row(false), null), false, "not a next-favorite target");
});

test("next favorite: a quantity or an explicit zero takes a favorite off the walk", () => {
  eq(skipped(row(true), 3), false, "entered");
  eq(skipped(row(true), 0), false, "zeroed");
});

test("next favorite: with the day gates lifted it rests on is_favorite", () => {
  const r = { ...row(true), should_order: false } as GuideRow;
  eq(skipped(r, null, true), true, "favorite on another day's gates");
  eq(skipped(r, null, false), false, "not today's work when gated");
});
