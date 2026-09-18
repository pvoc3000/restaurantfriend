// paintStroke — the weekday picker's swipe gesture as arithmetic.

import { paintStroke, spanDays, withDay } from "../../src/lib/dayPaint";
import { eq, test } from "./harness";

test("withDay keeps the array sorted and is a no-op when nothing changes", () => {
  const base = [1, 3];
  eq(withDay(base, 2, true), [1, 2, 3]);
  eq(withDay(base, 3, false), [1]);
  eq(withDay(base, 3, true), base, "same object when already on");
  eq(withDay(base, 2, false), base, "same object when already off");
});

test("a stroke from an OFF day switches everything it crosses ON", () => {
  eq(paintStroke([1, 5], [2, 3, 4, 5]), [1, 2, 3, 4, 5]);
});

test("a stroke from an ON day switches everything it crosses OFF, including itself", () => {
  eq(paintStroke([1, 2, 3, 6], [3, 4, 5, 6]), [1, 2]);
});

test("the FIRST day decides; crossing back over a day changes nothing twice", () => {
  eq(paintStroke([2], [1, 2, 1]), [1, 2]);
  eq(paintStroke([2], [2, 1, 2]), []);
});

test("a single press is a plain toggle and days not crossed are untouched", () => {
  eq(paintStroke([1, 7], [4]), [1, 4, 7]);
  eq(paintStroke([1, 4, 7], [4]), [1, 7]);
  eq(paintStroke([1, 7], []), [1, 7]);
});

test("spanDays fills the days a pointer skipped, in either direction, excluding where it was", () => {
  eq(spanDays(2, 5), [3, 4, 5]);
  eq(spanDays(5, 2), [4, 3, 2]);
  eq(spanDays(3, 3), []);
  eq(spanDays(1, 2), [2]);
});
