// `lib/receiptReadiness` — what is missing before an order's receipt goes.
//
// Checked by BREAKING it: dropping the delivery clause, dropping the epsilon,
// letting `ignore_balance`-style reasoning in (a balance excused), and moving
// the canceled early-return each turned cases here red.

import { test, eq } from "./harness";
import { receiptGaps, type ReceiptOrder } from "../../src/lib/receiptReadiness";

/** A paid pickup with a date and a time — the order that sends unasked. */
function order(patch: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    status: "order",
    fulfillment: "pickup",
    delivery_scheduled_at: null,
    event_date: "2026-10-24",
    event_time: "09:00",
    balance: 0,
    ...patch,
  };
}

test("receipt: a paid pickup with a date and time is complete", () => {
  eq(receiptGaps(order()), []);
});

test("receipt: a paid, booked delivery is complete", () => {
  eq(receiptGaps(order({ fulfillment: "delivery", delivery_scheduled_at: "2026-10-20" })), []);
});

test("receipt: a pickup needs no delivery booking", () => {
  eq(receiptGaps(order({ fulfillment: "pickup", delivery_scheduled_at: null })), []);
});

test("receipt: a missing fulfillment reads as pickup", () => {
  eq(receiptGaps(order({ fulfillment: null })), []);
});

test("receipt: a balance owing is named with its amount", () => {
  eq(receiptGaps(order({ balance: 125.5 })), ["It isn’t paid for: $125.50 is still due."]);
});

test("receipt: half a cent is arithmetic, not a debt", () => {
  eq(receiptGaps(order({ balance: 0.004 })), []);
});

test("receipt: a cent is owed", () => {
  eq(receiptGaps(order({ balance: 0.01 })), ["It isn’t paid for: $0.01 is still due."]);
});

test("receipt: a credit counts as paid", () => {
  eq(receiptGaps(order({ balance: -4 })), []);
});

test("receipt: still at Invoice and unpaid — the money is the gap", () => {
  eq(receiptGaps(order({ status: "invoice", balance: 80 })), ["It isn’t paid for: $80.00 is still due."]);
});

test("receipt: an unbooked delivery is named", () => {
  eq(receiptGaps(order({ fulfillment: "delivery" })), ["Delivery isn’t scheduled."]);
});

test("receipt: unpaid AND unbooked lists both, money first", () => {
  eq(receiptGaps(order({ fulfillment: "delivery", balance: 10 })), [
    "It isn’t paid for: $10.00 is still due.",
    "Delivery isn’t scheduled.",
  ]);
});

test("receipt: a quote is uncommitted, and its price is not called a debt", () => {
  eq(receiptGaps(order({ status: "quote", balance: 300 })), [
    "It is still a Quote — the customer hasn’t committed to it.",
  ]);
});

test("receipt: a lead is uncommitted", () => {
  eq(receiptGaps(order({ status: "lead", balance: 0 })), [
    "It is still a Lead — the customer hasn’t committed to it.",
  ]);
});

test("receipt: a canceled order says only that", () => {
  eq(
    receiptGaps(order({ status: "cancelled", balance: 50, fulfillment: "delivery", event_date: null })),
    ["The order is canceled."]
  );
});

test("receipt: no event date", () => {
  eq(receiptGaps(order({ event_date: null })), ["It has no event date."]);
});

test("receipt: no time on a pickup", () => {
  eq(receiptGaps(order({ event_time: null })), ["It has no pickup time."]);
});

test("receipt: no time on a booked delivery", () => {
  eq(
    receiptGaps(order({ fulfillment: "delivery", delivery_scheduled_at: "2026-10-20", event_time: null })),
    ["It has no delivery time."]
  );
});
