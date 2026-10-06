// New Invoice and New Payment (migrations 139, 141) — the pure half: what is
// not yet billed, the deposit's % ↔ $ pair, what each dialog refuses in words,
// and where a payment goes by default.
//
// The figures are the throwaway-Postgres run's: a $368.50 order, a $36.85
// deposit invoice, then a Balance Due invoice for $331.65.
//
// Checked by breaking: counting a cancelled order's total in `unbilledAmount`
// turns "a cancelled order has nothing to bill" red; dropping the nothing-left
// test turns "billed in full" red; letting a payment exceed its invoice's due
// turns "no more than it asks" red; `offersOrderChoice` counting a draft as
// sent turns "only a draft" red.

import { test, eq, ok, no } from "./harness";
import { depositAmount, readSettings, validDepositRate } from "../../src/lib/specialOrders";
import {
  amountFromPercent,
  defaultApplyTo,
  offersOrderChoice,
  newInvoiceProblem,
  newPaymentProblem,
  parseMoney,
  percentFromAmount,
  unbilledAmount,
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

test("unbilledAmount: a fresh order is all of it", () => {
  eq(unbilledAmount({ total: 368.5, cancelled: false, liveLines: [] }), 368.5);
});

test("unbilledAmount: a deposit invoice, paid or not, is billed once", () => {
  eq(unbilledAmount({ total: 368.5, cancelled: false, liveLines: [{ amount: 36.85 }] }), 331.65);
  eq(
    unbilledAmount({ total: 368.5, cancelled: false, liveLines: [{ amount: 36.85 }, { amount: 331.65 }] }),
    0,
    "billed in full"
  );
});

test("unbilledAmount: cash is a payment, not a bill (141)", () => {
  // $20 taken at the counter is held on the order and applies when its
  // invoice is sent — the invoice still bills the order's whole total.
  eq(unbilledAmount({ total: 401.35, cancelled: false, liveLines: [{ amount: 36.85 }] }), 364.5);
});

test("unbilledAmount: a cancelled order has nothing to bill, and one billed shows negative", () => {
  eq(unbilledAmount({ total: 368.5, cancelled: true, liveLines: [] }), 0);
  eq(unbilledAmount({ total: 368.5, cancelled: true, liveLines: [{ amount: 36.85 }] }), -36.85);
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

const base = { unbilled: 331.65, hasCustomer: true };

test("newInvoiceProblem: each option's refusal, in words", () => {
  eq(newInvoiceProblem({ ...base, choice: "balance", amountText: "" }), null);
  eq(newInvoiceProblem({ ...base, choice: "balance", amountText: "", unbilled: 0 }),
     "Nothing is left to bill on this order.", "billed in full");
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "10", unbilled: -5 }),
     "Nothing is left to bill on this order.", "billed more than it now comes to");
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "36.85" }), null);
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "" }), "Enter an amount.");
  ok(newInvoiceProblem({ ...base, choice: "balance", amountText: "", noTaxRate: true })?.includes("no tax rate"));
  eq(newInvoiceProblem({ ...base, choice: "other", amountText: "400" }),
     "That is more than the $331.65 not yet billed.");
  eq(newInvoiceProblem({ ...base, choice: "deposit", amountText: "10", hasCustomer: false }),
     "Link a customer to this order before invoicing it.");
});

const deposit = { id: "a", number: 1010, label: "Invoice 1010", what: "Deposit", due: 3.8, posted: true };
const balance = { id: "b", number: 1011, label: "Invoice 1011", what: "Balance due", due: 34.17, posted: true };

test("newPaymentProblem: no more than the invoice asks; the order has no ceiling", () => {
  eq(newPaymentProblem({ amountText: "3.80", applyTo: deposit }), null);
  eq(newPaymentProblem({ amountText: "5", applyTo: deposit }),
     "That is more than the $3.80 due on Invoice 1010.", "no more than it asks");
  eq(newPaymentProblem({ amountText: "500", applyTo: null }), null);
  eq(newPaymentProblem({ amountText: "", applyTo: null }), "Enter an amount.");
});

test("offersOrderChoice: not while a sent invoice is open — the money would go onto it anyway", () => {
  ok(offersOrderChoice([]), "nothing open: the order itself");
  no(offersOrderChoice([deposit]), "a sent deposit invoice");
  ok(offersOrderChoice([{ ...balance, posted: false }]), "only a draft: cash is held and applies when it is sent");
  no(offersOrderChoice([{ ...balance, posted: false }, deposit]), "a draft and a sent one");
});

test("defaultApplyTo: the oldest open invoice — the deposit before the balance", () => {
  eq(defaultApplyTo([balance, deposit])?.id, "a");
  eq(defaultApplyTo([]), null, "nothing open: the order itself");
});
