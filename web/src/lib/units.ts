// Unit conversion for the package-content editor (brief P2 #2).
//
// package_content is "how much of the inventory item's base_unit is in one
// package of the vendor item" (spec §4.1 — 50 = 50 lbs per bag). The editor
// lets Mark type amount × size + unit ("24 × 32 oz") and converts the total
// into the item's base_unit. Conversion only works within a family; crossing
// families (weigh a count, etc.) returns null so the UI can warn.

export type UnitFamily = "mass" | "volume" | "count";

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
};

export function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\.$/, "");
}

export function unitFamily(unit: string): UnitFamily | null {
  return UNITS[normalizeUnit(unit)]?.family ?? null;
}

/** The size-dropdown options, grouped by the family so the UI can label them. */
export const UNIT_OPTIONS: { value: string; label: string; family: UnitFamily }[] = [
  ["ea", "count"],
  ["dozen", "count"],
  ["oz", "mass"],
  ["lbs", "mass"],
  ["kg", "mass"],
  ["g", "mass"],
  ["floz", "volume"],
  ["qt", "volume"],
  ["gal", "volume"],
  ["l", "volume"],
  ["ml", "volume"],
]
  .map(([value]) => value as string)
  .map((value) => ({ value, label: UNITS[value].label, family: UNITS[value].family }));

/**
 * Convert `amount` of `fromUnit` into `toUnit`. Returns null when the units are
 * in different families (incompatible) or either unit is unknown.
 */
export function convert(amount: number, fromUnit: string, toUnit: string): number | null {
  const from = UNITS[normalizeUnit(fromUnit)];
  const to = UNITS[normalizeUnit(toUnit)];
  if (!from || !to || from.family !== to.family) return null;
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
