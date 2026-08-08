"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { UNIT_PICK_OPTIONS } from "@/lib/units";
import {
  columnCell,
  formatCell,
  withSlot,
  type ScalableLine,
  type ScaleColumn,
} from "@/lib/production";

/**
 * One portion size in the recipe grid: a quantity and the unit it is counted
 * in, side by side, the way FileMaker set them.
 *
 * TWO FIELDS AND NOT A STRING, which is Mark's point (2026-08-08) and not a
 * cosmetic one — "1.7 kg" parsed back out of a text box is a guess, and the
 * unit is where the expensive mistakes live. The unit is a PickList, since a
 * known vocabulary is chosen and never typed; `allowNew` because a recipe
 * genuinely counts in things `lib/units` has never heard of (hr for a prep
 * time, C for a temperature, % for a share).
 *
 * WHICH CELLS ARE EDITABLE IS THE WHOLE MODEL IN ONE LINE. The base column
 * always is — it is what everything else is derived from. Every other column is
 * editable only while the row's AUTO switch is off; with it on the numbers
 * belong to the multiplier above them, and offering a box that the next render
 * silently overwrites would be worse than showing none.
 */
export function RecipeScaleCell({
  line,
  column,
  base,
  baseIndex,
  width,
  editable,
  /** The derived baker's percentage, for the `%` column of an auto row. */
  percent,
}: {
  line: ScalableLine & {
    id: string;
    scaleAmounts: (number | null)[] | null;
    scaleUnits: (string | null)[] | null;
  };
  column: ScaleColumn;
  base: number;
  baseIndex: number;
  width: number;
  editable: boolean;
  percent: number | null;
}) {
  const isBase = column.index === baseIndex;
  const auto = line.scaleAuto !== false;
  const cell = columnCell(line, column, base, baseIndex);

  // An auto row's % column is DERIVED, like the computed amounts beside it, so
  // it reads the same way: quiet text, owned by the sheet rather than by you.
  if (column.isPercent && auto) {
    return (
      <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
        {percent === null ? "" : `${percent.toFixed(1)}%`}
      </span>
    );
  }

  if (!editable || (!isBase && auto)) {
    return (
      <span className={`${READ_ONLY_VALUE} tabular-nums ${auto && !isBase ? "text-muted" : ""}`}>
        {formatCell(cell)}
      </span>
    );
  }

  // The base column writes the line's own two columns; every other one writes a
  // slot of the strip. Both write BOTH strips in one statement — 041's check
  // constraint keeps the arrays the same length, so a lone write to `amounts`
  // on a row whose `units` is still null is a failed update, not a half-saved
  // one.
  return (
    <span className="flex items-baseline gap-1">
      <span className="min-w-0 flex-1">
        {isBase ? (
          <InlineValue
            table="production_recipe_lines"
            id={line.id}
            column="qty"
            kind="number"
            value={cell.qty}
            align="right"
            placeholder=""
          />
        ) : (
          <InlineValue
            table="production_recipe_lines"
            id={line.id}
            column="scale_amounts"
            kind="number"
            value={cell.qty}
            align="right"
            placeholder=""
            arrayColumn="scale_amounts"
            arrayIndex={column.index}
            arrayStrip={line.scaleAmounts}
            arrayWidth={width}
            alsoUpdate={() => ({
              scale_units: withSlot(line.scaleUnits, column.index, cell.unit, width),
            })}
          />
        )}
      </span>
      <span className="w-[52px] shrink-0">
        {isBase ? (
          <InlineValue
            table="production_recipe_lines"
            id={line.id}
            column="unit"
            kind="pick"
            allowNew
            options={UNIT_PICK_OPTIONS}
            value={cell.unit}
            placeholder=""
          />
        ) : (
          <InlineValue
            table="production_recipe_lines"
            id={line.id}
            column="scale_units"
            kind="pick"
            allowNew
            options={UNIT_PICK_OPTIONS}
            value={cell.unit}
            placeholder=""
            arrayColumn="scale_units"
            arrayIndex={column.index}
            arrayStrip={line.scaleUnits}
            arrayWidth={width}
            alsoUpdate={() => ({
              scale_amounts: withSlot(line.scaleAmounts, column.index, cell.qty, width),
            })}
          />
        )}
      </span>
    </span>
  );
}
