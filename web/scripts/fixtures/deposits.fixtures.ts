// Deposits (migration 138) — the pure half: what a deposit comes to, an
// invoice's deposit and when paying it is a real choice, and the email's
// sentence.
//
// The figures are the throwaway-Postgres run's: a $368.50 order at 10% is
// $36.85 there too (`special_order_deposit`), and 100.05 × 10% is 10.01 in both
// — double precision, not exact numeric, which would say 10.01 by a different
// road and disagree elsewhere.
//
// Checked by breaking: rounding with Math.round(x·100)/100 instead of floor(+.5)
// is invisible here, so the case that guards the arithmetic is the cap — drop
// `Math.min(…, amount)` in `invoiceDeposit` and "a line shrunk by an earlier
// payment" goes red; let `due` equal the balance and "no choice when the
// deposit is the whole balance" goes red.

import { test, eq } from "./harness";
import { depositAmount, readSettings, validDepositRate } from "../../src/lib/specialOrders";
import { invoiceDeposit } from "../../src/lib/customerInvoices";
import { depositSentence } from "../../src/lib/payLink";

test("depositAmount: total × rate, to the cent, as SQL rounds it", () => {
  eq(depositAmount(368.5, 0.1), 36.85);
  eq(depositAmount(100.05, 0.1), 10.01);
  eq(depositAmount(613.5, 0.25), 153.38, "half a cent rounds up");
  eq(depositAmount(368.5, null), 0, "no deposit asked");
  eq(depositAmount(0, 0.1), 0, "an empty order asks for nothing");
});

test("validDepositRate: a fraction strictly between 0 and 1, else no deposit", () => {
  eq(validDepositRate(0.1), 0.1);
  eq(validDepositRate("0.1"), 0.1, "PostgREST numeric as a string");
  eq(validDepositRate(0), null);
  eq(validDepositRate(1), null);
  eq(validDepositRate(10), null, "a percentage typed where a fraction belongs");
  eq(validDepositRate(null), null);
});

test("readSettings: deposit rate defaults to 10%, and a bad one falls back", () => {
  eq(readSettings({}).depositRate, 0.1);
  eq(readSettings({ special_orders: { deposit_rate: 0.25 } }).depositRate, 0.25);
  eq(readSettings({ special_orders: { deposit_rate: 25 } }).depositRate, 0.1);
});

const line = (amount: number, orderTotal: number, depositRate: number | null) => ({ amount, orderTotal, depositRate });

test("invoiceDeposit: one order at 10%, nothing paid", () => {
  eq(invoiceDeposit([line(368.5, 368.5, 0.1)], 0, 368.5), { deposit: 36.85, due: 36.85, rate: 0.1 });
});

test("invoiceDeposit: met once the payments reach it", () => {
  eq(invoiceDeposit([line(368.5, 368.5, 0.1)], 36.85, 331.65).due, 0);
  eq(invoiceDeposit([line(368.5, 368.5, 0.1)], 20, 348.5).due, 16.85, "a part-paid deposit asks for the rest");
});

test("invoiceDeposit: no deposit asked — nothing, and no rate", () => {
  eq(invoiceDeposit([line(368.5, 368.5, null)], 0, 368.5), { deposit: 0, due: 0, rate: null });
});

test("invoiceDeposit: a line shrunk by an earlier payment is the cap", () => {
  eq(invoiceDeposit([line(20, 368.5, 0.1)], 0, 20).deposit, 20);
});

test("invoiceDeposit: no choice when the deposit is the whole balance", () => {
  eq(invoiceDeposit([line(20, 368.5, 0.1)], 0, 20).due, 0);
});

test("invoiceDeposit: two orders — summed; mixed rates print no rate", () => {
  const d = invoiceDeposit([line(100, 100, 0.1), line(200, 200, 0.2)], 0, 300);
  eq(d.deposit, 50);
  eq(d.rate, null);
  eq(invoiceDeposit([line(100, 100, 0.1), line(200, 200, null)], 0, 300), { deposit: 10, due: 10, rate: 0.1 });
});

test("depositSentence: says the deposit and that paying in full is fine", () => {
  eq(
    depositSentence(36.85, "10%"),
    "\nA deposit of $36.85 (10%) holds your date — you can pay that now and the rest later, or pay in full.\n"
  );
  eq(depositSentence(36.85, null).includes("$36.85 holds"), true, "no rate, no brackets");
  eq(depositSentence(0, "10%"), "", "nothing to say without a deposit");
});
