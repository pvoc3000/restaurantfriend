/**
 * IS THIS ORDER READY FOR ITS RECEIPT? (Mark, 2026-10-20: "if a user tries to
 * send a receipt for a special order that isn't complete, i.e. isn't paid for,
 * or doesn't have delivery scheduled, etc., then the app should warn them
 * before continuing.")
 *
 * Pure and fixture-tested. It answers with the list of what is missing, in
 * sentences the warning prints as they are; an empty list means the receipt
 * goes without a question.
 *
 * WHAT "COMPLETE" MEANS IS ALREADY WRITTEN DOWN ELSEWHERE, and this reads it
 * rather than inventing it:
 *
 *   · **The ladder.** `paidTodo` says a paid order's next to-do is Schedule
 *     Delivery when a delivery is not booked, and Send Receipt otherwise — so
 *     the receipt comes after BOTH the money and the courier. A pickup needs
 *     no booking (82% of orders; `lib/specialOrderProgress`'s hold is for
 *     deliveries only).
 *   · **The paper.** The receipt is "the invoice, settled", and its
 *     fulfillment paragraph tells the customer when it will be ready or
 *     arrive — "anytime after {ready_time} on {event_day}", where the ready
 *     time is `event_time` (170). An order with no date or time sends a
 *     receipt with a hole in that sentence.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK:
 *
 *   · **`ignore_balance` does not excuse the money.** The flag keeps an order
 *     out of the unpaid queue; it does not make it paid (the order record's
 *     own note on the Paid chip, 2026-09-20). A receipt for an order with a
 *     balance prints that balance, which is the thing to be warned about.
 *   · **A credit is paid.** `<= 0`, as `isSettled` has it — an overpayment is
 *     money we owe them, not a receipt that should not go.
 *   · **Production.** Printing and scheduling are the kitchen's, and since
 *     2026-10-01 a paid order's to-do skips straight to Send Receipt.
 *   · **A receipt already sent.** Sending a second copy is not incomplete.
 */

import { STATUS_LABEL, money, type SpecialOrderStatus } from "./specialOrders";

/** Just enough of an order, plus its balance (`OrderTotals.balance`). */
export type ReceiptOrder = {
  status: string | null;
  fulfillment?: string | null;
  delivery_scheduled_at: string | null;
  event_date: string | null;
  event_time: string | null;
  balance: number;
};

/** Half a cent — the epsilon every settled check in this module family uses. */
const SETTLED_EPSILON = 0.005;

/**
 * What is missing before this order's receipt should go, one sentence each,
 * most important first. Empty when nothing is.
 */
export function receiptGaps(order: ReceiptOrder): string[] {
  // A canceled order is not happening; nothing else about it is worth saying.
  if (order.status === "cancelled") return ["The order is canceled."];

  const gaps: string[] = [];
  const committed = order.status !== "lead" && order.status !== "quote";
  if (!committed) {
    // A lead's or a quote's balance is a price we offered, not a debt
    // (`countsAsOwed`), so it says so in its own words rather than "$X owed".
    const label = STATUS_LABEL[order.status as SpecialOrderStatus] ?? order.status ?? "a lead";
    gaps.push(`It is still a ${label} — the customer hasn’t committed to it.`);
  } else if (order.balance > SETTLED_EPSILON) {
    gaps.push(`It isn’t paid for: ${money(order.balance)} is still due.`);
  }

  if (order.fulfillment === "delivery" && !order.delivery_scheduled_at) {
    gaps.push("Delivery isn’t scheduled.");
  }
  if (!order.event_date) gaps.push("It has no event date.");
  if (!order.event_time) {
    gaps.push(
      order.fulfillment === "delivery" ? "It has no delivery time." : "It has no pickup time."
    );
  }
  return gaps;
}
