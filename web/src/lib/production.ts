/**
 * Vocabularies and small helpers shared by the Production screens.
 *
 * `kind` is hardcoded here and that is deliberate under design rule 2, which
 * forbids business config in code but not SCHEMA: these three values are
 * migration 036's own check constraint, the same reasoning `ORDER_TYPE_LABEL`
 * and `PO_STATUS_LABEL` already rest on. An org cannot invent a fourth kind
 * without a migration, so a pick list over them needs no `allowNew`.
 *
 * Element TYPE and SCHEDULE CLASS are the opposite — a kitchen invents a
 * category faster than a migration can be written — so those are free text in
 * the schema and the screens offer a PickList, `allowNew`. Type lists whatever
 * already exists; schedule lists the two Mark named and lets the rest be typed
 * (see `SCHEDULE_CLASS_OPTIONS`).
 */

export const ELEMENT_KINDS = ["made", "purchased", "manual"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const ELEMENT_KIND_LABEL: Record<ElementKind, string> = {
  made: "Made",
  purchased: "Purchased",
  manual: "Manual",
};

/** What each kind costs FROM — the hint beside it in the picker. */
export const ELEMENT_KIND_HINT: Record<ElementKind, string> = {
  made: "from a recipe",
  purchased: "from an inventory item",
  manual: "a set cost",
};

export const ELEMENT_KIND_OPTIONS = ELEMENT_KINDS.map((value) => ({
  value,
  label: ELEMENT_KIND_LABEL[value],
  hint: ELEMENT_KIND_HINT[value],
}));

/**
 * The element's production rhythm — the Schedule field on element detail
 * (Mark, 2026-08-11: "a popup menu … Daily and Weekly").
 *
 * THE VALUES ARE UPPERCASE AND THAT IS LOAD-BEARING, not house style.
 * `generate_production_batches` (044) selects `schedule_class = 'WEEKLY'` with
 * an exact string comparison, and `lib/productionPacket` builds the AB and
 * Weekly element sheets by filtering on `'AB'` / `'WEEKLY'`. A menu that wrote
 * "Weekly" would quietly drop 45 active elements out of batch generation while
 * the screen went on reading correctly. Only the LABEL is title case.
 *
 * `allowNew` at the call site, and it is not tidiness: the live catalog also
 * holds AB (47 elements) and DONUT (16), and `PickList` with a closed set does
 * not merely hide a value from the menu — it makes it UNENTERABLE, while the
 * stored ones keep rendering, which is what hides the gap (the `GAL`/`QT`
 * lesson in CLAUDE.md). AB in particular is the AB element sheet's only
 * source. Leaving them off the LIST is Mark's call; leaving them unreachable
 * would be a bug.
 */
export const SCHEDULE_CLASSES = ["DAILY", "WEEKLY"] as const;

/**
 * The element TYPE vocabulary — the recipe types, plus one (Mark, 2026-08-11:
 * "the same as recipe types, plus 'Ingredient' and Add New").
 *
 * IT IS THE RECIPE TYPES AND NOT THE ELEMENT TYPES ALREADY IN USE, which is
 * the point and the thing a tidy-up would undo. `production_recipes.recipe_type`
 * holds eight values (Cookie · Donut · Filling · Glaze · Ice Cream · Misc ·
 * Signature · Topping) and `production_elements.element_type` holds sixteen —
 * the eight plus Cleaning, Bagging, Cream, Jam, Fruit, AB Duties, Ice Cream Cup
 * and Cookie Sandwich Supreme, FileMaker's drift. Offering what exists would
 * offer the drift back. `Ingredient` is the one thing an element is that a
 * recipe never is: a purchased component, which is 203 of the 210 untyped rows.
 *
 * The list is DERIVED from the recipes rather than written down here, so the
 * two vocabularies cannot diverge — "same as recipe types" is a rule about a
 * relationship, not a snapshot of eight strings.
 *
 * `allowNew` at every call site, which is what makes the narrowing safe: the
 * off-list values stay typeable and a stored one still renders (PickList lists
 * the current value first whether or not it is on the menu).
 */
export const INGREDIENT_ELEMENT_TYPE = "Ingredient";

export function elementTypeVocabulary(
  recipeTypes: (string | null | undefined)[]
): string[] {
  const set = new Set<string>([INGREDIENT_ELEMENT_TYPE]);
  for (const t of recipeTypes) {
    const v = (t ?? "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export const SCHEDULE_CLASS_OPTIONS = SCHEDULE_CLASSES.map((value) => ({
  value,
  label: value.charAt(0) + value.slice(1).toLowerCase(),
}));

export function elementKindLabel(kind: string | null): string {
  return kind && kind in ELEMENT_KIND_LABEL
    ? ELEMENT_KIND_LABEL[kind as ElementKind]
    : "—";
}

/**
 * The scale columns a recipe version renders — its stored labels paired with
 * its multipliers, with the base column first.
 *
 * The AMOUNTS are computed here rather than stored, which is production brief
 * decision 3 and a measurement rather than a preference: 96.4% of FileMaker's
 * stored per-column amounts are within 2% of a strict multiple of the base
 * column, once the unit changing as the number grows (170 g → 1.7 kg at ×10)
 * and a blank multiplier in slot 0 meaning ×1 are both accounted for.
 *
 * A `%` column is not a scale — it is each line's share of the batch — so it is
 * flagged rather than multiplied.
 */
export type ScaleColumn = {
  label: string;
  multiplier: number;
  isPercent: boolean;
  /**
   * WHICH SLOT THIS IS IN THE STORED STRIP, which is not the same as where it
   * appears on screen — an unlabelled slot is skipped, so a version whose
   * second label is blank renders its third column first.
   *
   * Everything that WRITES has to use this rather than a loop counter: the
   * multiplier cell, the label cell, and every per-line amount 041 stores.
   * Using the display position instead would quietly write column 3's amount
   * into column 2's slot, and only on the versions with a gap.
   */
  index: number;
};

export function scaleColumns(
  labels: string[] | null,
  multipliers: number[] | null
): ScaleColumn[] {
  const l = labels ?? [];
  const m = multipliers ?? [];
  const width = Math.max(l.length, m.length);
  const out: ScaleColumn[] = [];
  for (let i = 0; i < width; i++) {
    const label = (l[i] ?? "").trim();
    if (!label) continue;
    out.push({
      label,
      // A blank multiplier is ×1 — FileMaker put the base in slot 0 and left it
      // empty on all 493 versions.
      multiplier: Number.isFinite(Number(m[i])) && Number(m[i]) ? Number(m[i]) : 1,
      isPercent: label === "%",
      index: i,
    });
  }
  return out;
}

/** How many slots the stored strips must have to cover every column in use. */
export function scaleWidth(columns: ScaleColumn[]): number {
  return columns.reduce((w, c) => Math.max(w, c.index + 1), 0);
}

/**
 * A portion size: a number and the unit it is counted in.
 *
 * Two fields, not a string, because FileMaker's grid is two fields per cell and
 * migration 041 makes them editable — a cell you can type into has to know
 * which half you typed.
 */
export type ScaleCell = { qty: number | null; unit: string | null };

/**
 * What a line looks like to the scaling helpers. The base amount, the version's
 * strip, and whether this row is computed or left alone.
 */
export type ScalableLine = {
  qty: number | null;
  unit: string | null;
  /** Migration 041. True = computed from the multipliers; false = typed. */
  scaleAuto?: boolean;
  /** The typed strip, read only when `scaleAuto` is false. Slot 0 is never read
   *  — the base column is `qty`/`unit`. */
  scaleAmounts?: (number | null)[] | null;
  scaleUnits?: (string | null)[] | null;
};

/**
 * A line's amount in one scale column, computed from the base.
 *
 * Scaling switches the unit when the number gets unwieldy — 170 g at ×10 reads
 * "1.7 kg", not "1700 g" — because that is what FileMaker's own columns did and
 * what a baker reading the sheet expects. Only g→kg and ml→l, the two the data
 * actually uses; anything else keeps its unit.
 */
export function computedCell(
  qty: number | null,
  unit: string | null,
  column: ScaleColumn,
  baseMultiplier: number
): ScaleCell {
  if (qty === null) return { qty: null, unit };
  const scaled = (qty / (baseMultiplier || 1)) * column.multiplier;
  const u = (unit ?? "").toLowerCase();
  if (u === "g" && scaled >= 1000) return { qty: round(scaled / 1000), unit: "kg" };
  if (u === "ml" && scaled >= 1000) return { qty: round(scaled / 1000), unit: "l" };
  return { qty: round(scaled), unit };
}

/**
 * What column `i` of this line actually shows.
 *
 * THE THREE CASES ARE IN PRIORITY ORDER AND THE ORDER IS THE WHOLE POINT.
 * Column 0 is always the stored base — it is what costing, the percentage and
 * every computed column read, and 041 deliberately does not keep a second copy
 * of it in the strip. Then a row with the switch off shows what somebody typed.
 * Only then do we multiply.
 *
 * A manual row with nothing stored in that slot falls back to the computed
 * value rather than to a blank: switching the switch off is a decision to stop
 * maintaining the column, not a decision to empty it.
 */
export function columnCell(
  line: ScalableLine,
  column: ScaleColumn,
  baseMultiplier: number,
  /** Which column is the base — the FIRST one rendered, which is slot 0 on all
   *  493 migrated versions but need not be if slot 0's label is ever cleared. */
  baseIndex = 0
): ScaleCell {
  const index = column.index;
  if (index === baseIndex) return { qty: line.qty, unit: line.unit };

  if (line.scaleAuto === false) {
    const qty = line.scaleAmounts?.[index];
    const unit = line.scaleUnits?.[index];
    if (qty !== null && qty !== undefined && Number.isFinite(Number(qty))) {
      return { qty: Number(qty), unit: unit ?? null };
    }
    // A stored unit with no amount is still somebody's answer about the unit.
    if (unit) return { qty: null, unit };
  }

  // The % column is a share, not a multiple — `bakersPercent` fills it.
  if (column.isPercent) return { qty: null, unit: "%" };

  return computedCell(line.qty, line.unit, column, baseMultiplier);
}

/** A cell as the sheet and the printed page set it: "1.7 kg", "50 lbs", "". */
export function formatCell(cell: ScaleCell): string {
  if (cell.qty === null) return "";
  return cell.unit ? `${trim(cell.qty)} ${cell.unit}` : trim(cell.qty);
}

/**
 * The strip to STORE when the switch is turned off — the computed columns,
 * frozen where they stand.
 *
 * Turning the switch off means "stop maintaining this row", not "clear it", so
 * the baker sees the same numbers they were looking at and edits from there.
 * Without this, switching off would blank a row and read as data loss.
 *
 * Slot 0 is null, always: the base column lives in `qty`/`unit` and a second
 * copy is how the two start disagreeing.
 */
export function freezeScales(
  line: ScalableLine,
  columns: ScaleColumn[],
  baseMultiplier: number,
  percent: number | null,
  baseIndex = 0
): { amounts: (number | null)[]; units: (string | null)[] } {
  const width = scaleWidth(columns);
  const amounts: (number | null)[] = Array(width).fill(null);
  const units: (string | null)[] = Array(width).fill(null);
  for (const column of columns) {
    if (column.index === baseIndex) continue;
    if (column.isPercent) {
      amounts[column.index] = percent === null ? null : round(percent);
      units[column.index] = "%";
      continue;
    }
    const cell = computedCell(line.qty, line.unit, column, baseMultiplier);
    amounts[column.index] = cell.qty;
    units[column.index] = cell.unit;
  }
  return { amounts, units };
}

/** One slot of a strip replaced, the array grown to `width` if it is short. */
export function withSlot<T>(
  strip: readonly (T | null)[] | null | undefined,
  index: number,
  value: T | null,
  width: number
): (T | null)[] {
  const out: (T | null)[] = [];
  for (let i = 0; i < Math.max(width, index + 1); i++) out.push(strip?.[i] ?? null);
  out[index] = value;
  return out;
}

/**
 * A baker's number, not a float.
 *
 * Precision falls as the quantity grows, because that is how a scale works and
 * how a person reads one: 175 g is weighed to the gram, 2.5 g of agar to a
 * tenth. Rounding everything to three decimals — which this did at first —
 * turned a 17.5 g line scaled by 1.75 into "30.625 g", a number no kitchen
 * scale can show and nobody would try to hit. Caught by rendering a real
 * recipe rather than by reading the code.
 */
function round(n: number): number {
  const places = n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3;
  return Number(n.toFixed(places));
}

function trim(n: number): string {
  return String(round(n));
}

/**
 * Each line as a percentage of the FIRST weighable ingredient — baker's
 * percentage, and FileMaker's `%` column.
 *
 * CORRECTED 2026-08-08, and it was wrong in a way that looked right. 036 read
 * the stored column as each line's share of the batch TOTAL and said so in the
 * schema notes. Measured against the real export over 2,478 lines that carry
 * both a weighable amount and a stored %: share-of-first matches on **1,758**,
 * share-of-total on **178**. Mark's own Raised Donut v11 settles it by
 * inspection — the mix is 5 lbs at 100%, water 2.8 lbs at 56%, and 2.8/5 is 56
 * where 2.8/8.875 is 32.
 *
 * The remaining 542 are recipes whose first line is not the flour, or whose
 * percentages were typed rather than derived — which is what the AUTO switch
 * (migration 041) is now for: a row left alone keeps the number somebody wrote.
 *
 * Lines whose unit can't be weighed get no percentage rather than a zero.
 */
export function bakersPercent(
  lines: { qty: number | null; unit: string | null }[],
  convert: (amount: number, from: string, to: string) => number | null
): (number | null)[] {
  const grams = lines.map((l) =>
    l.qty === null || !l.unit ? null : convert(Number(l.qty), l.unit, "g")
  );
  // The first line that can be weighed at all — not `grams[0]`, which on a
  // recipe opening with "1 sheet pan" would make every percentage null.
  const basis = grams.find((g) => g !== null && g > 0) ?? null;
  if (!basis) return lines.map(() => null);
  return grams.map((g) => (g === null ? null : (g / basis) * 100));
}


/**
 * The metadata rows FileMaker keeps in the ingredient list, by the label the
 * migration writes for them.
 *
 * These are NOT ingredients: they are `production_recipe_lines` with a label
 * and no `element_id`, so they cost nothing and price nothing. They are here
 * rather than in the version's columns because each one is per BATCH SIZE —
 * measured over the export, the single column disagrees with the rows on 196 of
 * 198 mixer sizes, 349 of 376 yields and 57 of 94 prep times.
 *
 * MATCHING BY NAME IS SAFE HERE and nowhere near as fragile as it looks: 036's
 * transform lifts them from FileMaker's `Recipe_Items` with exactly these
 * names, and `migration/backfill-recipe-metadata-rows.mjs` writes the label
 * from a fixed map. A row called "Prep Time" got that name from one place.
 *
 * They live in this module, not in `lib/recipeCosts`, because BOTH cost modules
 * need them now — `productionCost` reads the yield row to price a made element
 * (Mark, 2026-08-12: "we should not use production_recipe_versions.yield_amount
 * to determine costs, we should use the recipe yield number, always and
 * forever") and `recipeCosts` reads the yield and prep rows for the matrix.
 * `lib/production` imports nothing, so putting them here is what keeps the two
 * from becoming a cycle.
 */
export const METADATA_LABELS = {
  mixer: "mixer size",
  yield: "expected yield",
  prep: "prep time",
} as const;

export type MetadataRow = keyof typeof METADATA_LABELS;

/** The metadata row of a given kind, or null where the version carries none. */
export function metadataLine<T extends { label: string | null }>(
  lines: readonly T[],
  which: MetadataRow
): T | null {
  const want = METADATA_LABELS[which];
  return lines.find((l) => (l.label ?? "").trim().toLowerCase() === want) ?? null;
}
