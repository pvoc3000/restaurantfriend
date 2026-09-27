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
