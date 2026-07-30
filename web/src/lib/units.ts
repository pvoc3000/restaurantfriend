// Unit conversion for the package-content editor (brief P2 #2).
//
// package_content is "how much of the inventory item's base_unit is in one
// package of the vendor item" (spec §4.1 — 50 = 50 lbs per bag). The editor
// lets Mark type amount × size + unit ("24 × 32 oz") and converts the total
// into the item's base_unit. Conversion only works within a family; crossing
// families (weigh a count, etc.) returns null so the UI can warn.

export type UnitFamily = "mass" | "volume" | "count" | "package";

// Factor = how many canonical base units (grams / milliliters / each) one of
// this unit is. Ratios are what matter, so the canonical choice is arbitrary.
const UNITS: Record<string, { family: UnitFamily; factor: number; label: string }> = {
  // mass (canonical: gram)
  g: { family: "mass", factor: 1, label: "g" },
  oz: { family: "mass", factor: 28.349523125, label: "oz" },
  lb: { family: "mass", factor: 453.59237, label: "lb" },
  lbs: { family: "mass", factor: 453.59237, label: "lbs" },
  kg: { family: "mass", factor: 1000, label: "kg" },
  // volume (canonical: milliliter)
  ml: { family: "volume", factor: 1, label: "ml" },
  floz: { family: "volume", factor: 29.5735295625, label: "fl oz" },
  cup: { family: "volume", factor: 236.5882365, label: "cup" },
  pt: { family: "volume", factor: 473.176473, label: "pt" },
  qt: { family: "volume", factor: 946.352946, label: "qt" },
  gal: { family: "volume", factor: 3785.411784, label: "gal" },
  l: { family: "volume", factor: 1000, label: "L" },
  // count (canonical: each)
  ea: { family: "count", factor: 1, label: "ea" },
  each: { family: "count", factor: 1, label: "each" },
  dozen: { family: "count", factor: 12, label: "dozen" },
  // Packages — what the thing is bought and stacked as, for items you count in
  // whole containers rather than in weight or each (Mark, 2026-07-30). One item
  // at DF01 is ALREADY counted in CS and the picker couldn't offer it.
  //
  // The vocabulary is the catalog's own `package_desc`, not an invention:
  // measured 2026-07-30 over 2,888 vendor items — CS 1248, BAG 201, TUB 117,
  // BOX 54, SLEEVE 18, FLAT 9, ROLL 6, Tray 4. The one-offs are left out (SET 2,
  // PR 1, and PKG 4, which as a unit of counting says nothing).
  //
  // FACTOR 1 IS A PLACEHOLDER AND NEVER USED: `convert` refuses to cross in or
  // out of this family (below), because a case is not a fixed quantity of
  // anything — a case of cups and a case of flour share no ratio.
  cs: { family: "package", factor: 1, label: "case" },
  case: { family: "package", factor: 1, label: "case" },
  bag: { family: "package", factor: 1, label: "bag" },
  tub: { family: "package", factor: 1, label: "tub" },
  box: { family: "package", factor: 1, label: "box" },
  sleeve: { family: "package", factor: 1, label: "sleeve" },
  tray: { family: "package", factor: 1, label: "tray" },
  flat: { family: "package", factor: 1, label: "flat" },
  roll: { family: "package", factor: 1, label: "roll" },
};

export function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\.$/, "");
}

export function unitFamily(unit: string): UnitFamily | null {
  return UNITS[normalizeUnit(unit)]?.family ?? null;
}

/** The size-dropdown options, grouped by the family so the UI can label them. */
export const UNIT_OPTIONS: { value: string; label: string; family: UnitFamily }[] = [
  "ea",
  "dozen",
  "oz",
  "lbs",
  "kg",
  "g",
  "floz",
  "qt",
  "gal",
  "l",
  "ml",
  "cs",
  "bag",
  "tub",
  "box",
  "sleeve",
  "tray",
  "flat",
  "roll",
].map((value) => ({ value, label: UNITS[value].label, family: UNITS[value].family }));

/**
 * The same options as `<optgroup>`s, because a flat list of nineteen mixes two
 * different kinds of answer — how much of it there is, and what it comes in
 * (Mark, 2026-07-30, asking for "a divider of some sort"). Packages go last:
 * they're the newcomers and the rarer choice.
 */
export const UNIT_GROUPS: { label: string; family: UnitFamily }[] = [
  { label: "Count", family: "count" },
  { label: "Weight", family: "mass" },
  { label: "Volume", family: "volume" },
  { label: "Packages", family: "package" },
];

/**
 * Convert `amount` of `fromUnit` into `toUnit`. Returns null when the units are
 * in different families (incompatible) or either unit is unknown.
 *
 * A PACKAGE unit converts only to ITSELF — a case to a case, never a case to an
 * each or to a bag. There is no ratio to know: a case of cups and a case of
 * flour have nothing in common but the word. Letting them convert on the shared
 * family would make `packageContent` return confident nonsense, and package
 * content is what the guide divides by to suggest a quantity.
 */
export function convert(amount: number, fromUnit: string, toUnit: string): number | null {
  const fromKey = normalizeUnit(fromUnit);
  const toKey = normalizeUnit(toUnit);
  const from = UNITS[fromKey];
  const to = UNITS[toKey];
  if (!from || !to || from.family !== to.family) return null;
  if (from.family === "package" && from.label !== to.label) return null;
  return (amount * from.factor) / to.factor;
}

/**
 * package_content for one package: `amount` packages of `size` `sizeUnit`,
 * expressed in `baseUnit`. e.g. compute(24, 32, "oz", "lbs") → 48.
 * Returns null if sizeUnit can't convert to baseUnit.
 */
export function packageContent(
  amount: number,
  size: number,
  sizeUnit: string,
  baseUnit: string
): number | null {
  const perPackage = convert(size, sizeUnit, baseUnit);
  if (perPackage === null) return null;
  return amount * perPackage;
}
