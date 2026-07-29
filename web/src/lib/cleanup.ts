// The cleanup checks (brief P1), in one place. The /cleanup page fetches rows
// and runs computeProblems() over them; the count burns down as Mark fixes the
// underlying data (it's all live — nothing imported from the audit sheet).
//
// Rewritten 2026-07-23 to ask about FAVORITES rather than the default vendor
// item. Until migration 008 the guide resolved a line through
// `inventory_item_locations.default_vendor_item_id`, so checking that field
// was checking the thing the guide would emit. It no longer reads it at all —
// the guide is favorites plus the active cascade — which made two of the five
// checks measure nothing (`no_default` was 89% false alarms, `default_inactive`
// 64%: the flagged item already had a healthy favorite and ordered fine) and
// pointed the other two at the wrong vendor item, since count mode and the
// vendor totals use each FAVORITE's package content and price, not the
// default's. Migration 012 then dropped the column outright.

import { derivedPackContent } from "./catalog";
import { unitFamily } from "./units";

export type ProblemKind =
  | "no_package_content" // a favorite can't be converted into packages to order
  | "stale_package_content" // a favorite's content contradicts its own pack
  | "no_price" // a favorite can't be priced on the totals bar or a PO
  | "no_par"; // nothing to order up TO (lowest priority)

export const PROBLEM_ORDER: ProblemKind[] = [
  "no_package_content",
  "stale_package_content",
  "no_price",
  "no_par",
];

export const PROBLEM_LABEL: Record<ProblemKind, string> = {
  no_package_content: "No package content",
  stale_package_content: "Package content doesn't match the pack",
  no_price: "No price",
  no_par: "No par",
};

/**
 * One of the item-location's favorites, already narrowed to the ones the guide
 * can actually emit — an inactive vendor item or a deactivated vendor drops out
 * of the active cascade, so its missing price is nobody's problem.
 */
export type CleanupFavorite = {
  id: string; // vendor_items.id
  description: string | null;
  brand: string | null;
  package_desc: string | null;
  package_content: number | null;
  pack_count: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  price: number | null;
  vendor_name: string | null;
};

// The shape the page selects from inventory_item_locations, plus the favorites
// gathered for it in a second query.
export type CleanupRow = {
  id: string; // inventory_item_locations.id
  location_id: string;
  inventory_item_id: string;
  default_par: number | null;
  inventory_items: {
    id: string;
    name: string;
    category: string | null;
    base_unit: string;
  };
  favorites: CleanupFavorite[];
};

/** Favorites the guide would emit but can't convert into packages to order. */
export function favoritesMissingContent(row: CleanupRow): CleanupFavorite[] {
  return row.favorites.filter((f) => f.package_content === null);
}

/**
 * Favorites whose stored content contradicts the pack it's supposed to be the
 * total of. Two shapes, one cause — the two were written at different times and
 * nothing reconciled them:
 *
 *  - the pack CONVERTS to the base unit and the answer disagrees with what's
 *    stored (12 × 32 oz is 384 oz, not 192);
 *  - the pack's unit CAN'T reach the base unit, and the stored total is exactly
 *    the pack's two numbers multiplied with the units thrown away. A 12 × 16 oz
 *    case counted in `ea` holding "192" is that: 12 × 16 with the oz ignored.
 *    It's what a base-unit change leaves behind, and what the original
 *    migration did wholesale.
 *
 * The second test is deliberately the unit-blind PRODUCT and not merely
 * "these units don't match", because that would never clear. The right answer
 * for that case is 12 — one bottle is one each — and no arithmetic can derive
 * it, so a check that fired on the unit mismatch alone would pin the row to the
 * queue forever however Mark fixed it. Firing on the product means correcting
 * the number resolves it, which is what a burn-down queue has to do.
 *
 * Only fires when a content IS stored — a missing one is `no_package_content`,
 * a different and more common problem. Missing pack structure isn't flagged
 * either: nothing to contradict.
 *
 * The safety net for every write path the vendor item screen doesn't cover —
 * a base_unit edit on the inventory item, a SQL-editor change, the migration.
 */
export function favoritesWithStaleContent(row: CleanupRow): CleanupFavorite[] {
  const baseUnit = row.inventory_items.base_unit;
  return row.favorites.filter((f) => {
    if (f.package_content === null || !(Number(f.package_content) > 0)) return false;
    if (f.pack_size === null || f.pack_size === undefined) return false;
    const content = Number(f.package_content);
    const derived = derivedPackContent(f, baseUnit);

    if (derived === null) {
      // Not convertible. A bare "1 × 500" names no unit, so it asserts nothing.
      const packUnit = f.pack_unit?.trim();
      if (!packUnit) return false;
      const family = unitFamily(packUnit);
      if (family === null || family === unitFamily(baseUnit)) return false;
      const unitBlind = Number(f.pack_count ?? 1) * Number(f.pack_size);
      return near(content, unitBlind);
    }

    return !near(content, derived);
  });
}

/** Equal allowing for float wobble and the column's numeric(10,3) rounding. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.001);
}

/** Favorites the guide would emit but can't price. */
export function favoritesMissingPrice(row: CleanupRow): CleanupFavorite[] {
  return row.favorites.filter((f) => f.price === null || Number(f.price) === 0);
}

export function computeProblems(row: CleanupRow): ProblemKind[] {
  const problems: ProblemKind[] = [];

  // An item-location with NO favorites isn't a defect: an empty day set is how
  // you take something out of focus while keeping it orderable (Mark,
  // 2026-07-22). So these only fire on favorites that actually exist.
  if (favoritesMissingContent(row).length > 0) problems.push("no_package_content");
  if (favoritesWithStaleContent(row).length > 0) problems.push("stale_package_content");
  if (favoritesMissingPrice(row).length > 0) problems.push("no_price");

  // par is still the item-location's own (migration 009 moved the per-weekday
  // overrides here too), so this check is unchanged.
  if (row.default_par === null) problems.push("no_par");

  return problems;
}
