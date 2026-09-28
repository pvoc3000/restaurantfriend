// A PART REFUND, SPLIT THE WAY THE INVOICE WAS CHARGED (Mark, 2026-09-28:
// "build proportional partial refunds").
//
// A QuickBooks refund receipt needs item lines and tax, not just an amount.
// For the whole invoice those are the invoice's own lines. For part of it,
// every line gives back the SAME SHARE — the refund over the invoice's total —
// and the tax comes back in the proportion it was charged, so the sales-tax
// report stays consistent with what was collected.
//
// QUICKBOOKS WORKS OUT THE TAX ITSELF, from the taxable lines, ONE COMPONENT
// AT A TIME (state, county, district — each `TaxLine` of the invoice, rounded
// on its own), so the taxable lines are chosen so that they plus QuickBooks'
// tax on them come to the refund. The rates are the invoice's own
// `TaxPercent`s; the rate implied by its rounded tax is only the fallback, and
// was wrong by a cent at $1.63 of a $81.25 invoice in the fixtures' sweep. Rounding can skip a total: at 9.5%, $0.36 of goods
// is $0.39 with tax and $0.37 is $0.41, so no taxable amount comes to $0.40.
// The cent left over goes on an UNTAXED line of its own, `rounding`, rather
// than a line's tax being wrong.
//
// Everything is in CENTS, integers, so no float ever meets money. Pure, with no
// imports: `qbo-sync` (Deno) and the fixtures (Node) both load it.

export type RefundSplitLine = { cents: number; taxable: boolean };

export type RefundSplit = {
  /** Cents to refund on each of the invoice's lines, in the same order. */
  lines: number[];
  /** Cents on an extra untaxed "Rounding" line; usually 0. */
  rounding: number;
  /** The tax QuickBooks should compute on the taxable lines. */
  tax: number;
};

/** Half up, as QuickBooks rounds tax, with a nudge against float dust. */
function roundCents(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/**
 * Spread `total` cents over `weights` in proportion, whole cents, summing
 * exactly to `total`: each takes its floor, then the leftover cents go to the
 * largest remainders (ties to the earlier line).
 */
export function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let left = total - out.reduce((a, c) => a + c, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export function splitRefund(
  lines: RefundSplitLine[],
  invoiceTaxCents: number,
  refundCents: number,
  /** Each tax component's rate as a FRACTION (9.5% → 0.095), from the
   *  invoice's `TaxLine`s. Omitted: the rate its rounded tax implies. */
  rates?: number[]
): RefundSplit | { error: string } {
  if (!Number.isInteger(refundCents) || refundCents <= 0) return { error: "a refund is more than zero" };
  const taxable = lines.filter((l) => l.taxable).reduce((a, l) => a + l.cents, 0);
  const untaxed = lines.filter((l) => !l.taxable).reduce((a, l) => a + l.cents, 0);
  const total = taxable + untaxed + invoiceTaxCents;
  if (total <= 0) return { error: "the invoice has nothing to refund" };
  if (refundCents > total) return { error: "the refund is more than the invoice" };
  if (taxable <= 0 && invoiceTaxCents > 0) return { error: "the invoice charged tax on nothing taxable" };

  const components = rates && rates.length ? rates : [taxable > 0 ? invoiceTaxCents / taxable : 0];
  const taxOn = (x: number) => components.reduce((a, r) => a + roundCents(r * x), 0);
  const rate = components.reduce((a, r) => a + r, 0);
  // The untaxed lines' share, straight; the taxable lines take the rest,
  // tax included.
  const untaxedBack = roundCents((untaxed * refundCents) / total);
  const forTaxed = refundCents - untaxedBack;
  let taxedBack = 0;
  let tax = 0;
  if (taxable > 0) {
    taxedBack = Math.min(taxable, roundCents(forTaxed / (1 + rate)));
    while (taxedBack > 0 && taxedBack + taxOn(taxedBack) > forTaxed) taxedBack -= 1;
    while (taxedBack < taxable && taxedBack + 1 + taxOn(taxedBack + 1) <= forTaxed) taxedBack += 1;
    tax = taxOn(taxedBack);
  }
  const rounding = forTaxed - taxedBack - tax;
  if (rounding < 0 || rounding > 2) return { error: "the refund could not be split to the cent" };

  const taxedShares = spread(taxedBack, lines.map((l) => (l.taxable ? l.cents : 0)));
  const untaxedShares = spread(untaxedBack, lines.map((l) => (l.taxable ? 0 : l.cents)));
  return { lines: lines.map((_, i) => taxedShares[i] + untaxedShares[i]), rounding, tax };
}
