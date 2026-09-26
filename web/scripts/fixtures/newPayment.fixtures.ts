// New Invoice and New Payment (migration 139) — the pure half: what is not
// yet invoiced, the deposit's % ↔ $ pair, what each dialog refuses in words,
// and where a payment goes by default.
//
// The figures are the throwaway-Postgres run's: a $368.50 order, a $36.85
// deposit invoice, then a Balance Due invoice for $331.65; 10 more donuts
// make it $364.50; $20 cash makes it $344.50.
//
// Checked by breaking: counting a LIVE invoice's payments as off-invoice in
// `uninvoicedAmount` turns "a paid deposit is not subtracted twice" red;
// dropping the `hasBalanceInvoice` test turns "one balance invoice" red;
// letting a payment exceed its invoice's due turns "no more than it asks" red.

import { test, eq } from "./harness";
import { depositAmount, readSettings, validDepositRate } from "../../src/lib/specialOrders";
import {
  amountFromPercent,
  defaultApplyTo,
  newInvoiceProblem,
  newPaymentProblem,
  parseMoney,
  percentFromAmount,
  uninvoicedAmount,
} from "../../src/lib/newPayment";

test("depositAmount: total × rate, to the cent, as SQL rounds it", () => {
  eq(depositAmount(368.5, 0.1), 36.85);
  eq(depositAmount(100.05, 0.1), 10.01);
  eq(depositAmount(613.5, 0.25), 153.38, "half a cent rounds up");
  eq(depositAmount(368.5, null), 0);
});

test("validDepositRate: a fraction strictly between 0 and 1", () => {
  eq(validDepositRate(0.1), 0.1);
  eq(validDepositRate("0.1"), 0.1, "PostgREST numeric as a string");
  eq(validDepositRate(0), null);
  eq(validDepositRate(10), null, "a percentage typed where a fraction belongs");
});

test("readSettings: New Payment's deposit starts at 10%, and a bad rate falls back", () => {
  eq(readSettings({}).depositRate, 0.1);
  eq(readSettings({ special_orders: { deposit_rate: 0.25 } }).depositRate, 0.25);
  eq(readSettings({ special_orders: { deposit_rate: 25 } }).depositRate, 0.1);
});

test("uninvoicedAmount: a fresh order is all of it", () => {
  eq(uninvoicedAmount({ total: 368.5, cancelled: false, payments: [], liveLines: [] }), 368.5);
});

test("uninvoicedAmount: a deposit invoice, paid or not, is subtracted once", () => {
  const lines = [{ amount: 36.85 }];
  eq(uninvoicedAmount({ total: 368.5, cancelled: false, payments: [], liveLines: lines }), 331.65);
  eq(
    uninvoicedAmount({
      total: 368.5,
      cancelled: false,
      payments: [{ amount: 36.85, invoiceLive: true }],
      liveLines: lines,
    }),
    331.65,
    "a paid deposit is not subtracted twice"
  );
});

test("uninvoicedAmount: cash, and a voided invoice's payment, come off it", () => {
  eq(
    uninvoicedAmount({
      total: 401.35,
      cancelled: false,
      payments: [{ amount: 20, invoiceLive: false }, { amount: 36.85, invoiceLive: true }],
      liveLines: [{ amount: 36.85 }],
    }),
    344.5
  );
});

test("uninvoicedAmount: a cancelled order has nothing to invoice", () => {
  eq(uninvoicedAmount({ total: 368.5, cancelled: true, payments: [], liveLines: [] }), 0);
});

test("parseMoney: dollars as people type them", () => {
  eq(parseMoney("36.85"), 36.85);
  eq(parseMoney("$1,250.5"), 1250.5);
  eq(parseMoney("0"), null);
  eq(parseMoney("12.345"), null, "no third decimal");
  eq(parseMoney("abc"), null);
  eq(parseMoney(""), null);
});

test("deposit % ↔ $: each box fills the other, of the order's total", () => {
  eq(amountFromPercent(368.5, "10"), "36.85");
  eq(amountFromPercent(368.5, "10%"), "36.85");
  eq(amountFromPercent(368.5, ""), "");
  eq(amountFromPercent(368.5, "100"), "", "a deposit of all of it is not a deposit");
  eq(percentFromAmount(368.5, "36.85"), "10");
  eq(percentFromAmount(400, "50"), "12.5");
  eq(percentFromAmount(0, "50"), "", "no total, no percentage");
});

const base = { uninvoiced: 331.65, hasBalanceInvoice: false, hasCustomer: true };

test("newInvoiceProblem: each option's refusal, in words", () => {
  eq(newInvoiceProblem({ ...base, choice: "balance", amountText: "" }), null);
  eq(newInvoiceProblem({ ...base, choice: "balance", amountText: "", hasBalanceInvoice: true }),
     "An invoice already bills this order's balance.", "one balance invoice");
  eq(newInvoiceProblem({ ...base, choice: "balance", amountText: "", uninvoiced: 0 }),
     "Nothing is left to invoice on this order.");
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "36.85" }), null);
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "" }), "Enter an amount.");
  eq(newInvoiceProblem({ ...base, choice: "other", amountText: "400" }),
     "That is more than the $331.65 not yet invoiced.");
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "10", hasCustomer: false }),
     "Link a customer to this order before invoicing it.");
});

const deposit = { id: "a", number: 1010, label: "Invoice 1010", what: "Deposit", due: 3.8 };
const balance = { id: "b", number: 1011, label: "Invoice 1011", what: "Balance due", due: 34.17 };

test("newPaymentProblem: no more than the invoice asks; the order has no ceiling", () => {
  eq(newPaymentProblem({ amountText: "3.80", applyTo: deposit }), null);
  eq(newPaymentProblem({ amountText: "5", applyTo: deposit }),
     "That is more than the $3.80 due on Invoice 1010.", "no more than it asks");
  eq(newPaymentProblem({ amountText: "500", applyTo: null }), null);
  eq(newPaymentProblem({ amountText: "", applyTo: null }), "Enter an amount.");
});

test("defaultApplyTo: the oldest open invoice — the deposit before the balance", () => {
  eq(defaultApplyTo([balance, deposit])?.id, "a");
  eq(defaultApplyTo([]), null, "nothing open: the order itself");
});
