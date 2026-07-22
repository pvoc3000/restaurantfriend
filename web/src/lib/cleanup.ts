// The cleanup checks (brief P1), in one place. The /cleanup page fetches rows
// and runs computeProblems() over them; the count burns down as Mark fixes the
// underlying data (it's all live — nothing imported from the audit sheet).

export type ProblemKind =
  | "no_default" // 1. no default vendor item
  | "default_inactive" // 2. default vendor item (or its vendor) is inactive
  | "no_package_content" // 3. default vendor item has no package_content
  | "no_price" // 4. default vendor item has null/zero price
  | "no_par"; // 5. no default par (lowest priority)

export const PROBLEM_ORDER: ProblemKind[] = [
  "no_default",
  "default_inactive",
  "no_package_content",
  "no_price",
  "no_par",
];

export const PROBLEM_LABEL: Record<ProblemKind, string> = {
  no_default: "No default vendor item",
  default_inactive: "Default vendor item inactive",
  no_package_content: "No package content",
  no_price: "No price",
  no_par: "No par",
};

// The shape the page selects from inventory_item_locations. vendor_items is the resolved
// default (may be null); nested vendors carries the vendor's active flag.
export type CleanupRow = {
  id: string; // inventory_item_locations.id
  location_id: string;
  inventory_item_id: string;
  default_par: number | null;
  default_vendor_item_id: string | null;
  inventory_items: {
    id: string;
    name: string;
    category: string | null;
    base_unit: string;
  };
  vendor_items: {
    id: string;
    description: string | null;
    brand: string | null;
    package_desc: string | null;
    package_content: number | null;
    price: number | null;
    is_active: boolean;
    vendors: { id: string; name: string; is_active: boolean } | null;
  } | null;
};

export function computeProblems(row: CleanupRow): ProblemKind[] {
  const problems: ProblemKind[] = [];
  const vi = row.vendor_items;

  if (!row.default_vendor_item_id || !vi) {
    // A dangling id (default set but the row didn't resolve) is treated as
    // "no default" — the fix is the same: assign a valid one.
    problems.push("no_default");
  } else {
    if (!vi.is_active || (vi.vendors && !vi.vendors.is_active)) {
      problems.push("default_inactive");
    }
    if (vi.package_content === null) problems.push("no_package_content");
    if (vi.price === null || Number(vi.price) === 0) problems.push("no_price");
  }

  if (row.default_par === null) problems.push("no_par");

  return problems;
}
