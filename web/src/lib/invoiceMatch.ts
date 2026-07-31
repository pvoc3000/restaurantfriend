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
import { priceDiffers, qtyDiffers, type InvoiceLine } from "./invoiceExtraction";

export type LineMatch = {
  line: PoLine;
  invoice: InvoiceLine | null;
  /** How it was matched — shown, because "we guessed" earns less trust. */
  by: "product_id" | "description" | null;
  /** Invoice quantity differs from what's been received on the line. */
  qtyDiffers: boolean;
  /** Invoice price differs from what the order says it costs. */
  priceDiffers: boolean;
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

  // Pass 1 — exact SKU. Only lines whose normalized SKU is UNIQUE on each side
  // take part: a vendor that prints the same item number on two lines (a split
  // delivery, a partial backorder) gives no basis for deciding which is which,
  // and pairing them arbitrarily would propose a quantity against the wrong
  // one. Those fall through to be reported unmatched, which is the honest
  // answer.
  const bySku = uniqueByKey(invoiceLines, (l) => normalizeSku(l.product_id));
  const poSkuCounts = countKeys(lines, (l) => normalizeSku(l.product_id));

  for (const line of lines) {
    const sku = normalizeSku(line.product_id);
    if (!sku || poSkuCounts.get(sku) !== 1) continue;
    const hit = bySku.get(sku);
    if (!hit || claimed.has(hit)) continue;
    claimed.add(hit);
    found.set(line.id, { invoice: hit, by: "product_id" });
  }

  // Pass 2 — the same join ignoring leading zeros, for the still-unmatched.
  // Invoices and catalogs disagree about zero-padding constantly ("08843" vs
  // "8843") and that disagreement is never meaningful.
  const byLooseSku = uniqueByKey(
    invoiceLines.filter((l) => !claimed.has(l)),
    (l) => {
      const sku = normalizeSku(l.product_id);
      return sku ? withoutLeadingZeros(sku) : null;
    }
  );
  for (const line of lines) {
    if (found.has(line.id)) continue;
    const sku = normalizeSku(line.product_id);
    if (!sku || poSkuCounts.get(sku) !== 1) continue;
    const hit = byLooseSku.get(withoutLeadingZeros(sku));
    if (!hit || claimed.has(hit)) continue;
    claimed.add(hit);
    found.set(line.id, { invoice: hit, by: "product_id" });
  }

  // Pass 3 — description, for whatever is left. Best-scoring pair above the
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
    return {
      line,
      invoice,
      by: hit?.by ?? null,
      // Compared against RECEIVED, not ordered: the question reconcile mode
      // answers is "does what they billed match what we wrote down", and an
      // unreceived line has nothing to disagree with yet.
      qtyDiffers: qtyDiffers(invoice?.qty ?? null, line.qty_received),
      priceDiffers: priceDiffers(invoice?.unit_price ?? null, line.unit_price),
    };
  });

  return {
    matches,
    unmatchedInvoice: invoiceLines.filter((l) => !claimed.has(l)),
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
