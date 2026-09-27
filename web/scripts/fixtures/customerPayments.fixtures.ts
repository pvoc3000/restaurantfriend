// `lib/customerPayments` — migration 140's client half: which payments on an
// order's Payments tab are split, and what a row lets you change.
//
// Checked by breaking: letting `paymentsToCount` ask about every payment turns
// the cash case red; counting a payment nobody asked about as split
// turns the held-cash case red; dropping the processor test from
// `amountEditable` turns the Square case red.

import { test, eq, ok, no } from "./harness";
import {
  amountEditable,
  applicationCounts,
  isSplitPayment,
  paymentsToCount,
  removable,
} from "../../src/lib/customerPayments";

test("paymentsToCount: only invoice or processor payments can have been split", () => {
  eq(
    paymentsToCount([
      { payment_id: "cash", customer_invoice_id: null, processor: null },
      { payment_id: "cheque-on-invoice", customer_invoice_id: "inv", processor: null },
      { payment_id: "square", customer_invoice_id: null, processor: "square" },
      { payment_id: "square", customer_invoice_id: "inv", processor: "square" },
    ]),
    ["cheque-on-invoice", "square"],
    "cash held on the order is never asked about, and each payment is asked once"
  );
});

test("isSplitPayment: counts from the applications; an unasked payment went to one place", () => {
  const counts = applicationCounts([
    { payment_id: "week" },
    { payment_id: "week" },
    { payment_id: "week" },
    { payment_id: "deposit" },
  ]);
  ok(isSplitPayment("week", counts), "one Square payment across three Knotted days");
  no(isSplitPayment("deposit", counts), "a payment that went to one invoice line");
  no(isSplitPayment("cash", counts), "held cash was never counted and is one payment");
});

test("amountEditable / removable: the database's own rules, before anyone presses", () => {
  ok(amountEditable({ processor: null, shared: false }), "cash typed by a person");
  no(amountEditable({ processor: "square", shared: false }), "Square's figure is Square's");
  no(amountEditable({ processor: "quickbooks" }), "QuickBooks' figure is QuickBooks'");
  no(amountEditable({ processor: null, shared: true }), "a cheque split across the week's orders");
  ok(removable({ shared: false }), "a payment that went to one place");
  ok(removable({ processor: "square", shared: false } as { shared?: boolean }), "a test pay-link payment can still be removed");
  no(removable({ shared: true }), "a split payment cannot leave one order");
});
