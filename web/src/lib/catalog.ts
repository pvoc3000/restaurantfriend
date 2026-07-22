// Shared shapes + formatting for the catalog admin screens (brief §D): the
// items list, item detail, and vendor detail. These are the general-purpose
// catalog surfaces — /cleanup stays a separate, problem-driven queue.

export type CatalogVendorItem = {
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
  default_vendor_item_id: string | null;
  note: string | null;
  is_active: boolean;
  shop_sections: { display_name: string; sort_order: number } | null;
  vendor_items: CatalogVendorItem | null;
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
  notes, is_active, inventory_item_id,
  vendors ( id, name, is_active )
`;

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
