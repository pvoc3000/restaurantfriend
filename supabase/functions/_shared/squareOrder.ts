// THE SQUARE ORDER BEHIND A PAY-LINK PAYMENT (Mark, 2026-09-22: "let's do it
// the proper way").
//
// A bare payment reports in Square as a custom amount, which is UNCATEGORIZED
// — and the nightly journal entry posts Uncategorized to Uncategorized Income.
// So `square-pay` first creates an ORDER, and the order says what the money
// was, in the vocabulary the sales mapping already reads:
//
//   · the goods → a line on the "Special Orders" catalog item, so they report
//     in the Special Orders CATEGORY (→ the Special Orders income account);
//   · the sales tax → a real Square TAX on the taxable line (→ Sales Tax
//     Payable), not folded into income;
//   · delivery → a SERVICE CHARGE (→ the service-charges role, Delivery
//     Services), untaxed, as `orderTotals` treats it.
//
// The rush fee is untaxed income and rides on the untaxed goods line.
// Discounts are already netted into the two lines, as `buildInvoicePayload`
// nets them for QuickBooks — `invoiceSplit`'s arithmetic, snapshotted at send.
//
// ---------------------------------------------------------------------------
// THE TOTAL MUST BE OURS TO THE CENT, AND SQUARE COMPUTES THE TAX
// ---------------------------------------------------------------------------
// Square takes an ad-hoc tax as a PERCENTAGE only (OrderLineItemTax has no
// settable amount) and rounds it with BANKER'S rounding, half to even. Ours
// (`orderTotals`) rounds half up, on the unrounded taxable base. So Square's tax
// can land a cent from the invoice's. This module computes Square's figure the
// way Square will, and puts the difference on the UNTAXED line, labelled — so
// the customer is charged exactly the invoice, and the tax on the books is the
// tax Square actually recorded. `square-pay` then checks Square's own
// `total_money` against the balance before charging anything.
//
// ---------------------------------------------------------------------------
// A PART-PAID INVOICE IS SCALED, NOT RE-SPLIT
// ---------------------------------------------------------------------------
// The link charges the BALANCE (total − payments since). The breakdown is of
// the TOTAL, so every part is scaled by balance ÷ total and the rounding line
// absorbs the pennies. With nothing paid yet the factor is 1.
//
// PURE, NO DENO APIS AND NO IMPORTS, so `web/scripts/fixtures` compiles and
// tests this very file — the only file under supabase/functions the suite
// reaches, and the reason its tsconfig's rootDir is the repo.

/** Snapshotted on the pay token at send (migration 123), in DOLLARS. */
export type PayBreakdown = {
  /** Taxable goods after the discount — `invoiceSplit().taxableNet`. */
  taxable_net: number;
  /** Untaxed goods and the rush fee — `nonTaxableNet` less delivery. */
  other_net: number;
  delivery: number;
  /** The invoice's own tax, for the record; Square recomputes it. */
  tax: number;
  /** A fraction: 0.095 is 9.5%. */
  tax_rate: number;
  total: number;
};

export type SquareOrderPlan = {
  order: Record<string, unknown>;
  /** What Square's `total_money` must come back as. */
  expectedCents: number;
  /** Square's tax, as this module predicts it. */
  taxCents: number;
  /** Cents moved onto the untaxed line to meet the invoice exactly. */
  roundingCents: number;
  /** True when there was no breakdown, or it could not be used — one line. */
  single: boolean;
};

/** Half to even, which is what Square calls Bankers' Rounding. */
export function bankersRound(x: number): number {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/** "9.5" from 0.095, without float noise ("9.500000000000002"). */
export function percentString(rate: number): string {
  return String(Number((rate * 100).toFixed(6)));
}

const usd = (cents: number) => ({ amount: cents, currency: "USD" });

export function buildSquareOrder(args: {
  balanceCents: number;
  breakdown: PayBreakdown | null;
  /** "Order #10071 — Birthday" */
  label: string;
  /** The "Special Orders" item's variation; null reports as Uncategorized. */
  variationId: string | null;
  locationId: string;
  referenceId: string;
}): SquareOrderPlan {
  const { balanceCents, breakdown, label, variationId, locationId, referenceId } = args;

  const line = (name: string, cents: number, extra: Record<string, unknown> = {}) => ({
    name,
    quantity: "1",
    ...(variationId ? { catalog_object_id: variationId } : {}),
    base_price_money: usd(cents),
    ...extra,
  });

  const single = (): SquareOrderPlan => ({
    order: {
      location_id: locationId,
      reference_id: referenceId,
      line_items: [line(label, balanceCents)],
    },
    expectedCents: balanceCents,
    taxCents: 0,
    roundingCents: 0,
    single: true,
  });

  if (!breakdown || !(breakdown.total > 0) || balanceCents <= 0) return single();

  const f = Math.min(1, balanceCents / Math.round(breakdown.total * 100));
  const taxable = Math.round(breakdown.taxable_net * 100 * f);
  let other = Math.round(breakdown.other_net * 100 * f);
  const delivery = Math.round(breakdown.delivery * 100 * f);
  const rate = breakdown.tax_rate > 0 ? breakdown.tax_rate : 0;
  if (taxable < 0 || other < 0 || delivery < 0) return single();

  const tax = taxable > 0 && rate > 0 ? bankersRound(taxable * rate) : 0;
  const rounding = balanceCents - (taxable + other + delivery + tax);
  other += rounding;
  // A rounding bigger than a few cents means the breakdown and the balance
  // disagree about something real — one honest line beats a wrong split.
  if (other < 0 || Math.abs(rounding) > 5) return single();

  const lines: Record<string, unknown>[] = [];
  if (taxable > 0) {
    lines.push(
      line(label, taxable, rate > 0 ? { applied_taxes: [{ tax_uid: "sales-tax" }] } : {})
    );
  }
  if (other > 0) lines.push(line(taxable > 0 ? `${label} (not taxed)` : label, other));
  if (lines.length === 0) return single();

  const order: Record<string, unknown> = {
    location_id: locationId,
    reference_id: referenceId,
    line_items: lines,
  };
  if (tax > 0) {
    order.taxes = [
      {
        uid: "sales-tax",
        name: "Sales tax",
        percentage: percentString(rate),
        type: "ADDITIVE",
        scope: "LINE_ITEM",
      },
    ];
  }
  if (delivery > 0) {
    order.service_charges = [
      {
        name: "Delivery",
        amount_money: usd(delivery),
        // After tax and untaxed — `orderTotals` never taxes delivery.
        calculation_phase: "TOTAL_PHASE",
        taxable: false,
      },
    ];
  }

  return { order, expectedCents: balanceCents, taxCents: tax, roundingCents: rounding, single: false };
}
