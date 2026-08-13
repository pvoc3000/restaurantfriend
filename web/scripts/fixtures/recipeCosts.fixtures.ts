// The COSTS matrix on a recipe's Info tab, and the recipe record's own address.
//
// The matrix is FileMaker's block reproduced as arithmetic. Its whole point is
// that INGREDIENTS SCALE AND LABOUR DOES NOT, so the cost of one donut falls as
// the batch grows — and the cases below are Banana Cake Donut v10's real
// figures, which FileMaker prints as $3.08 at the test batch against $0.61 at
// ×1. Anything that quietly makes labour scale would pass a plausibility check
// and be wrong by a factor of five at the batch the shop actually makes.

import { scaleColumns } from "../../src/lib/production";
import {
  recipeCostMatrix,
  defaultColumn,
  metadataLine,
  type CostLine,
} from "../../src/lib/recipeCosts";
import { parseRecipeTab, parseRecipeVersion, recipeHref } from "../../src/lib/recipes";
import { test, eq } from "./harness";

/* Banana Cake Donut v10: .5 / x1 / x1.5 / x2 at ×1, ×2, ×3, ×4, plus a %. */
const COLUMNS = scaleColumns([".5", "x1", "x1.5", "x2", "%"], [1, 2, 3, 4, 1]);

/** Its prep-time row: 0.5 / 0.5 / 0.6 / 0.7 hr — typed, because it doesn't scale. */
const PREP: CostLine = {
  label: "Prep Time",
  qty: 0.5,
  unit: "hr",
  scaleAuto: false,
  scaleAmounts: [null, 0.5, 0.6, 0.7, null],
  scaleUnits: [null, "hr", "hr", "hr", null],
};

/** Its expected-yield row: 15 / 30 / 45 / 60 ea — this one DOES scale. */
const YIELD: CostLine = {
  label: "Expected Yield",
  qty: 15,
  unit: "ea",
  scaleAuto: true,
  scaleAmounts: null,
  scaleUnits: null,
};

const FLOUR: CostLine = {
  label: "Bakemark Vegan Cake Mix",
  qty: 1,
  unit: "kg",
  scaleAuto: true,
  scaleAmounts: null,
  scaleUnits: null,
};

const LINES = [FLOUR, PREP, YIELD];

const matrix = (over: Partial<Parameters<typeof recipeCostMatrix>[0]> = {}) =>
  recipeCostMatrix({
    columns: COLUMNS,
    lines: LINES,
    baseIngredientCost: 8.38,
    laborRate: 35,
    costColumn: null,
    ...over,
  });

/* -- the shape ------------------------------------------------------------- */

test("the % column is never costed", () => {
  // It is a share of the batch, not a batch — costing it would put a dollar
  // figure under a column whose cells are percentages.
  eq(matrix().map((c) => c.column.label), [".5", "x1", "x1.5", "x2"]);
});

test("ingredients scale strictly with the multiplier", () => {
  eq(matrix().map((c) => round(c.ingredients)), [8.38, 16.76, 25.14, 33.52]);
});

/* -- the point of the whole block ------------------------------------------ */

test("LABOUR DOES NOT SCALE — it is read off the prep-time row", () => {
  // 0.5 / 0.5 / 0.6 / 0.7 hours at $35. Ten times the batch is nowhere near ten
  // times the work, and a matrix that multiplied labour by the multiplier would
  // report $140 at x2 instead of $24.50.
  eq(matrix().map((c) => c.laborHours), [0.5, 0.5, 0.6, 0.7]);
  eq(matrix().map((c) => round(c.labor)), [17.5, 17.5, 21, 24.5]);
});

test("cost per unit FALLS as the batch grows, which is why the radio exists", () => {
  // Subtotal ÷ the yield row. Costing this recipe only at its base column would
  // price a donut at $1.73 when the batch the shop actually makes costs $0.97 —
  // and the gap widens with the multiplier spread. Raised Donut's strip runs
  // ×1/×5/×7.5/×10, where FileMaker's own block reads $3.08 against $0.61.
  const per = matrix().map((c) => round(c.costPer));
  eq(per, [1.73, 1.14, 1.03, 0.97]);
  eq(per[0]! > per[3]!, true, "the base column is the most expensive");
  // Strictly monotonic, which is the property a rewrite would break by making
  // labour scale — at that point every column would report the same figure.
  eq(
    per.every((v, i) => i === 0 || v! < per[i - 1]!),
    true,
    "each larger batch is cheaper per unit"
  );
});

test("the yield row is read per column, not divided out of one number", () => {
  eq(matrix().map((c) => c.yieldQty), [15, 30, 45, 60]);
  eq(matrix()[0].yieldUnit, "ea");
});

/* -- the missing cases ----------------------------------------------------- */

test("no labour rate charges NO labour rather than zero", () => {
  // A shop with no rate set has not told us labour is free.
  const m = matrix({ laborRate: null });
  eq(m.map((c) => c.labor), [null, null, null, null]);
  // The subtotal is then the ingredients alone, not null — we do know that much.
  eq(m.map((c) => round(c.subtotal)), [8.38, 16.76, 25.14, 33.52]);
});

test("a version with no prep-time row reports no labour", () => {
  const m = matrix({ lines: [FLOUR, YIELD] });
  eq(m.map((c) => c.laborHours), [null, null, null, null]);
  eq(m.map((c) => c.labor), [null, null, null, null]);
});

test("a version with no yield row has no cost per unit", () => {
  // 101 of the 493 migrated versions carry none of the metadata rows. Dividing
  // by a missing yield would either throw or invent a per-unit cost.
  const m = matrix({ lines: [FLOUR, PREP] });
  eq(m.map((c) => c.costPer), [null, null, null, null]);
});

test("an unpriced recipe still shows its labour", () => {
  const m = matrix({ baseIngredientCost: null });
  eq(m.map((c) => c.ingredients), [null, null, null, null]);
  eq(m.map((c) => round(c.labor)), [17.5, 17.5, 21, 24.5]);
});

/* -- which column the recipe is costed at ---------------------------------- */

test("null costs at the base column", () => {
  eq(matrix().findIndex((c) => c.isDefault), 0);
  eq(round(defaultColumn(matrix())!.costPer), 1.73);
});

test("a chosen column is the one marked, and the one the headline quotes", () => {
  const m = matrix({ costColumn: 3 });
  eq(m.map((c) => c.isDefault), [false, false, false, true]);
  eq(defaultColumn(m)!.column.label, "x2");
  eq(round(defaultColumn(m)!.costPer), 0.97);
});

test("a chosen column that no longer exists falls back to the base", () => {
  // The strip was shortened after somebody chose slot 6. Marking nothing would
  // leave the block quoting a figure with no column highlighted.
  const m = matrix({ costColumn: 6 });
  eq(m.map((c) => c.isDefault), [true, false, false, false]);
});

test("EXACTLY ONE column is ever marked", () => {
  for (const chosen of [null, 0, 1, 2, 3, 6, 99]) {
    eq(matrix({ costColumn: chosen }).filter((c) => c.isDefault).length, 1, `chosen=${chosen}`);
  }
});

/* -- finding the metadata rows --------------------------------------------- */

test("the metadata rows are found by label, case and spacing forgiven", () => {
  const lines = [{ ...PREP, label: "  PREP TIME " }, YIELD];
  eq(metadataLine(lines, "prep")?.qty, 0.5);
  eq(metadataLine(lines, "yield")?.qty, 15);
  eq(metadataLine(lines, "mixer"), null);
});

test("an ordinary ingredient is never mistaken for one", () => {
  eq(metadataLine([FLOUR], "prep"), null);
});

/* -- the record's address --------------------------------------------------- */

test("an unknown tab shows the record rather than an error", () => {
  eq(parseRecipeTab("ingredients"), "ingredients");
  eq(parseRecipeTab("procedure"), "procedure");
  eq(parseRecipeTab("nonsense"), "info");
  eq(parseRecipeTab(undefined), "info");
});

test("the RETIRED `recipe` tab lands on the ingredients, not on info", () => {
  // Every link, bookmark and remembered nav path written before the
  // 2026-08-11 split says `tab=recipe` and meant the ingredients. Falling back
  // to `info` like any other unrecognised value would drop all of them on the
  // wrong screen — which is the one case the catch-all gets wrong.
  eq(parseRecipeTab("recipe"), "ingredients");
});

test("the defaults write no parameter, so the record keeps one canonical address", () => {
  eq(recipeHref("abc", { tab: "info" }), "/recipes/abc");
  eq(recipeHref("abc", { tab: "info", version: null }), "/recipes/abc");
  eq(recipeHref("abc", { tab: "ingredients" }), "/recipes/abc?tab=ingredients");
  eq(
    recipeHref("abc", { tab: "procedure", version: "11" }),
    "/recipes/abc?tab=procedure&v=11"
  );
});

test("the breadcrumb trail rides through a tab change", () => {
  // Without this, moving between tabs strips the trail that led here and the
  // record book loses its found set.
  eq(
    recipeHref("abc", { tab: "ingredients", version: "11" }, { from: "/vendors", fromLabel: "Vendors", tab: "info", v: "10" }),
    "/recipes/abc?from=%2Fvendors&fromLabel=Vendors&tab=ingredients&v=11"
  );
});

test("an empty version parameter means the master, not a version called ''", () => {
  eq(parseRecipeVersion(""), null);
  eq(parseRecipeVersion("   "), null);
  eq(parseRecipeVersion("11"), "11");
  eq(parseRecipeVersion(undefined), null);
});

function round(n: number | null): number | null {
  return n === null ? null : Number(n.toFixed(2));
}
