// Shared shapes + formatting for the catalog admin screens (brief §D): the
// items list, item detail, and vendor detail. These are the general-purpose
// catalog surfaces — /cleanup stays a separate, problem-driven queue.

export type CatalogVendorItem = {
  /** FMP's pack structure, restored by migration 010 ("12 × 32 oz"). */
  pack_count?: number | null;
  pack_size?: number | null;
  pack_unit?: string | null;
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string | null;
  package_desc: string | null;
  package_content: number | null;
  price: number | null;
  notes: string | null;
  is_active: boolean;
  inventory_item_id: string | null;
  vendors: { id: string; name: string; is_active: boolean } | null;
};

export type CatalogItemLocation = {
  id: string;
  location_id: string;
  default_par: number | null;
  /** ISO weekdays we order this item at this location (schema 008). One of
   *  the four should-order conditions; empty = out of focus, still on guide. */
  order_days: number[];
  note: string | null;
  is_active: boolean;
  shop_sections: { display_name: string; sort_order: number } | null;
};

export type CatalogItem = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  note: string | null;
  is_active: boolean;
  inventory_item_locations: CatalogItemLocation[];
};

// The columns every catalog screen needs off vendor_items, including the
// vendor's own active flag (an item under a deactivated vendor is effectively
// unorderable — screens badge it rather than hiding it here).
export const VENDOR_ITEM_SELECT = `
  id, product_id, brand, description, package_desc, package_content, price,
  pack_count, pack_size, pack_unit,
  notes, is_active, inventory_item_id,
  vendors ( id, name, is_active )
`;

/**
 * Same columns, but `vendors!inner` so a query can add
 * `.eq("vendors.is_active", true)` and drop items belonging to deactivated
 * vendors entirely — the choice-list rule the favorites editor already follows.
 * Not for the vendor's own detail screen, where that filter would empty the
 * page whenever the vendor itself is inactive.
 */
export const VENDOR_ITEM_SELECT_ACTIVE_VENDOR = VENDOR_ITEM_SELECT.replace(
  "vendors (",
  "vendors!inner ("
);

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export function qty(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  // Pars and package contents are numerics; drop trailing zeros so a par of
  // 12.00 reads as 12 but 2.50 keeps its precision.
  return String(Number(value));
}

/**
 * Price per base unit — the $/oz comparison that drives the real vendor choice
 * when pack sizes differ (CLAUDE.md, domain cheat-sheet). Null when either side
 * is missing or the package content is zero.
 */
export function unitPrice(vi: {
  price: number | null;
  package_content: number | null;
}): number | null {
  if (vi.price === null || vi.package_content === null) return null;
  const content = Number(vi.package_content);
  if (content === 0) return null;
  return Number(vi.price) / content;
}

export function unitPriceLabel(vi: CatalogVendorItem, baseUnit: string) {
  const up = unitPrice(vi);
  if (up === null) return "—";
  // Sub-cent unit prices are common (grams, each-of-many), so show enough
  // precision to actually compare two vendors.
  const digits = up < 0.1 ? 4 : 2;
  return `$${up.toFixed(digits)}/${baseUnit}`;
}

/** One-line description of a vendor item for dense table cells. */
export function vendorItemLabel(vi: CatalogVendorItem) {
  return [vi.brand, vi.description].filter(Boolean).join(" · ") || "—";
}

/**
 * How a pack reads on the shelf: "12 × 32 oz", the way FileMaker recorded it
 * (UnitAmount × UnitSize UnitMeasure) and the way a packing slip is checked.
 *
 * Falls back to the base-unit total when the structure was never recorded —
 * 249 vendor items have no pack fields. What it must never do is print a
 * hardcoded "1 ×", which is what the guide did before migration 010: every
 * pack claimed to be a single unit, so a case of twelve read "1 × 24 lbs".
 */
export function packLabel(
  vi: {
    pack_count?: number | null;
    pack_size?: number | null;
    pack_unit?: string | null;
    package_content: number | null;
  },
  baseUnit: string
): string | null {
  if (vi.pack_size !== null && vi.pack_size !== undefined) {
    const count = vi.pack_count ?? 1;
    const unit = vi.pack_unit ?? baseUnit;
    return `${Number(count)} × ${Number(vi.pack_size)} ${unit}`;
  }
  if (vi.package_content === null) return null;
  return `${Number(vi.package_content)} ${baseUnit}`;
}
