// The receiving screen's arithmetic and judgements, kept away from React so
// they can be reasoned about — and tested — on their own.
//
// Nothing here writes. Every function answers a question the screen asks about
// a line ("should this price change?", "what would a bulk receive fill?"), and
// the caller does the writing.

import {
  priceDiffers as numericPriceDiffers,
  type InvoiceExtraction,
} from "./invoiceExtraction";
import type { LineMatch } from "./invoiceMatch";
import { effectiveCatalogPrice, type PoLine } from "./purchaseOrders";

/**
 * Should `target` become `next`?
 *
 * NOT `invoiceExtraction.priceDiffers`, which answers a different question —
 * "are these two READINGS the same" — and so returns false when either side is
 * null. Here a null target is precisely a difference: a line ordered with no
 * price, billed at $12.40, is exactly the line that needs the button, and so is
 * a catalog row whose price was never filled in (`/cleanup`'s `no_price`
 * population). A null `next` is still nothing to offer.
 *
 * And NOT `purchaseOrders.priceDiffers`, whose exact `!==` would keep offering
 * a button for float noise no one can see.
 */
export function needsUpdate(target: number | null, next: number | null): boolean {
  if (next === null) return false;
  if (target === null) return true;
  return numericPriceDiffers(next, target);
}

/**
 * Re-exported, not redefined. `closeReadiness` needs the same answer, and the
 * one time these two disagreed the Finalize confirm named a price the screen
 * offered no way to settle (BakeMark 112-181120-01, 2026-07-31).
 */
export { effectiveCatalogPrice };

export type PriceAction =
  | {
      stage: "po";
      /** What to write. */
      price: number;
      /** What's there now, for the "$34.20 → $35.10" label. */
      current: number | null;
      /** The invoice's own arithmetic doesn't close — wear the `?`. */
      uncertain: boolean;
    }
  | {
      stage: "vendor";
      price: number;
      current: number | null;
      /** True → write this location's `vendor_item_location_prices` row;
       *  false → write `vendor_items.price`. */
      hasOverride: boolean;
      uncertain: false;
    };

/**
 * The two-stage price button — and it needs NO staging state, because it is a
 * function of the data:
 *
 *  1. the invoice disagrees with the ORDER   → "Update PO"
 *  2. the order disagrees with the CATALOG   → "Update vendor"
 *  3. neither                                 → no button
 *
 * Taking stage 1 makes the order agree with the invoice, so the very next
 * render finds stage 2 by itself. With no invoice read, stage 1 can't fire and
 * stage 2 alone does the work of the price-differs band this replaces.
 *
 * It terminates. `unit_price` is `numeric(10,2)`, so writing a derived
 * 3.72666… stores 3.73, and |3.7267 − 3.73| = 0.0033 against a strict
 * `> 0.005` test — stage 1 cannot re-arm after it's been taken.
 */
export function priceAction(
  line: PoLine,
  match: LineMatch | undefined,
  locationId: string
): PriceAction | null {
  const invoicePrice = match?.unitPrice ?? null;
  const linePrice = line.unit_price === null ? null : Number(line.unit_price);

  if (needsUpdate(linePrice, invoicePrice)) {
    return {
      stage: "po",
      price: invoicePrice!,
      current: linePrice,
      uncertain: match?.priceUncertain ?? false,
    };
  }

  const { price: catalog, hasOverride } = effectiveCatalogPrice(line, locationId);
  if (needsUpdate(catalog, linePrice)) {
    return {
      stage: "vendor",
      price: linePrice!,
      current: catalog,
      hasOverride,
      uncertain: false,
    };
  }

  return null;
}

/**
 * The catalog's SKU disagrees with the line's — offer to fix the catalog.
 *
 * The second half of a manual match, and the half that matters next month.
 * Vendors renumber items (BakeMark billed 50021 against the 08779 we ordered
 * under, and renumbered two others on the same invoice), so pairing this
 * order's line by hand settles today's delivery while leaving the catalog stale
 * — and the next order arrives needing the same manual step.
 *
 * Same two-stage shape as `priceAction`, and for the same reason: the order and
 * the catalog are different records, and changing one is not consent to change
 * the other.
 */
export function skuAction(
  line: PoLine
): { from: string | null; to: string } | null {
  const vi = line.vendor_items;
  if (!vi || !line.product_id) return null;
  const a = (vi.product_id ?? "").trim().toUpperCase();
  const b = line.product_id.trim().toUpperCase();
  if (a === b) return null;
  return { from: vi.product_id, to: line.product_id };
}

/**
 * How the received box reads at arm's length — the order guide's three states,
 * plus the one receiving adds.
 *
 * untouched  white, heavy border   nobody has looked at this line yet
 * zero       stop (red)            an explicit no: nothing arrived
 * short      mark (yellow)         less than ordered — needs a look
 * full/over  go (green)            settled
 *
 * Untouched and zero are DIFFERENT and must stay that way (the guide's
 * three-state rule): "I counted nothing" is a measurement, "I haven't counted"
 * is not.
 */
export function receivedClass(ordered: number, received: number | null): string {
  if (received === null) return "border-2 border-ink bg-white";
  const got = Number(received);
  if (got === 0) return "border border-ink bg-stop";
  if (got < Number(ordered)) return "border border-ink bg-mark-fill";
  return "border border-ink bg-go";
}

/**
 * What a bulk receive would fill — and only that.
 *
 * Lines with a quantity ALREADY recorded are left alone, the same rule the PO
 * list's batch mark-received follows: a short case someone counted is a
 * measurement, and a bulk button must not overwrite one with a machine's
 * reading of a photograph.
 *
 * With an invoice it fills MATCHED lines from the invoice. Lines the invoice
 * doesn't bill are deliberately not filled from the ordered quantity — that
 * would quietly assert that something arrived which nobody billed us for. Those
 * keep their own per-row "Ordered" chip.
 */
export function fillable(
  lines: PoLine[],
  matchByLine: Map<string, LineMatch>,
  hasExtraction: boolean
): { line: PoLine; qty: number }[] {
  const out: { line: PoLine; qty: number }[] = [];
  for (const line of lines) {
    if (line.qty_received !== null) continue;
    if (hasExtraction) {
      const qty = matchByLine.get(line.id)?.invoice?.qty;
      if (qty !== null && qty !== undefined) out.push({ line, qty: Number(qty) });
    } else {
      out.push({ line, qty: Number(line.qty_ordered) });
    }
  }
  return out;
}

/**
 * A quantity with its pack — "2 CS" rather than "2" (Mark's complaint #6: the
 * two carry different amounts of information). The pack comes from `packType`,
 * never from the line's own composed `package_desc`.
 */
export function qtyLabel(n: number | null, pack: string | null): string {
  if (n === null) return "—";
  // String(Number) already drops a trailing ".0" — numeric(10,2) arrives from
  // PostgREST as a JSON number, so 1.00 is 1 by the time it gets here.
  const text = String(Number(n));
  return pack ? `${text} ${pack}` : text;
}

/**
 * The order the rows are read in — deliberately PO detail's default sort
 * (category, then catalog name, then description, then brand) so the two
 * screens describing the same order don't disagree about its shape.
 *
 * Invoice order is tempting for someone standing there holding paper, but the
 * extraction's order isn't stable across reads and the lines the invoice
 * doesn't carry have no place in it.
 */
export function receivingOrder(lines: PoLine[]): PoLine[] {
  const key = (l: PoLine) => [
    l.vendor_items?.inventory_items?.category ?? "",
    l.vendor_items?.inventory_items?.name ?? l.description ?? "",
    l.description ?? "",
    l.brand ?? "",
  ];
  return [...lines].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const c = ka[i].localeCompare(kb[i], undefined, { numeric: true });
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** The most recently READ attachment — the invoice this screen reconciles
 *  against. An order can carry several documents (an invoice and a packing
 *  slip, a corrected re-send), and the one you just had read is the one you
 *  meant. */
export function latestRead<T extends { extraction: InvoiceExtraction | null; extracted_at: string | null }>(
  attachments: T[]
): T | null {
  const read = attachments.filter((a) => a.extraction !== null);
  if (read.length === 0) return null;
  return read.reduce((latest, a) =>
    (a.extracted_at ?? "") > (latest.extracted_at ?? "") ? a : latest
  );
}
