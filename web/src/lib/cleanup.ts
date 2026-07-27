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

export type ProblemKind =
  | "no_package_content" // a favorite can't be converted into packages to order
  | "no_price" // a favorite can't be priced on the totals bar or a PO
  | "no_par"; // nothing to order up TO (lowest priority)

export const PROBLEM_ORDER: ProblemKind[] = [
  "no_package_content",
  "no_price",
  "no_par",
];

export const PROBLEM_LABEL: Record<ProblemKind, string> = {
  no_package_content: "No package content",
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
  if (favoritesMissingPrice(row).length > 0) problems.push("no_price");

  // par is still the item-location's own (migration 009 moved the per-weekday
  // overrides here too), so this check is unchanged.
  if (row.default_par === null) problems.push("no_par");

  return problems;
}
