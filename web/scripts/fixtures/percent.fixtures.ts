// `lib/percent` — a rate stored as a fraction and typed as a percentage.
//
// The bug it fixes was silent in the worst way: Mark typed 20 into the discount
// rate meaning 20%, and the cell stored 20 — a 2000% discount. Both directions
// are tested here, and so is the float rounding, which is the part that would
// otherwise put 7.000000000000001 in the edit box.

import { test, eq } from "./harness";
import { PERCENT_SCALE, percentLabel, toFraction, toPercent } from "../../src/lib/percent";

test("a fraction reads as the number on the sign in the window", () => {
  eq(toPercent(0.0975), 9.75);
  eq(toPercent(0.2), 20);
  eq(toPercent(0.1), 10);
  eq(toPercent(0), 0);
  eq(toPercent(0.08375), 8.375, "numeric(6,5) holds three decimals of a percent");
});

test("…and the float noise is rounded away, not shown", () => {
  // 0.07 * 100 is 7.000000000000001. Unrounded, that is what lands in the box
  // the moment you click a 7% cell.
  eq(toPercent(0.07), 7);
  eq(toPercent(0.29), 29);
  eq(toPercent(0.57), 57);
});

test("what you type is a percentage, and it stores a fraction", () => {
  // Mark's own case, both ways round.
  eq(toFraction(20), 0.2);
  eq(toFraction(9.75), 0.0975);
  eq(toFraction(100), 1);
  eq(toFraction(0), 0);
});

test("IT DOES NOT GUESS at what you meant", () => {
  // A rule like "over 1 means a percentage" would read 20 and 0.2 as the same
  // thing, which works until somebody means half a per cent. 0.2 typed in a
  // percentage box is two tenths of one per cent, and the cell then says so.
  eq(toFraction(0.2), 0.002);
  eq(percentLabel(toPercent(toFraction(0.2))), "0.2%");
});

test("a round trip changes nothing", () => {
  for (const fraction of [0, 0.0725, 0.0975, 0.1, 0.2, 0.08375, 1]) {
    eq(toFraction(toPercent(fraction)), fraction, `${fraction} survives`);
  }
});

test("the label has no trailing zeros to read past", () => {
  eq(percentLabel(9.75), "9.75%");
  eq(percentLabel(20), "20%");
  eq(percentLabel(0), "0%");
  eq(percentLabel(8.375), "8.375%");
});

test("…and it takes the SHOWN value, so it pairs with the scale", () => {
  // `InlineValue` applies `format` AFTER `scale`. Passing one without the other
  // is a cell in two units, which is the bug this module exists to end.
  eq(percentLabel(PERCENT_SCALE.toShown(0.0975)), "9.75%");
  eq(PERCENT_SCALE.toStored(20), 0.2);
});

test("a numeric STRING labels the same as the number", () => {
  // PostgREST hands `numeric` back as a string often enough that the callers'
  // `as number | null` casts are a lie at runtime.
  eq(percentLabel("9.75"), "9.75%");
  eq(percentLabel("20"), "20%");
});
