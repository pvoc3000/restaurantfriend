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
 * the schema and the screens offer a PickList over whatever exists, `allowNew`.
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
export type ScaleColumn = { label: string; multiplier: number; isPercent: boolean };

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
    });
  }
  return out;
}

/**
 * A line's amount in one scale column, as a display string.
 *
 * Scaling switches the unit when the number gets unwieldy — 170 g at ×10 reads
 * "1.7 kg", not "1700 g" — because that is what FileMaker's own columns did and
 * what a baker reading the sheet expects. Only g→kg and ml→l, the two the data
 * actually uses; anything else keeps its unit.
 */
export function scaledAmount(
  qty: number | null,
  unit: string | null,
  column: ScaleColumn,
  baseMultiplier: number
): string {
  if (qty === null) return "";
  if (column.isPercent) return "";        // the % column is filled by percentOfBatch
  const scaled = (qty / (baseMultiplier || 1)) * column.multiplier;
  const u = (unit ?? "").toLowerCase();
  if (u === "g" && scaled >= 1000) return `${trim(scaled / 1000)} kg`;
  if (u === "ml" && scaled >= 1000) return `${trim(scaled / 1000)} l`;
  return unit ? `${trim(scaled)} ${unit}` : trim(scaled);
}

/** 2.50 → "2.5", 1700 → "1700" — a baker's number, not a float. */
function trim(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/**
 * Each line's share of the batch by weight — FileMaker's `%` column.
 *
 * Measured on the real data: a line's stored % is its share of the batch TOTAL,
 * not of the flour, so this is not baker's percentage in the strict sense
 * despite the brief calling it that. Lines whose unit can't be weighed are
 * excluded from the denominator AND get no percentage, rather than being
 * counted as zero.
 */
export function percentOfBatch(
  lines: { qty: number | null; unit: string | null }[],
  convert: (amount: number, from: string, to: string) => number | null
): (number | null)[] {
  const grams = lines.map((l) =>
    l.qty === null || !l.unit ? null : convert(Number(l.qty), l.unit, "g")
  );
  const total = grams.reduce((a: number, g) => a + (g ?? 0), 0);
  if (!total) return lines.map(() => null);
  return grams.map((g) => (g === null ? null : (g / total) * 100));
}
