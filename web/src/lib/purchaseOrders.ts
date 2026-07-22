// Purchase order shapes + money math, shared by the PO list and PO detail.
//
// Spec §4.8: the PO list is the Monday workflow surface (multi-select batch
// operations, totals row); PO detail preserves ordered-vs-received quantities
// with dual totals and price reconciliation.

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
  draft: "bg-blue-100 text-blue-800",
  sent: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
  closed: "bg-neutral-200 text-neutral-700",
  void: "bg-neutral-200 text-neutral-500",
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
  qty_ordered: number;
  qty_received: number | null;
  unit_price: number | null;
  discrepancy_note: string | null;
  vendor_items: {
    id: string;
    price: number | null;
    inventory_items: { id: string; name: string } | null;
  } | null;
};

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
 * Lines whose invoice price differs from the catalog price — the one-tap
 * "update catalog?" flow at receiving (spec §2 step 5).
 */
export function priceDiffers(line: PoLine): boolean {
  if (line.unit_price === null || !line.vendor_items) return false;
  const catalog = line.vendor_items.price;
  if (catalog === null) return false;
  return Number(catalog) !== Number(line.unit_price);
}

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
