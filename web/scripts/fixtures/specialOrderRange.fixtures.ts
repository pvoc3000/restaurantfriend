// `lib/specialOrderRange` — the special order list's date window.
//
// The rule these all serve: the SERVER sizes its query from the same token the
// picker draws from. The page.tsx comment this replaced warned that the two
// "must match — a window that disagrees with the filter shows an empty list and
// blames the filter for it", and kept them in step by hand.

import { test, eq, ok } from "./harness";
import {
  DEFAULT_ORDER_RANGE,
  ORDER_RANGE_PRESETS,
  inOrderRange,
  isOrderRangeToken,
  orderRangeBounds,
  orderRangeToken,
} from "../../src/lib/specialOrderRange";

const TODAY = "2026-09-20";

test("upcoming is today forward, and it is the resting window", () => {
  eq(DEFAULT_ORDER_RANGE, "upcoming");
  const b = orderRangeBounds("upcoming", TODAY);
  eq(b?.from, TODAY, "today is in it — an order for this afternoon is upcoming");
  eq(b?.to, "2999-12-31");
});

test("past ends YESTERDAY, so the two never overlap", () => {
  // Today belongs to exactly one of them, or the same order would answer to
  // both windows.
  const past = orderRangeBounds("past", TODAY);
  eq(past?.from, "1900-01-01");
  eq(past?.to, "2026-09-19");
  eq(inOrderRange(TODAY, past), false);
  eq(inOrderRange(TODAY, orderRangeBounds("upcoming", TODAY)), true);
});

test("all time is NULL, which is what puts its name on the control's face", () => {
  eq(orderRangeBounds("all", TODAY), null);
  // `matchingPreset` matches null to null, so the face reads "All Time" rather
  // than the placeholder.
  eq(orderRangeToken(null, TODAY), "all");
});

test("a backwards pair is the same window, read from its far end", () => {
  eq(orderRangeBounds("2024-03-31..2024-01-01", TODAY), { from: "2024-01-01", to: "2024-03-31" });
});

test("a custom pair round-trips through the token", () => {
  const picked = { from: "2024-01-01", to: "2024-03-31" };
  const token = orderRangeToken(picked, TODAY);
  eq(token, "2024-01-01..2024-03-31");
  eq(orderRangeBounds(token, TODAY), picked);
  ok(isOrderRangeToken(token));
});

test("…but a pair that IS a preset is stored by its KEY", () => {
  // So "Next Month" is still next month tomorrow, instead of freezing into the
  // dates it happened to mean today.
  eq(orderRangeToken({ from: "2026-09-21", to: "2026-09-21" }, TODAY), "tomorrow");
  eq(orderRangeToken({ from: TODAY, to: "2999-12-31" }, TODAY), "upcoming");
});

test("an unreadable token lands where the plain list does", () => {
  // Not "everything": a typo in the address bar must not fetch twelve years.
  eq(orderRangeBounds("rubbish", TODAY), orderRangeBounds(DEFAULT_ORDER_RANGE, TODAY));
  eq(orderRangeBounds("", TODAY), orderRangeBounds(DEFAULT_ORDER_RANGE, TODAY));
  eq(orderRangeBounds(undefined, TODAY), orderRangeBounds(DEFAULT_ORDER_RANGE, TODAY));
  eq(orderRangeBounds("2024-13-45..2024-99-99", TODAY), orderRangeBounds(DEFAULT_ORDER_RANGE, TODAY));
});

test("isOrderRangeToken takes the presets and a pair, and nothing else", () => {
  for (const p of ORDER_RANGE_PRESETS) ok(isOrderRangeToken(p.key), p.key);
  ok(isOrderRangeToken("2026-01-01..2026-01-31"));
  eq(isOrderRangeToken("2026-01-01"), false, "one date is not a range");
  eq(isOrderRangeToken("attention"), false, "it moved to Status");
  eq(isOrderRangeToken("2024-13-45..2024-99-99"), false, "digit-shaped is not a date");
  eq(isOrderRangeToken("unpaid"), false, "so did this one");
});

test("a record with NO event date is out of every window and in all time", () => {
  // Every template and every standing order. They are reached through the Kind
  // menu, and All Time shows them — the rule the old menu already had.
  eq(inOrderRange(null, orderRangeBounds("upcoming", TODAY)), false);
  eq(inOrderRange(null, orderRangeBounds("past", TODAY)), false);
  eq(inOrderRange(null, null), true);
});

test("the window's ends are INCLUSIVE, both of them", () => {
  const b = { from: "2026-01-01", to: "2026-01-31" };
  eq(inOrderRange("2026-01-01", b), true);
  eq(inOrderRange("2026-01-31", b), true);
  eq(inOrderRange("2025-12-31", b), false);
  eq(inOrderRange("2026-02-01", b), false);
});
