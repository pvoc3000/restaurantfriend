// Purchase order shapes + money math, shared by the PO list and PO detail.
//
// Spec §4.8: the PO list is the Monday workflow surface (multi-select batch
// operations, totals row); PO detail preserves ordered-vs-received quantities
// with dual totals and price reconciliation.

import { priceDiffers as numericPriceDiffers } from "./invoiceExtraction";

export type PoStatus = "draft" | "sent" | "received" | "closed" | "void";

export const PO_STATUS_ORDER: PoStatus[] = [
  "draft",
  "sent",
  "received",
  "closed",
  "void",
];

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  received: "Received",
  closed: "Closed",
  void: "Void",
};

// Badge colours: draft is in-progress, sent is awaiting delivery, received is
// done, void/closed are inert.
export const PO_STATUS_CLASS: Record<PoStatus, string> = {
  draft: "border border-ink bg-white text-ink",
  sent: "border border-ink bg-[var(--rf-yellow-200)] text-ink",
  received: "border border-ink bg-[var(--rf-green-200)] text-ink",
  closed: "border border-neutral-300 bg-neutral-100 text-muted",
  void: "border border-neutral-300 bg-white text-faint",
};

export type PoLine = {
  id: string;
  vendor_item_id: string | null;
  // Snapshot of what was ordered — descriptions and prices drift, so the PO
  // keeps its own copy (schema 001) and history stays readable even if the
  // catalog row is later deleted.
  description: string | null;
  brand: string | null;
  product_id: string | null;
  package_desc: string | null;
  /** The ordering note printed on the vendor's copy (§4.9). Snapshotted from
   *  vendor_items.notes at generation (migration 015) and editable per line —
   *  striking it off one order leaves the catalog entry alone. Distinct from
   *  discrepancy_note, which is receiving's. */
  notes: string | null;
  qty_ordered: number;
  qty_received: number | null;
  unit_price: number | null;
  discrepancy_note: string | null;
  vendor_items: {
    id: string;
    price: number | null;
    /** The pack TYPE the vendor sells in — "CS", "EA". Distinct from the LINE's
     *  `package_desc` above, which since migration 013 is a composed structure
     *  ("12 × 32 oz"). See `packType`. */
    package_desc: string | null;
    /** The catalog's CURRENT SKU. The line above snapshotted it at generation,
     *  and the gap between them is the prompt to update the catalog after a
     *  vendor renumbers an item — see `skuAction` in lib/receiving. */
    product_id: string | null;
    /** This item's per-location price overrides (design rule 6) — rare, and
     *  filtered to the order's own location by `effectiveCatalogPrice`. The
     *  table's key is (vendor_item_id, location_id) with no surrogate id, and
     *  `price` is NOT NULL (001:166), so a row existing IS an override. */
    vendor_item_location_prices: {
      location_id: string;
      price: number;
    }[];
    // `category` is the item TYPE ("Dry Goods", "Frozen Goods" — schema 001's
    // own wording); it groups the vendor-facing PDF and leads the detail table.
    inventory_items: { id: string; name: string; category: string | null } | null;
  } | null;
};

/** A pack snapshot that is a package TYPE, not migration 013's composed structure. */
export function bareType(packageDesc: string | null): string | null {
  if (!packageDesc) return null;
  return packageDesc.includes("×") ? null : packageDesc;
}

/**
 * The pack TYPE for a line — what you say after a quantity ("2 CS"), and what
 * the vendor-facing PDF prints in its Pack column.
 *
 * The catalog's own type comes first. The line's snapshot is the fallback, but
 * ONLY when it's a bare type: FMP recorded "CS"/"EA" there and the migrated
 * history still carries it (measured 2026-07-28: 28 of 1,000 lines rely on
 * this), while migration 013 writes a COMPOSED label — "12 × 32 oz" — which
 * reads as nonsense after a number and is exactly what the vendor-facing
 * document is no longer supposed to print.
 */
export function packType(line: {
  package_desc: string | null;
  // Structural, not `Pick<PoLine, …>`: poProcessing's own row type joins a
  // narrower vendor_items, and this function reads exactly one field of it.
  vendor_items: { package_desc: string | null } | null;
}): string | null {
  return line.vendor_items?.package_desc ?? bareType(line.package_desc);
}

export type PurchaseOrder = {
  id: string;
  po_number: string;
  status: PoStatus;
  sent_via: string | null;
  order_date: string;
  delivery_date: string | null;
  notes: string | null;
  vendor_id: string;
  location_id: string;
  vendors: { id: string; name: string } | null;
};

/** What was ordered, at the price on the line. */
export function orderedTotal(lines: PoLine[]): number {
  return lines.reduce(
    (sum, l) => sum + Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
    0
  );
}

/**
 * What actually arrived. Lines not yet received (qty_received null) count as
 * zero — this total is "what's confirmed in the building", not a forecast.
 */
export function receivedTotal(lines: PoLine[]): number {
  return lines.reduce(
    (sum, l) => sum + Number(l.qty_received ?? 0) * Number(l.unit_price ?? 0),
    0
  );
}

/**
 * How many PACKAGES were ordered, across every line — the count of things that
 * should physically arrive, which is what you check a delivery against. In
 * packages of each line's own vendor item (units discipline, design rule 5),
 * so it sums a case and an each alike; that's the intended meaning here, since
 * the question is "how many items am I expecting off the truck".
 */
export function orderedQty(lines: PoLine[]): number {
  return lines.reduce((sum, l) => sum + Number(l.qty_ordered ?? 0), 0);
}

/** The same count for what actually arrived; unreceived lines count as zero. */
export function receivedQty(lines: PoLine[]): number {
  return lines.reduce((sum, l) => sum + Number(l.qty_received ?? 0), 0);
}

/**
 * Lines whose invoice price differs from the catalog price — the one-tap
 * "update catalog?" flow at receiving (spec §2 step 5).
 */
export function priceDiffers(line: PoLine): boolean {
  if (line.unit_price === null || !line.vendor_items) return false;
  const catalog = line.vendor_items.price;
  if (catalog === null) return false;
  return Number(catalog) !== Number(line.unit_price);
}

/**
 * What is still unresolved about an order, in the words the confirm will use.
 *
 * Closing means "received, reconciled and filed — done being worked on", which
 * is the meaning `closed` never had: the status existed in 001 and sorted and
 * badged correctly, but nothing routed you to it and nothing said what it
 * asserted, so it sat unused beside `received`.
 *
 * It deliberately reports rather than BLOCKS. The tempting version gates closing
 * on a full set of received quantities, no price mismatches and an invoice on
 * file — and then the order whose invoice never arrives is stuck in `received`
 * forever, which is how a status stops meaning anything. Naming what's loose and
 * letting the human close anyway keeps the judgement where it belongs.
 */
export function closeReadiness(
  lines: PoLine[],
  attachmentCount: number
): string[] {
  const caveats: string[] = [];
  const unreceived = lines.filter((l) => l.qty_received === null).length;
  if (unreceived > 0) {
    caveats.push(
      `${unreceived} ${unreceived === 1 ? "line has" : "lines have"} no received quantity`
    );
  }
  // The EPSILON comparison, not this file's exact `priceDiffers`. The receiving
  // screen's price button uses the epsilon, so a line it considers settled must
  // not still be named here — a confirm that contradicts the screen you just
  // finished working on teaches you to stop reading confirms.
  const differing = lines.filter(
    (l) =>
      l.unit_price !== null &&
      l.vendor_items !== null &&
      numericPriceDiffers(l.vendor_items.price, l.unit_price)
  ).length;
  if (differing > 0) {
    caveats.push(
      `${differing} ${differing === 1 ? "line's price differs" : "lines' prices differ"} from the catalog`
    );
  }
  if (attachmentCount === 0) caveats.push("no invoice or packing slip is attached");
  return caveats;
}

/** Closing is for an order that has arrived; void and closed are already inert. */
export function canClose(status: PoStatus): boolean {
  return status === "received" || status === "sent";
}

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
