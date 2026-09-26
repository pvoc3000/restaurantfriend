/**
 * NEW PAYMENT — the order's one door for money (Mark, 2026-09-25, migration
 * 139): take cash now, or ask for money with an invoice of its own — the
 * balance, a deposit, or another amount.
 *
 * Pure, so it is fixture-tested and imports nothing that talks to a server.
 * The database is the authority (`create_payment_invoice` and the line
 * trigger refuse the same things in words); this is the dialog saying them
 * first, and the % ↔ $ pair a deposit is typed in.
 */

import { depositAmount, money } from "./specialOrders";

export type NewPaymentChoice = "cash" | "balance" | "deposit" | "other";

export const NEW_PAYMENT_LABEL: Record<NewPaymentChoice, string> = {
  cash: "Cash Payment",
  balance: "Invoice Balance Due",
  deposit: "Invoice Deposit",
  other: "Invoice Other",
};

const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * WHAT IS NOT YET INVOICED — `special_order_uninvoiced` in SQL, line for line:
 * the order's total, less payments on no live invoice (cash; a voided
 * invoice's), less every line on its live invoices, paid or not. Zero for a
 * cancelled order. Can go negative (an order shrunk after a deposit), which
 * the dialog reads as nothing left.
 */
export function uninvoicedAmount(args: {
  total: number;
  cancelled: boolean;
  payments: { amount: number | null; invoiceLive: boolean }[];
  liveLines: { amount: number }[];
}): number {
  if (args.cancelled) return 0;
  const offInvoice = args.payments
    .filter((p) => !p.invoiceLive)
    .reduce((a, p) => a + Number(p.amount || 0), 0);
  const invoiced = args.liveLines.reduce((a, l) => a + Number(l.amount || 0), 0);
  return cents(args.total - offInvoice - invoiced);
}

/** A typed dollar figure, or null for anything that is not a positive amount
 *  to the cent. "$1,250.50" and "1250.5" both read. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{0,2})?$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? cents(n) : null;
}

/** The deposit box's $ from its % — of the ORDER's total, which is what a
 *  "10% deposit" means to a customer. Empty when the % does not read. */
export function amountFromPercent(total: number, percentText: string): string {
  const p = Number(percentText.replace(/[%\s]/g, ""));
  if (!percentText.trim() || !Number.isFinite(p) || p <= 0 || p >= 100) return "";
  const amount = depositAmount(total, p / 100);
  return amount > 0 ? amount.toFixed(2) : "";
}

/** The deposit box's % from its $, to two places ("12.5", not "12.50"). */
export function percentFromAmount(total: number, amountText: string): string {
  const a = parseMoney(amountText);
  if (a === null || !(total > 0)) return "";
  return String(Number(((a / total) * 100).toFixed(2)));
}

/**
 * Why Continue cannot go ahead, in words — or null when it can. `amountText`
 * is the chosen option's own box (none for the balance).
 */
export function newPaymentProblem(args: {
  choice: NewPaymentChoice;
  amountText: string;
  uninvoiced: number;
  hasBalanceInvoice: boolean;
  hasCustomer: boolean;
}): string | null {
  const { choice, uninvoiced } = args;
  if (choice !== "cash" && !args.hasCustomer) {
    return "Link a customer to this order before invoicing it.";
  }
  if (choice === "balance") {
    if (args.hasBalanceInvoice) return "An invoice already bills this order's balance.";
    if (uninvoiced <= 0.005) return "Nothing is left to invoice on this order.";
    return null;
  }
  const amount = parseMoney(args.amountText);
  if (amount === null) return "Enter an amount.";
  if (choice !== "cash" && amount > uninvoiced + 0.005) {
    return `That is more than the ${money(Math.max(uninvoiced, 0))} not yet invoiced.`;
  }
  return null;
}
