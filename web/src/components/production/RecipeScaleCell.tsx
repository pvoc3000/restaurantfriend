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
      <ReadAmount
        qty={percent === null ? "" : percent.toFixed(1)}
        unit={percent === null ? "" : "%"}
        muted
      />
    );
  }

  if (!editable || (!isBase && auto)) {
    return (
      <ReadAmount
        qty={formatCell({ qty: cell.qty, unit: null })}
        unit={cell.qty === null ? "" : cell.unit ?? ""}
        muted={auto && !isBase}
      />
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
            // The READABLE name, not the target: `arrayColumn` below is what
            // gets written, and `column` is only the accessible name and the
            // word an error is worded around. "scale_amounts" is neither.
            column="amount"
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
            column="unit"
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

/**
 * A worked-out amount, set out the way an editable one is (Mark, 2026-11-03:
 * "auto calculated fields in the ingredient list should be right aligned"):
 * the number RIGHT-aligned in the cell's slack and the unit in the same 52px
 * box the editor gives it. So a computed "1.7 kg" and a typed one beside it
 * line up digit for digit, and the eye reads down a column of numbers rather
 * than a ragged column of phrases.
 */
function ReadAmount({ qty, unit, muted }: { qty: string; unit: string; muted: boolean }) {
  return (
    <span className={`flex items-baseline gap-1 tabular-nums ${muted ? "text-muted" : ""}`}>
      <span className={`${READ_ONLY_VALUE} min-w-0 flex-1 text-right`}>{qty}</span>
      <span className={`${READ_ONLY_VALUE} w-[52px] shrink-0`}>{unit}</span>
    </span>
  );
}
