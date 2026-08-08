// The recipe sheet's scale columns — production brief decision 3.
//
// FileMaker STORED an amount per column, four hand-maintained numbers per
// line. This app stores ONE and computes the rest, which is only safe because
// 96.4% of FMP's stored columns turn out to be a strict multiple of the base.
// These cases pin the arithmetic that replaces them, including the two things
// that make the data look non-proportional when it isn't: a blank multiplier in
// the base slot meaning ×1, and the unit changing as the number grows.

import { scaleColumns, scaledAmount, percentOfBatch } from "../../src/lib/production";
import { convert } from "../../src/lib/units";
import { test, eq } from "./harness";

/* -- reading the column definitions --------------------------------------- */

test("a blank multiplier in the base slot means ×1", () => {
  // FMP wrote `|2|4` — slot 0 empty. All 493 versions put the base there, and
  // a reader that requires a number discards the majority of lines.
  const columns = scaleColumns(["1 Pan", "2 Pans", "4 Pans"], [NaN as unknown as number, 2, 4]);
  eq(columns.map((c) => c.multiplier), [1, 2, 4]);
});

test("a column with no label is dropped, not rendered blank", () => {
  // FileMaker pads every repeating field to 8; the trailing slots are empty.
  const columns = scaleColumns(["x1", "x2", "", "", ""], [1, 2, 0, 0, 0]);
  eq(columns.length, 2);
  eq(columns.map((c) => c.label), ["x1", "x2"]);
});

test("the % column is flagged, never treated as a scale", () => {
  const columns = scaleColumns(["2 QT", "6 QT", "%"], [1, 3, 1]);
  eq(columns.map((c) => c.isPercent), [false, false, true]);
  // A % column must render nothing in the amount cell — it is each line's
  // share of the batch, computed separately.
  eq(scaledAmount(170, "g", columns[2], 1), "");
});

/* -- the arithmetic -------------------------------------------------------- */

test("Strawberry Glaze's real columns scale as FileMaker stored them", () => {
  // The actual v10 row: 170 g of hot water across ×1/×3/×5/×10.
  const columns = scaleColumns(["2 QT", "6 QT", "10 QT", "20 QT"], [1, 3, 5, 10]);
  eq(scaledAmount(170, "g", columns[0], 1), "170 g");
  eq(scaledAmount(170, "g", columns[1], 1), "510 g");
  eq(scaledAmount(170, "g", columns[2], 1), "850 g");
  // THE CASE THAT MAKES A NAIVE CHECK REPORT 65% FAILURE: at ×10 this is 1700 g,
  // and FileMaker stored it as "1.7 kg". Same quantity, different unit.
  eq(scaledAmount(170, "g", columns[3], 1), "1.7 kg");
});

test("grams become kilograms at 1000, and millilitres litres", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(scaledAmount(600, "g", x2, 1), "1.2 kg");
  eq(scaledAmount(499, "g", x2, 1), "998 g", "under 1000 stays in grams");
  eq(scaledAmount(600, "ml", x2, 1), "1.2 l");
});

test("a unit with no larger form keeps its own", () => {
  const x4 = scaleColumns(["x1", "x4"], [1, 4])[1];
  eq(scaledAmount(3, "qt", x4, 1), "12 qt");
  eq(scaledAmount(2, "ea", x4, 1), "8 ea");
});

test("a non-1 base multiplier divides before it multiplies", () => {
  // "1/2 Pan | 1 Pan | 2 Pans" with multipliers 1, 1.75, 3.5 — Strawberry
  // Glaze v18's real shape. A line reading 100 g at the base must give 175 at
  // "1 Pan", not 100 × 1.75 × something.
  const columns = scaleColumns(["1/2 Pan", "1 Pan", "2 Pans"], [1, 1.75, 3.5]);
  eq(scaledAmount(100, "g", columns[1], 1), "175 g");
  eq(scaledAmount(100, "g", columns[2], 1), "350 g");
});

test("a base multiplier that isn't 1 still normalises correctly", () => {
  // If the base column were ×2 and a line read 200 g there, ×6 is 600 g —
  // three times as much, not six.
  const columns = scaleColumns(["x2", "x6"], [2, 6]);
  eq(scaledAmount(200, "g", columns[1], 2), "600 g");
});

test("a line with no quantity renders nothing rather than a zero", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(scaledAmount(null, "g", x2, 1), "");
});

/* -- precision ------------------------------------------------------------- */

test("precision falls as the quantity grows, the way a scale reads", () => {
  // Found by rendering a real recipe: 17.5 g of lemon juice at ×1.75 is
  // 30.625 g, which no kitchen scale can show and nobody would try to hit.
  const columns = scaleColumns(["1/2 Pan", "1 Pan"], [1, 1.75]);
  eq(scaledAmount(17.5, "g", columns[1], 1), "30.6 g", "10–100 keeps one place");
  eq(scaledAmount(2.5, "g", columns[1], 1), "4.38 g", "1–10 keeps two");
  eq(scaledAmount(100, "g", columns[1], 1), "175 g", "over 100 is whole grams");
  // Only below a gram is three places worth printing — a pinch of something
  // potent is the one case where the third decimal is real.
  eq(scaledAmount(0.4, "g", columns[1], 1), "0.7 g");
  eq(scaledAmount(0.002, "g", columns[1], 1), "0.004 g");
});

test("a whole number never grows a decimal point", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(scaledAmount(50, "g", x2, 1), "100 g");
  eq(scaledAmount(1.5, "kg", x2, 1), "3 kg");
});

/* -- the % column ---------------------------------------------------------- */

test("percent is each line's share of the batch by weight", () => {
  // Measured on the real data: FMP's % is a share of the batch TOTAL, not of
  // the flour, despite "baker's percentage" being the usual name.
  const lines = [
    { qty: 500, unit: "g" },
    { qty: 300, unit: "g" },
    { qty: 200, unit: "g" },
  ];
  const pct = percentOfBatch(lines, convert);
  eq(pct.map((p) => Math.round(p!)), [50, 30, 20]);
});

test("percent normalises units before comparing them", () => {
  const pct = percentOfBatch([{ qty: 1, unit: "kg" }, { qty: 1000, unit: "g" }], convert);
  eq(pct.map((p) => Math.round(p!)), [50, 50]);
});

test("a line that cannot be weighed gets NO percentage and is out of the total", () => {
  // Counting it as zero would silently inflate every other line's share.
  const pct = percentOfBatch(
    [{ qty: 500, unit: "g" }, { qty: 500, unit: "g" }, { qty: 2, unit: "ea" }],
    convert
  );
  eq(pct.map((p) => (p === null ? null : Math.round(p))), [50, 50, null]);
});

test("an all-unweighable batch reports no percentages rather than dividing by zero", () => {
  const pct = percentOfBatch([{ qty: 2, unit: "ea" }, { qty: 3, unit: "ea" }], convert);
  eq(pct, [null, null]);
});
