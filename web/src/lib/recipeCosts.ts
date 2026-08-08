// The COSTS matrix on a recipe's Info tab — FileMaker's block, arithmetic only.
//
// Nothing here is stored. Migration 036 has no cost column anywhere in it
// (decision 11) and this does not add one: the ingredient figure comes from
// `lib/productionCost`, which resolves live through purchasing, and everything
// else is that figure, the version's own scale strip, and the shop's labour
// rate. A recipe re-costed after a flour price moves is re-costed here too.
//
// The ONE stored thing is which column the recipe is costed AT — migration
// 042's `cost_column` — because that is a decision rather than a derivation.

import {
  columnCell,
  type ScalableLine,
  type ScaleColumn,
} from "./production";

/**
 * The metadata rows FileMaker keeps in the ingredient list, by the label the
 * migration writes for them.
 *
 * Matching on a NAME is normally how this codebase gets things wrong, so it is
 * worth saying why it is safe here: these are not user-typed strings that
 * happen to look alike. FileMaker holds them as three pseudo-items in
 * `Recipe_Items` with exactly these names, and
 * `migration/backfill-recipe-metadata-rows.mjs` writes the label itself from a
 * fixed map. A row called "Prep Time" on a recipe got that name from one place.
 *
 * A recipe that has none of them simply reports no labour and no yield, which
 * is honest — 101 of the 493 versions carry none.
 */
export const METADATA_LABELS = {
  mixer: "mixer size",
  yield: "expected yield",
  prep: "prep time",
} as const;

export type CostLine = ScalableLine & { label: string | null };

export type CostColumnFigures = {
  column: ScaleColumn;
  /** What the ingredients come to at this batch size. */
  ingredients: number | null;
  /** The prep-time row at this column, in hours. */
  laborHours: number | null;
  labor: number | null;
  subtotal: number | null;
  /** The expected-yield row at this column. */
  yieldQty: number | null;
  yieldUnit: string | null;
  /** Subtotal ÷ yield — what one donut costs to make at this batch size. */
  costPer: number | null;
  /** The column this recipe is costed at (migration 042). */
  isDefault: boolean;
};

/** The line carrying one of the metadata rows, if the version has it. */
export function metadataLine(
  lines: readonly CostLine[],
  which: keyof typeof METADATA_LABELS
): CostLine | null {
  const want = METADATA_LABELS[which];
  return lines.find((l) => (l.label ?? "").trim().toLowerCase() === want) ?? null;
}

/**
 * Every batch column, costed.
 *
 * INGREDIENTS SCALE AND LABOUR DOES NOT, which is the whole reason this matrix
 * is worth printing rather than one figure. Ten times the batch is ten times the
 * flour and nowhere near ten times the work — Banana Cake Donut v10 runs 0.5
 * hours at its smallest batch and 0.7 at its largest — so the cost of one donut
 * falls as the batch grows, and by a lot: FileMaker's own sheet reads $3.08 at
 * the test batch against $0.61 at ×1. A recipe costed only at its base column
 * would price the shop's actual output nearly five times too high.
 *
 * Labour is charged at the WORKING LOCATION's rate. It is a fact about the shop
 * doing the making, not about the recipe, so a recipe read at DF01 and at EVENT
 * legitimately costs different amounts to produce.
 */
export function recipeCostMatrix({
  columns,
  lines,
  baseIngredientCost,
  laborRate,
  costColumn,
}: {
  columns: readonly ScaleColumn[];
  lines: readonly CostLine[];
  /** What the ingredients cost at the BASE column, from `versionBatchCost`. */
  baseIngredientCost: number | null;
  /** The shop's hourly rate — `locations.labor_rate`. Null charges no labour
   *  rather than charging zero, which are different claims. */
  laborRate: number | null;
  /** Migration 042. Null = the base column. */
  costColumn: number | null;
}): CostColumnFigures[] {
  const priced = columns.filter((c) => !c.isPercent);
  const baseColumn = priced[0] ?? null;
  const baseIndex = baseColumn?.index ?? 0;
  const base = baseColumn?.multiplier ?? 1;

  const prep = metadataLine(lines, "prep");
  const yields = metadataLine(lines, "yield");

  // A cost column pointing at a slot this version doesn't have — the strip was
  // shortened after somebody chose it — falls back to the base rather than
  // marking nothing, so the block always says which column it is quoting.
  const chosen = priced.some((c) => c.index === costColumn) ? costColumn : baseIndex;

  return priced.map((column) => {
    const factor = column.multiplier / (base || 1);
    const ingredients = baseIngredientCost === null ? null : baseIngredientCost * factor;

    const prepCell = prep ? columnCell(prep, column, base, baseIndex) : null;
    const laborHours = prepCell?.qty ?? null;
    const labor = laborHours === null || laborRate === null ? null : laborHours * laborRate;

    const subtotal =
      ingredients === null && labor === null ? null : (ingredients ?? 0) + (labor ?? 0);

    const yieldCell = yields ? columnCell(yields, column, base, baseIndex) : null;
    const yieldQty = yieldCell?.qty ?? null;

    return {
      column,
      ingredients,
      laborHours,
      labor,
      subtotal,
      yieldQty,
      yieldUnit: yieldCell?.unit ?? null,
      costPer: subtotal === null || !yieldQty ? null : subtotal / yieldQty,
      isDefault: column.index === chosen,
    };
  });
}

/** The figures for the column this recipe is costed at — the block's headline. */
export function defaultColumn(matrix: CostColumnFigures[]): CostColumnFigures | null {
  return matrix.find((c) => c.isDefault) ?? matrix[0] ?? null;
}
