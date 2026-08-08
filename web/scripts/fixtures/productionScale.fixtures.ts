// The recipe sheet's scale columns — production brief decision 3, and migration
// 041's escape hatch from it.
//
// FileMaker STORED an amount per column, four hand-maintained numbers per line.
// This app stores ONE and computes the rest, which is only safe because 96.4% of
// FMP's stored columns turn out to be a strict multiple of the base. These cases
// pin the arithmetic that replaces them, including the two things that make the
// data look non-proportional when it isn't: a blank multiplier in the base slot
// meaning ×1, and the unit changing as the number grows.
//
// They also pin the other 3.6% — the rows FileMaker marked `AutoUpdate_bool` off
// — which 041 gives somewhere to live.

import {
  scaleColumns,
  computedCell,
  columnCell,
  formatCell,
  freezeScales,
  withSlot,
  bakersPercent,
} from "../../src/lib/production";
import { convert } from "../../src/lib/units";
import { test, eq } from "./harness";

/** The old `scaledAmount(qty, unit, column, base)`, in terms of the new pair —
 *  most of these cases are about the arithmetic, not about the cell shape. */
const amount = (
  qty: number | null,
  unit: string | null,
  column: ReturnType<typeof scaleColumns>[number],
  base: number
) => (column.isPercent ? "" : formatCell(computedCell(qty, unit, column, base)));

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
  // share, computed separately.
  eq(amount(170, "g", columns[2], 1), "");
});

/* -- the arithmetic -------------------------------------------------------- */

test("Strawberry Glaze's real columns scale as FileMaker stored them", () => {
  // The actual v10 row: 170 g of hot water across ×1/×3/×5/×10.
  const columns = scaleColumns(["2 QT", "6 QT", "10 QT", "20 QT"], [1, 3, 5, 10]);
  eq(amount(170, "g", columns[0], 1), "170 g");
  eq(amount(170, "g", columns[1], 1), "510 g");
  eq(amount(170, "g", columns[2], 1), "850 g");
  // THE CASE THAT MAKES A NAIVE CHECK REPORT 65% FAILURE: at ×10 this is 1700 g,
  // and FileMaker stored it as "1.7 kg". Same quantity, different unit.
  eq(amount(170, "g", columns[3], 1), "1.7 kg");
});

test("grams become kilograms at 1000, and millilitres litres", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(amount(600, "g", x2, 1), "1.2 kg");
  eq(amount(499, "g", x2, 1), "998 g", "under 1000 stays in grams");
  eq(amount(600, "ml", x2, 1), "1.2 l");
});

test("the promoted unit comes back as a UNIT, not baked into a string", () => {
  // The grid renders qty and unit in separate boxes, so g→kg has to move the
  // unit field too — a cell that said "1.7" beside a box still reading "g" is
  // off by a thousand.
  const x10 = scaleColumns(["x1", "x10"], [1, 10])[1];
  eq(computedCell(170, "g", x10, 1), { qty: 1.7, unit: "kg" });
});

test("a unit with no larger form keeps its own", () => {
  const x4 = scaleColumns(["x1", "x4"], [1, 4])[1];
  eq(amount(3, "qt", x4, 1), "12 qt");
  eq(amount(2, "ea", x4, 1), "8 ea");
});

test("a non-1 base multiplier divides before it multiplies", () => {
  // "1/2 Pan | 1 Pan | 2 Pans" with multipliers 1, 1.75, 3.5 — Strawberry
  // Glaze v18's real shape. A line reading 100 g at the base must give 175 at
  // "1 Pan", not 100 × 1.75 × something.
  const columns = scaleColumns(["1/2 Pan", "1 Pan", "2 Pans"], [1, 1.75, 3.5]);
  eq(amount(100, "g", columns[1], 1), "175 g");
  eq(amount(100, "g", columns[2], 1), "350 g");
});

test("a base multiplier that isn't 1 still normalises correctly", () => {
  // If the base column were ×2 and a line read 200 g there, ×6 is 600 g —
  // three times as much, not six.
  const columns = scaleColumns(["x2", "x6"], [2, 6]);
  eq(amount(200, "g", columns[1], 2), "600 g");
});

test("a line with no quantity renders nothing rather than a zero", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(amount(null, "g", x2, 1), "");
});

/* -- precision ------------------------------------------------------------- */

test("precision falls as the quantity grows, the way a scale reads", () => {
  // Found by rendering a real recipe: 17.5 g of lemon juice at ×1.75 is
  // 30.625 g, which no kitchen scale can show and nobody would try to hit.
  const columns = scaleColumns(["1/2 Pan", "1 Pan"], [1, 1.75]);
  eq(amount(17.5, "g", columns[1], 1), "30.6 g", "10–100 keeps one place");
  eq(amount(2.5, "g", columns[1], 1), "4.38 g", "1–10 keeps two");
  eq(amount(100, "g", columns[1], 1), "175 g", "over 100 is whole grams");
  // Only below a gram is three places worth printing — a pinch of something
  // potent is the one case where the third decimal is real.
  eq(amount(0.4, "g", columns[1], 1), "0.7 g");
  eq(amount(0.002, "g", columns[1], 1), "0.004 g");
});

test("a whole number never grows a decimal point", () => {
  const x2 = scaleColumns(["x1", "x2"], [1, 2])[1];
  eq(amount(50, "g", x2, 1), "100 g");
  eq(amount(1.5, "kg", x2, 1), "3 kg");
});

/* -- the AUTO switch (migration 041) --------------------------------------- */

const COLS = scaleColumns(["TEST", "x1/2", "x3/4", "x1", "%"], [1, 5, 7.5, 10, 1]);

test("column 0 is always the stored base, switch or no switch", () => {
  // The base is `qty`/`unit` and 041 keeps no second copy of it in the strip.
  // A manual row whose strip somehow held a slot 0 must not be believed.
  const line = {
    qty: 5,
    unit: "lbs",
    scaleAuto: false,
    scaleAmounts: [999, 25, 37.5, 50, 100],
    scaleUnits: ["kg", "lbs", "lbs", "lbs", "%"],
  };
  eq(columnCell(line, COLS[0], 1), { qty: 5, unit: "lbs" });
});

test("an auto row computes every column from the base", () => {
  // Mark's Raised Donut v11, line 1: 5 lbs at ×5/×7.5/×10.
  const line = { qty: 5, unit: "lbs", scaleAuto: true };
  eq(formatCell(columnCell(line, COLS[1], 1)), "25 lbs");
  eq(formatCell(columnCell(line, COLS[2], 1)), "37.5 lbs");
  eq(formatCell(columnCell(line, COLS[3], 1)), "50 lbs");
});

test("a manual row shows what somebody typed, not a multiple", () => {
  // Raised Donut v11's Prep Time row: 2.75 / 3 / 3.25 / 3.5 hr, which is
  // nothing times anything. This is the case decision 3 could not express and
  // FileMaker's own AutoUpdate flag marks on 1,910 of 5,260 ingredient lines.
  const line = {
    qty: 2.75,
    unit: "hr",
    scaleAuto: false,
    scaleAmounts: [null, 3, 3.25, 3.5, null],
    scaleUnits: [null, "hr", "hr", "hr", null],
  };
  eq(formatCell(columnCell(line, COLS[1], 1)), "3 hr");
  eq(formatCell(columnCell(line, COLS[2], 1)), "3.25 hr");
  eq(formatCell(columnCell(line, COLS[3], 1)), "3.5 hr");
  // Left auto, the same row would claim 13.75 / 20.6 / 27.5 hr.
  eq(formatCell(columnCell({ ...line, scaleAuto: true }, COLS[1], 1)), "13.8 hr");
});

test("a manual row with an empty slot falls back to the computed value", () => {
  // Turning the switch off is a decision to stop maintaining the column, not a
  // decision to empty it — a blank cell would read as data loss.
  const line = {
    qty: 5,
    unit: "lbs",
    scaleAuto: false,
    scaleAmounts: [null, null, 37.5, null, null],
    scaleUnits: [null, null, "lbs", null, null],
  };
  eq(formatCell(columnCell(line, COLS[1], 1)), "25 lbs", "computed");
  eq(formatCell(columnCell(line, COLS[2], 1)), "37.5 lbs", "typed");
});

test("the % column is a share on an auto row and a stored number on a manual one", () => {
  const auto = { qty: 5, unit: "lbs", scaleAuto: true };
  eq(columnCell(auto, COLS[4], 1), { qty: null, unit: "%" });

  const manual = {
    qty: 2.8,
    unit: "lbs",
    scaleAuto: false,
    scaleAmounts: [null, null, null, null, 56],
    scaleUnits: [null, null, null, null, "%"],
  };
  eq(formatCell(columnCell(manual, COLS[4], 1)), "56 %");
});

test("freezing the strip keeps what was on screen and never writes slot 0", () => {
  // Switching AUTO off has to materialise the computed values, or the row the
  // baker was reading goes blank the moment they take control of it.
  const frozen = freezeScales({ qty: 5, unit: "lbs" }, COLS, 1, 100);
  eq(frozen.amounts, [null, 25, 37.5, 50, 100]);
  eq(frozen.units, [null, "lbs", "lbs", "lbs", "%"]);
});

test("freezing promotes the unit exactly as the display did", () => {
  const cols = scaleColumns(["x1", "x10"], [1, 10]);
  const frozen = freezeScales({ qty: 170, unit: "g" }, cols, 1, null);
  eq(frozen.amounts, [null, 1.7]);
  eq(frozen.units, [null, "kg"]);
});

test("withSlot grows a short strip rather than writing past its end", () => {
  // A line loaded before 041 has no strip at all, and the first cell somebody
  // edits is as likely to be column 3 as column 1.
  eq(withSlot<number>(null, 3, 42, 5), [null, null, null, 42, null]);
  eq(withSlot<string>(["a", "b"], 1, "c", 3), ["a", "c", null]);
});

/* -- the % column ---------------------------------------------------------- */

test("percent is each line's share of the FIRST ingredient", () => {
  // CORRECTED 2026-08-08. Mark's Raised Donut v11 as printed by FileMaker:
  // 5 lbs of mix at 100%, 2.8 lbs of water at 56%, 1.2 oz of yeast at 1.5%,
  // 1 lb of seed dough at 20%. Every one of those is a share of the mix.
  // Against the batch TOTAL (8.875 lbs) the first line would read 56%.
  const lines = [
    { qty: 5, unit: "lbs" },
    { qty: 2.8, unit: "lbs" },
    { qty: 1.2, unit: "oz" },
    { qty: 1, unit: "lbs" },
  ];
  const pct = bakersPercent(lines, convert);
  eq(pct.map((p) => Math.round(p! * 10) / 10), [100, 56, 1.5, 20]);
});

test("percent normalises units before comparing them", () => {
  const pct = bakersPercent([{ qty: 1, unit: "kg" }, { qty: 1000, unit: "g" }], convert);
  eq(pct.map((p) => Math.round(p!)), [100, 100]);
});

test("a line that cannot be weighed gets NO percentage", () => {
  // Counting it as zero would put a confident 0% beside two eggs.
  const pct = bakersPercent(
    [{ qty: 500, unit: "g" }, { qty: 250, unit: "g" }, { qty: 2, unit: "ea" }],
    convert
  );
  eq(pct.map((p) => (p === null ? null : Math.round(p))), [100, 50, null]);
});

test("the basis is the first WEIGHABLE line, not simply the first line", () => {
  // A recipe opening with "1 sheet pan" would otherwise report no percentages
  // at all.
  const pct = bakersPercent(
    [{ qty: 1, unit: "ea" }, { qty: 400, unit: "g" }, { qty: 200, unit: "g" }],
    convert
  );
  eq(pct.map((p) => (p === null ? null : Math.round(p))), [null, 100, 50]);
});

test("an all-unweighable batch reports no percentages rather than dividing by zero", () => {
  const pct = bakersPercent([{ qty: 2, unit: "ea" }, { qty: 3, unit: "ea" }], convert);
  eq(pct, [null, null]);
});
