/**
 * THE PAYMENTS LEDGER (migration 140) — the client's half.
 *
 * A payment is money received (`customer_payments`); where it went is its
 * applications (`payment_applications`) — held on an order, an order's share of
 * an invoice payment, or (141) an invoice's own lines. An order's Payments tab
 * lists its APPLICATIONS through the `order_payments` view, so a row there is
 * this order's slice of a payment, not necessarily the whole of it.
 *
 * What a row lets you change follows from that, and the database enforces the
 * same rules (`update_order_payment`, `delete_order_payment`); these say so
 * before anyone presses anything.
 */

export type LedgerRow = {
  payment_id: string;
  customer_invoice_id?: string | null;
  processor?: string | null;
};

/**
 * Which payments need asking whether they went anywhere else: only one taken
 * on an invoice or by a processor can have been split. Money held on an order
 * by hand is always one application.
 */
export function paymentsToCount(rows: LedgerRow[]): string[] {
  return [...new Set(rows.filter((r) => r.customer_invoice_id || r.processor).map((r) => r.payment_id))];
}

/** How many places each payment went, from its application rows. */
export function applicationCounts(applications: { payment_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of applications) counts.set(a.payment_id, (counts.get(a.payment_id) ?? 0) + 1);
  return counts;
}

/** One payment that went to more than one place. A payment never asked about
 *  went to one. */
export function isSplitPayment(paymentId: string, counts: Map<string, number>): boolean {
  return (counts.get(paymentId) ?? 1) > 1;
}

/** The amount is typed by a person and belongs to this order alone — a
 *  processor's figure is the processor's, a split payment's is the payment's. */
export function amountEditable(row: { processor?: string | null; shared?: boolean }): boolean {
  return !row.processor && !row.shared;
}

/** The × — a split payment cannot be removed from one of its orders. */
export function removable(row: { shared?: boolean }): boolean {
  return !row.shared;
}

/**
 * WHAT IS LEFT TO REFUND of one row — its amount less the refunds that name
 * its payment in the same place (the same order, the same invoice). The
 * client's copy of 140/149's `payment_refundable`, so Refund… leaves a row
 * that has been given back in full (Mark, 2026-09-28: "the refund button was
 * still on the original payment row") and offers only the rest after a part
 * refund. The database still caps it; this only decides what is OFFERED.
 */
export function refundLeft(
  row: { payment_id: string; amount: number | null; order_id?: string | null; customer_invoice_id?: string | null },
  rows: { refund_of?: string | null; amount: number | null; order_id?: string | null; customer_invoice_id?: string | null }[]
): number {
  const same = (a?: string | null, b?: string | null) => (a ?? null) === (b ?? null);
  const refunded = rows
    .filter(
      (r) => r.refund_of === row.payment_id && same(r.order_id, row.order_id) && same(r.customer_invoice_id, row.customer_invoice_id)
    )
    .reduce((a, r) => a + Number(r.amount ?? 0), 0);
  return Math.max(0, Math.round((Number(row.amount ?? 0) + refunded) * 100) / 100);
}

