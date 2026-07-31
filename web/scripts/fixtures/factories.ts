// Line builders for the fixtures. Everything defaults to the boring case so a
// test only has to say what it's actually about.

import type { InvoiceLine } from "../../src/lib/invoiceExtraction";
import type { PoLine } from "../../src/lib/purchaseOrders";

let seq = 0;

export function poLine(over: Partial<PoLine> = {}): PoLine {
  seq += 1;
  return {
    id: `po-line-${seq}`,
    vendor_item_id: `vi-${seq}`,
    description: null,
    brand: null,
    product_id: null,
    package_desc: null,
    notes: null,
    qty_ordered: 1,
    qty_received: null,
    unit_price: null,
    discrepancy_note: null,
    vendor_items: null,
    ...over,
  };
}

/** A PO line carrying a catalog row — the common case, since almost every line
 *  is generated from one. */
export function withCatalog(
  line: PoLine,
  catalog: {
    price?: number | null;
    package_desc?: string | null;
    name?: string;
    category?: string | null;
    overrides?: { location_id: string; price: number }[];
  } = {}
): PoLine {
  return {
    ...line,
    vendor_items: {
      id: `vi-${line.id}`,
      price: catalog.price ?? null,
      package_desc: catalog.package_desc ?? null,
      vendor_item_location_prices: catalog.overrides ?? [],
      inventory_items: {
        id: `item-${line.id}`,
        name: catalog.name ?? "An item",
        category: catalog.category ?? null,
      },
    },
  };
}

export function invoiceLine(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    product_id: null,
    description: "",
    qty: null,
    unit_price: null,
    extended: null,
    pack: null,
    ...over,
  };
}
