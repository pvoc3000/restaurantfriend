// Shared shapes + formatting for the catalog admin screens (brief §D): the
// items list, item detail, and vendor detail. These are the general-purpose
// catalog surfaces — /cleanup stays a separate, problem-driven queue.

import { packageContent, unitFamily } from "./units";

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
 * How many base units one of this vendor item's packages holds — the number
 * that converts between what you count and what you order.
 *
 * `package_content` when it's set, and otherwise derived from the pack
 * structure (Mark, 2026-07-29: a line should divide "if the vendor item has a
 * package size"). Content is a stored total that nobody can type any more, so
 * treating it as the only source made a line's arithmetic depend on whether
 * someone had filled in a cache column rather than on whether the package size
 * is actually known. 13 item+vendor pairs have the size and not the total.
 *
 * Null when there's no size either, or when the size can't reach the base unit
 * — 12 × 6 oz of raspberries against a base unit of `ea` is not a conversion,
 * it's a missing fact about how many berries are in a clamshell.
 */
export function packageDivisor(
  vi: {
    package_content: number | null;
    pack_count?: number | null;
    pack_size?: number | null;
    pack_unit?: string | null;
  },
  baseUnit: string
): number | null {
  const stored = Number(vi.package_content);
  if (vi.package_content !== null && stored > 0) return stored;
  return derivedPackContent(vi, baseUnit);
}

/**
 * The base-unit total a pack structure implies — "12 × 16 oz" against an `oz`
 * base unit is 192 — or null when it can't be computed at all.
 *
 * Null has two causes and they're different problems: no pack size recorded
 * (nothing to compute from), or a pack unit that can't reach the base unit. The
 * second is the interesting one — a case of 12 × 16 oz bottles counted in `ea`
 * holds 12, and no unit arithmetic gets there from ounces, because the missing
 * fact is "one bottle is one each" and that lives nowhere. Those are the rows
 * where the total has to be typed by a human.
 *
 * Used both to fill a missing total (packageDivisor) and to keep a stored one
 * honest when the pack is edited.
 */
export function derivedPackContent(
  pack: {
    pack_count?: number | string | null;
    pack_size?: number | string | null;
    pack_unit?: string | null;
  },
  baseUnit: string
): number | null {
  const { pack_size: size, pack_count: count, pack_unit: packUnit } = pack;
  if (size === null || size === undefined || size === "") return null;

  // A MISSING pack unit is not the base unit (Mark, 2026-07-29, after the bulk
  // recalc). UNFI's rice milk is "8 x 64" with no unit on a `lbs` item, and its
  // siblings are 12 x 32 oz holding 24 lbs — so those are 64-OUNCE cartons worth
  // 32 lbs, and assuming `lbs` gives 512, sixteen times high. Refuse instead:
  // the honest answer is that nobody recorded the unit and only a human knows.
  //
  // The exception is a COUNT base unit, where the multiplication is unit-free —
  // "1 x 24" on an `ea` item is 24 each however you read it.
  //
  // This guard lives here rather than at the call sites so every reader shares
  // it: the guide's par line, the Recalc button, the cleanup check and
  // recalc-package-content.mjs all stop guessing at the same moment.
  const named = packUnit?.trim();
  if (!named && unitFamily(baseUnit) !== "count") return null;

  const derived = packageContent(
    Number(count ?? 1),
    Number(size),
    // `||`, not `??`: `named` is already trimmed, so a whitespace-only unit is
    // "" — not null — and would otherwise be handed to packageContent as a unit
    // it can't resolve, losing a count item's content for a stray space.
    named || baseUnit,
    baseUnit
  );
  if (derived === null || !Number.isFinite(derived) || derived <= 0) return null;
  return derived;
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
  divisor: number | null | undefined,
  packageDesc?: string | null
): string | null {
  if (par === null || par === undefined) return null;
  if (divisor === null || divisor === undefined) return null;
  const content = Number(divisor);
  // Also catches NaN, which a `<= 0` test would let through.
  if (!(content > 0)) return null;
  const packages = Number(par) / content;
  if (!Number.isFinite(packages)) return null;
  const unit = packageDesc?.trim() || "pkg";
  if (packages > 0 && packages < 0.05) return `<0.1 ${unit}`;
  // Number() drops the trailing zero toFixed leaves, so 3.0 reads "3".
  return `${Number(packages.toFixed(1))} ${unit}`;
}

/**
 * `vendors.order_type` — a CLOSED set (migration 001's own check constraint),
 * unlike `vendor_type`, which is free text. Labelling it here is not the
 * "zero business hardcoding" rule's business (CLAUDE.md): these four values
 * are schema, not org configuration, the same way `PO_STATUS_LABEL` labels the
 * purchase_orders.status constraint.
 */
export const ORDER_TYPE_LABEL: Record<string, string> = {
  email_po: "Email PO",
  online: "Online",
  in_person: "In person",
  none: "None — directory only",
};

export const ORDER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "email_po", label: "Email PO" },
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "none", label: "None — directory only" },
];
