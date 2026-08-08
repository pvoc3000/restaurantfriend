/**
 * What an item sells for — production brief decision 10.
 *
 * A three-tier cascade, mirroring `vendor_items.price` →
 * `vendor_item_location_prices` exactly, because it is the same shape of
 * problem: one number that is usually the same everywhere and occasionally
 * isn't.
 *
 *   item-location override   the one-off exception (FMP's Price Overrides, 17 rows)
 *   location grid override   this shop's version of a grid cell (EVENT's 5)
 *   org grid                 (price class × tier) → price, ~40 cells
 *
 * MEASURED, which is why the org grid exists at all: FileMaker kept 125 rows —
 * 40 (class, tier) cells copied across four locations — and DF01, DF02 and DF03
 * agree on ALL 40. Only EVENT differs, on its five Regular-class cells. Those
 * per-location copies existed because FileMaker had no inheritance: three shops
 * hand-maintaining the same forty numbers. Here a tier change reprices the
 * whole menu in one edit, which is the point of having tiers.
 */

export type PriceGridCell = {
  id: string;
  price_class: string;
  price_tier: string;
  price: number | null;
  class_sort: number | null;
  tier_sort: number | null;
};

export type PriceGridOverride = {
  grid_id: string;
  location_id: string;
  price: number | null;
};

export type PricedItem = {
  price_class: string | null;
  price_tier: string | null;
};

export type ItemPriceOverride = {
  location_id: string;
  price_override: number | null;
};

/** Where a price came from — so a screen can say, rather than just show. */
export type PriceSource = "item" | "location" | "org" | "none";

export type ResolvedPrice = {
  price: number | null;
  source: PriceSource;
  /** The grid cell this item reads, whether or not it won. */
  cell: PriceGridCell | null;
};

export function resolveItemPrice(
  item: PricedItem,
  locationId: string | null,
  grid: PriceGridCell[],
  gridOverrides: PriceGridOverride[],
  itemOverrides: ItemPriceOverride[]
): ResolvedPrice {
  const cell = findCell(item, grid);

  // 1. The item's own price at this shop. Beats everything — it is the reason
  //    the column exists, and FMP's own portal was called "Price Overrides".
  if (locationId) {
    const own = itemOverrides.find((o) => o.location_id === locationId);
    if (own && own.price_override !== null) {
      return { price: Number(own.price_override), source: "item", cell };
    }
  }

  if (!cell) return { price: null, source: "none", cell: null };

  // 2. This shop's version of the grid cell.
  if (locationId) {
    const override = gridOverrides.find(
      (o) => o.grid_id === cell.id && o.location_id === locationId
    );
    if (override && override.price !== null) {
      return { price: Number(override.price), source: "location", cell };
    }
  }

  // 3. The org grid.
  if (cell.price === null) return { price: null, source: "none", cell };
  return { price: Number(cell.price), source: "org", cell };
}

/**
 * The grid cell an item reads. Both halves must match, and an item missing
 * either has NO price rather than falling back to some default cell — 19 of
 * the 307 items carry neither, and inventing a tier for them would put a
 * confident wrong number on a menu.
 */
export function findCell(item: PricedItem, grid: PriceGridCell[]): PriceGridCell | null {
  if (!item.price_class || !item.price_tier) return null;
  const eq = (a: string | null, b: string | null) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  return (
    grid.find((c) => eq(c.price_class, item.price_class) && eq(c.price_tier, item.price_tier)) ??
    null
  );
}

/**
 * Margin as a fraction of PRICE, not of cost.
 *
 * The distinction matters and the two are easy to confuse: an item costing
 * $1 and selling for $4 has a 75% margin and a 300% markup. FileMaker computed
 * `costToPriceRatio`, which is neither, and a bakery talks in margin.
 *
 * Null whenever either side is unknown — a margin computed against a cost that
 * is really a lower bound (because something in the BOM is unpriced) would be
 * an upper bound wearing a precise number's clothes.
 */
export function margin(cost: number | null, price: number | null): number | null {
  if (cost === null || price === null || price === 0) return null;
  return (price - cost) / price;
}

/** "62%", or an em dash. */
export function formatMargin(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Order the grid the way a menu reads, not alphabetically (Tier 10 before Tier 2). */
export function sortGrid(grid: PriceGridCell[]): PriceGridCell[] {
  return grid.slice().sort((a, b) => {
    const ca = a.class_sort ?? 999, cb = b.class_sort ?? 999;
    if (ca !== cb) return ca - cb;
    if (a.price_class !== b.price_class) return a.price_class.localeCompare(b.price_class);
    const ta = a.tier_sort ?? 999, tb = b.tier_sort ?? 999;
    if (ta !== tb) return ta - tb;
    return a.price_tier.localeCompare(b.price_tier);
  });
}

/** The distinct classes and tiers present, in menu order — the grid's axes. */
export function gridAxes(grid: PriceGridCell[]): { classes: string[]; tiers: string[] } {
  const sorted = sortGrid(grid);
  const classes: string[] = [];
  const tiers: string[] = [];
  for (const c of sorted) {
    if (!classes.includes(c.price_class)) classes.push(c.price_class);
  }
  for (const c of sorted.slice().sort((a, b) => (a.tier_sort ?? 999) - (b.tier_sort ?? 999))) {
    if (!tiers.includes(c.price_tier)) tiers.push(c.price_tier);
  }
  return { classes, tiers };
}
