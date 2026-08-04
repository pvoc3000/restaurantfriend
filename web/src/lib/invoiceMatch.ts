// Line up what the invoice says against what the order says.
//
// This is the piece that decides whether invoice OCR is useful or a toy, and
// the reason it's tractable at all is `product_id`: distributor invoices print
// the supplier's own SKU on every line, and a purchase order line SNAPSHOTS
// that same value at generation (migration 013). So the primary pass is an
// exact join, not fuzzy matching — a solved problem rather than a research one.
//
// Description similarity exists only for the lines that have no printed SKU.
// It is deliberately conservative: an unmatched line shown as "couldn't match
// this" is a small annoyance, while a WRONG match silently proposes the wrong
// quantity against the wrong product, which is the one outcome worth designing
// against.

import type { PoLine } from "./purchaseOrders";
import {
  invoiceUnitPrice,
  printedPriceDisagrees,
  priceDiffers,
  qtyDiffers,
  type InvoiceLine,
} from "./invoiceExtraction";

export type LineMatch = {
  line: PoLine;
  invoice: InvoiceLine | null;
  /** How it was matched — shown, because "we guessed" earns less trust. */
  by: "product_id" | "description" | null;
  /** Invoice quantity differs from what's been received on the line. */
  qtyDiffers: boolean;
  /** Invoice price differs from what the order says it costs. */
  priceDiffers: boolean;
  /** The per-unit price in the order's terms — see `invoiceUnitPrice`. */
  unitPrice: number | null;
  /** The invoice's own qty × price ≠ its line total, so the price is worth a
   *  human's eye before it's adopted. */
  priceUncertain: boolean;
};

export type MatchResult = {
  matches: LineMatch[];
  /** On the invoice, with no line on this order — billed but not ordered. */
  unmatchedInvoice: InvoiceLine[];
};

/**
 * SKUs are printed by humans and typed by humans. Case and surrounding
 * whitespace never carry meaning, and internal spaces and dashes are formatting
 * ("30-111" and "30111" are the same part). Leading zeros are handled as a
 * SECOND pass rather than stripped here, because "0100" and "100" being
 * different parts is rare but possible — try the strict form first and only
 * relax if that finds nothing.
 */
function normalizeSku(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  return cleaned || null;
}

function withoutLeadingZeros(sku: string): string {
  return sku.replace(/^0+/, "") || sku;
}

/** Words worth comparing: 2+ characters, punctuation dropped. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
  );
}

/**
 * How much of the SHORTER description the two have in common — not how much of
 * their combined vocabulary (Jaccard), which is what this used to be.
 *
 * The two sides describe the same product at very different lengths. An invoice
 * prints "CHOC GUITTARD 66% ORGANIC 25 LB"; our catalog line carries FileMaker's
 * accumulated boilerplate — "CHOC-GUITTARD 66% ORGANIC 25 LB // Guittard // CS
 * (1*25lbs) // $.98 per oz //". Every one of those extra tokens is a token the
 * invoice can't match, so Jaccard scored that pair 0.55 and refused an obviously
 * identical line (found against Mark's real DF01 order, 2026-07-31; the fixtures
 * all used tidy short descriptions and never caught it).
 *
 * Containment asks the right question — "is the short one contained in the long
 * one?" — and answers 1.0 there.
 */
function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared;
}

/**
 * Three quarters of the shorter description, AND at least three words in common.
 *
 * The second condition is what keeps containment honest. On its own, containment
 * is 1.0 for any short description that happens to be a subset of a longer one —
 * a line reading "Milk" would match "Milk Chocolate Bar" perfectly. Requiring
 * three shared words means a pair has to agree on something substantive, which
 * is also what keeps "Bananas, Ripe" away from "Bananas, Fresh" (they share one
 * word, and it's the one word every banana line has).
 */
const DESCRIPTION_THRESHOLD = 0.75;
const MIN_SHARED_WORDS = 3;

/** What a PO line offers for description matching — its own snapshot first,
 *  since that's the vendor's wording and the invoice is the vendor's document;
 *  the catalog name is ours and is the weaker signal. */
function poLineText(line: PoLine): string {
  return [line.description, line.brand, line.vendor_items?.inventory_items?.name]
    .filter(Boolean)
    .join(" ");
}

export function matchInvoiceToOrder(
  lines: PoLine[],
  invoiceLines: InvoiceLine[]
): MatchResult {
  const claimed = new Set<InvoiceLine>();
  const found = new Map<string, { invoice: InvoiceLine; by: LineMatch["by"] }>();

  // The SKU passes. Only lines whose normalized SKU is UNIQUE on each side take
  // part: a vendor that prints the same item number on two lines (a split
  // delivery, a partial backorder) gives no basis for deciding which is which,
  // and pairing them arbitrarily would propose a quantity against the wrong
  // one. Those fall through to be reported unmatched, which is the honest
  // answer.
  const poSkuCounts = countKeys(lines, (l) => normalizeSku(l.product_id));

  // Four passes over the same idea, in descending order of confidence:
  //
  //   1. the invoice's PRIMARY number, exactly
  //   2. its SECOND number, exactly — the MATERIAL/SAP column, which on some
  //      invoices is where our SKU actually is (Dawn 96461403 printed it there
  //      on three lines of four)
  //   3. and 4. the same two ignoring leading zeros, which invoices and
  //      catalogs disagree about constantly ("08843" vs "8843") in a way that
  //      never means anything
  //
  // Primary before alternate MATTERS: if one invoice line prints our number as
  // its product id and another happens to carry it as a material number, the
  // column the vendor labelled as the item number is the better claim. And
  // exact before relaxed, so a genuine "0100" vs "100" distinction survives
  // wherever the strict form can decide.
  const skuPasses: {
    of: (l: InvoiceLine) => string | null;
    key: (sku: string) => string;
  }[] = [
    { of: (l) => normalizeSku(l.product_id), key: (s) => s },
    { of: (l) => normalizeSku(l.alt_product_id ?? null), key: (s) => s },
    { of: (l) => normalizeSku(l.product_id), key: withoutLeadingZeros },
    { of: (l) => normalizeSku(l.alt_product_id ?? null), key: withoutLeadingZeros },
  ];

  for (const pass of skuPasses) {
    // Recomputed per pass over what's still unclaimed, so a number that is
    // ambiguous among the REMAINING lines is still refused — the uniqueness
    // guarantee has to hold within each pass, not just at the start.
    const index = uniqueByKey(
      invoiceLines.filter((l) => !claimed.has(l)),
      (l) => {
        const sku = pass.of(l);
        return sku ? pass.key(sku) : null;
      }
    );
    for (const line of lines) {
      if (found.has(line.id)) continue;
      const sku = normalizeSku(line.product_id);
      if (!sku || poSkuCounts.get(sku) !== 1) continue;
      const hit = index.get(pass.key(sku));
      if (!hit || claimed.has(hit)) continue;
      claimed.add(hit);
      found.set(line.id, { invoice: hit, by: "product_id" });
    }
  }

  // Last pass — description, for whatever is left. Best-scoring pair above the
  // threshold wins, one line at a time, so the strongest match is taken first
  // and can't be stolen by a weaker one later.
  const remainingPo = lines.filter((l) => !found.has(l.id));
  const remainingInvoice = invoiceLines.filter((l) => !claimed.has(l));
  const poTokens = new Map(remainingPo.map((l) => [l.id, tokens(poLineText(l))]));
  const invoiceTokens = new Map(
    remainingInvoice.map((l) => [l, tokens(l.description)] as const)
  );

  const candidates: { line: PoLine; invoice: InvoiceLine; score: number }[] = [];
  for (const line of remainingPo) {
    for (const invoice of remainingInvoice) {
      const a = poTokens.get(line.id)!;
      const b = invoiceTokens.get(invoice)!;
      if (sharedCount(a, b) < MIN_SHARED_WORDS) continue;
      const score = containment(a, b);
      if (score >= DESCRIPTION_THRESHOLD) candidates.push({ line, invoice, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (found.has(c.line.id) || claimed.has(c.invoice)) continue;
    claimed.add(c.invoice);
    found.set(c.line.id, { invoice: c.invoice, by: "description" });
  }

  const matches: LineMatch[] = lines.map((line) => {
    const hit = found.get(line.id) ?? null;
    const invoice = hit?.invoice ?? null;
    const unitPrice = invoice ? invoiceUnitPrice(invoice) : null;
    return {
      line,
      invoice,
      by: hit?.by ?? null,
      // Compared against RECEIVED, not ordered: the question reconcile mode
      // answers is "does what they billed match what we wrote down", and an
      // unreceived line has nothing to disagree with yet.
      qtyDiffers: qtyDiffers(invoice?.qty ?? null, line.qty_received),
      priceDiffers: priceDiffers(unitPrice, line.unit_price),
      unitPrice,
      priceUncertain: invoice ? printedPriceDisagrees(invoice) : false,
    };
  });

  return {
    matches,
    unmatchedInvoice: invoiceLines.filter((l) => !claimed.has(l)),
  };
}

/**
 * The same join, across SEVERAL purchase orders — a consolidated invoice.
 *
 * Additive: `matchInvoiceToOrder` above is untouched and is what does the work.
 *
 * The rule that matters is that this calls it ONCE PER ORDER, over what is
 * still unclaimed, rather than concatenating the orders' lines into one call.
 * Concatenating would be actively wrong: a SKU that is unique within each order
 * is not necessarily unique across both, and the matcher's own uniqueness
 * discipline would then correctly refuse a pair it would have made on either
 * order alone. So the invoice's lines are consumed in order of confidence — the
 * same shape as the four SKU passes inside.
 *
 * `orders` must therefore arrive MOST CONFIDENT FIRST. The caller's ordering is
 * the tiebreak when two orders could each claim a line.
 */
export function matchInvoiceToOrders(
  orders: { id: string; lines: PoLine[] }[],
  invoiceLines: InvoiceLine[]
): Map<string, MatchResult> {
  const results = new Map<string, MatchResult>();
  let remaining = invoiceLines;

  for (const order of orders) {
    const result = matchInvoiceToOrder(order.lines, remaining);
    results.set(order.id, result);
    remaining = result.unmatchedInvoice;
  }
  return results;
}

/**
 * The pairing a human already settled, read back off the stored links.
 *
 * Preferred over a fresh match wherever it exists, and better in three ways at
 * once: it honours a manual match someone made at a delivery, it survives a
 * re-read of the document, and it sidesteps the duplicate-SKU problem entirely
 * for lines that are already decided.
 *
 * `matchInvoiceToOrder` then runs over whatever is left, so an order that has
 * never been linked behaves exactly as it does today.
 */
export function matchesFromLinks(
  lines: PoLine[],
  invoiceLines: (InvoiceLine & { purchase_order_item_id: string | null })[]
): MatchResult {
  const byPoLine = new Map<string, InvoiceLine>();
  const claimed = new Set<InvoiceLine>();
  for (const invoice of invoiceLines) {
    const id = invoice.purchase_order_item_id;
    // First writer wins, and a second link to the same PO line is left
    // unclaimed rather than overwriting — two invoice lines against one order
    // line is the partial-shipment case, and neither one speaks for the other.
    if (!id || byPoLine.has(id)) continue;
    byPoLine.set(id, invoice);
    claimed.add(invoice);
  }

  const linked = lines.filter((l) => byPoLine.has(l.id));
  const unlinked = lines.filter((l) => !byPoLine.has(l.id));
  const rest = invoiceLines.filter((l) => !claimed.has(l));

  // The unlinked half still gets the ordinary treatment.
  const fresh = matchInvoiceToOrder(unlinked, rest);

  const stored: LineMatch[] = linked.map((line) => {
    const invoice = byPoLine.get(line.id)!;
    const unitPrice = invoiceUnitPrice(invoice);
    return {
      line,
      invoice,
      by: "product_id",
      qtyDiffers: qtyDiffers(invoice.qty, line.qty_received),
      priceDiffers: priceDiffers(unitPrice, line.unit_price),
      unitPrice,
      priceUncertain: printedPriceDisagrees(invoice),
    };
  });

  // Back into the caller's own line order, so the screen renders as given.
  const byId = new Map<string, LineMatch>();
  for (const m of [...stored, ...fresh.matches]) byId.set(m.line.id, m);

  return {
    matches: lines.map((line) => byId.get(line.id)!),
    unmatchedInvoice: fresh.unmatchedInvoice,
  };
}

/** Index by key, keeping only keys that appear exactly once. */
function uniqueByKey<T>(items: T[], key: (item: T) => string | null): Map<string, T> {
  const counts = countKeys(items, key);
  const index = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (k && counts.get(k) === 1) index.set(k, item);
  }
  return index;
}

function countKeys<T>(items: T[], key: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
