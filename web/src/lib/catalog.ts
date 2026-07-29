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
 * The house label format: slots joined with " // " (Mark, 2026-07-29 — "we use
 * this format a lot and will probably continue to do so in other places").
 * The PO PDF's line text is the same shape (§4.9), one slot filled differently.
 *
 * Empty slots collapse rather than leaving "Flour //  // CS" — a separator with
 * nothing on one side reads as missing data instead of an absent field. Null
 * when every slot is empty, so callers can render their own placeholder.
 */
export function slashLabel(
  ...parts: (string | null | undefined)[]
): string | null {
  const kept = parts
    .map((p) => p?.trim())
    .filter((p): p is string => p !== undefined && p !== "");
  return kept.length > 0 ? kept.join(" // ") : null;
}

/**
 * What to call a vendor item at the top of its own screen.
 *
 * The vendor's own description wins when there is one (Mark, 2026-07-29): it's
 * how THEY name the product, which is what you're checking when you're looking
 * at their record, and it's usually more specific than anything we could
 * assemble. Same reasoning puts it first on the PO line (§4.9).
 *
 * Failing that, compose the house format from what we do know —
 * "Flour, Cake // Giustos // 1 × 50 lbs" — so the record still names itself.
 * Our item name leads that form because it's the anchor the other two slots
 * distinguish: brand and pack are what tell this source from the others.
 *
 * Not stored and not editable — a title you could type would just be
 * `description` again, and two boxes writing one column is how they end up
 * disagreeing.
 *
 * Null only when there's no description, item, brand or pack, which is a vendor
 * item with nothing in it but a vendor.
 */
export function vendorItemTitle(
  vi: {
    description: string | null;
    brand: string | null;
    package_desc: string | null;
    pack_count?: number | null;
    pack_size?: number | null;
    pack_unit?: string | null;
    package_content: number | null;
  },
  itemName: string | null | undefined,
  baseUnit: string
): string | null {
  const described = vi.description?.trim();
  if (described) return described;
  // packLabel already falls back to the base-unit total, so this only reaches
  // package_desc ("CS") when there's no structure and no content either.
  const pack = packLabel(vi, baseUnit) ?? vi.package_desc;
  return slashLabel(itemName, vi.brand, pack);
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

/**
 * Par restated in one vendor item's own packages — "3 CS" from a par of 576 oz
 * against a 192 oz case.
 *
 * Par is a fact about the SHELF and stays in base units (migration 009), but the
 * order box counts PACKAGES, so every line was asking Mark to do the division in
 * his head. The divisor is already on the row, so this costs no query and each
 * line answers in the pack it actually sells: 576 oz reads "3 CS" against a
 * 12 × 16 oz case and "2 CS" against a 24 × 12 oz one. Both are true, which is
 * why this belongs per line rather than once per item — half of all live pars
 * sit on items whose vendors disagree on pack size.
 *
 * Deliberately NOT rounded up. 88% of live pars divide exactly, so most rows
 * read clean anyway, and the tail is mostly intentional half-cases (a par of 96
 * against a 192 oz case is "0.5 CS", not "1 CS"). Rounding up would overstate a
 * par by up to a full package on exactly the rows where the number is working
 * hardest, and vendor minimums get decided in whole cases. Quotients under 0.05
 * read "<0.1" rather than "0", which would look like "don't order any".
 */
export function parPackageLabel(
  par: number | null | undefined,
  packageContent: number | null | undefined,
  packageDesc?: string | null
): string | null {
  if (par === null || par === undefined) return null;
  if (packageContent === null || packageContent === undefined) return null;
  const content = Number(packageContent);
  // Also catches NaN, which a `<= 0` test would let through.
  if (!(content > 0)) return null;
  const packages = Number(par) / content;
  if (!Number.isFinite(packages)) return null;
  const unit = packageDesc?.trim() || "pkg";
  if (packages > 0 && packages < 0.05) return `<0.1 ${unit}`;
  // Number() drops the trailing zero toFixed leaves, so 3.0 reads "3".
  return `${Number(packages.toFixed(1))} ${unit}`;
}
