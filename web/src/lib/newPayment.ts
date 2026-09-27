/**
 * NEW INVOICE and NEW PAYMENT — the order's two doors for money (Mark,
 * 2026-09-25, migration 139; split into two the same day: "It's a little
 * strange to combine payments and invoices now"). An INVOICE asks for money —
 * the balance, a deposit, another amount. A PAYMENT records money received,
 * applied to one of the order's open invoices or to the order itself.
 *
 * Pure, so it is fixture-tested and imports nothing that talks to a server.
 * The database is the authority (`create_payment_invoice`, the line trigger
 * and `record_customer_invoice_payment` refuse the same things in words);
 * this is the dialogs saying them first, and the % ↔ $ pair a deposit is
 * typed in.
 */

import { depositAmount, money } from "./specialOrders";

export type NewInvoiceChoice = "balance" | "deposit" | "other";

export const NEW_INVOICE_LABEL: Record<NewInvoiceChoice, string> = {
  balance: "Balance Due",
  deposit: "Deposit",
  other: "Other",
};

/** An open invoice a payment can be applied to: not void, not paid. `due` is
 *  the WHOLE invoice's — a weekly invoice's payment is split across its
 *  orders by the database. `posted`: sent, or already holding money — a bill
 *  the customer has (144). */
export type OpenInvoice = { id: string; number: number; label: string; what: string; due: number; posted: boolean };

const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * WHAT IS NOT YET BILLED — `special_order_unbilled` in SQL (141): the order's
 * total less every line it has on its live invoices, paid or not. Money taken
 * on the order without an invoice (cash) is a PAYMENT, held, and applies when
 * an invoice for the order is sent — it no longer shrinks what is left to
 * bill. A cancelled order's total is nothing. Negative when an order shrank
 * after it was billed, which the dialog reads as nothing left.
 */
export function unbilledAmount(args: {
  total: number;
  cancelled: boolean;
  liveLines: { amount: number }[];
}): number {
  const billed = args.liveLines.reduce((a, l) => a + Number(l.amount || 0), 0);
  return cents((args.cancelled ? 0 : args.total) - billed);
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
 * Why New Invoice's Continue cannot go ahead, in words — or null when it can.
 * `amountText` is the chosen option's own box (none for the balance).
 */
export function newInvoiceProblem(args: {
  choice: NewInvoiceChoice;
  amountText: string;
  unbilled: number;
  hasCustomer: boolean;
}): string | null {
  const { choice, unbilled } = args;
  if (!args.hasCustomer) return "Link a customer to this order before invoicing it.";
  if (unbilled <= 0.005) return "Nothing is left to bill on this order.";
  if (choice === "balance") return null;
  const amount = parseMoney(args.amountText);
  if (amount === null) return "Enter an amount.";
  if (amount > unbilled + 0.005) {
    return `That is more than the ${money(unbilled)} not yet billed.`;
  }
  return null;
}

/**
 * Why New Payment's Record cannot go ahead — or null. A payment applied to an
 * invoice may not be more than that invoice still asks for
 * (`record_customer_invoice_payment` refuses it too); one on the order itself
 * has no ceiling, the old Take a payment's rule.
 */
export function newPaymentProblem(args: { amountText: string; applyTo: OpenInvoice | null }): string | null {
  const amount = parseMoney(args.amountText);
  if (amount === null) return "Enter an amount.";
  if (args.applyTo && amount > args.applyTo.due + 0.005) {
    return `That is more than the ${money(args.applyTo.due)} due on ${args.applyTo.label}.`;
  }
  return null;
}

/**
 * Whether New Payment offers "The order — no invoice". Not while a bill the
 * customer has is open: since 144 money recorded on the order goes onto that
 * bill anyway (`record_order_payment`), so the choice would say one thing and
 * do another. A DRAFT does not count — money on an order with only a draft is
 * held, and applies when the draft is sent.
 */
export function offersOrderChoice(open: OpenInvoice[]): boolean {
  return !open.some((i) => i.posted);
}

/** Where a new payment goes unless somebody says otherwise: the OLDEST open
 *  invoice — a deposit before the balance — or the order when none is open. */
export function defaultApplyTo(open: OpenInvoice[]): OpenInvoice | null {
  return [...open].sort((a, b) => a.number - b.number)[0] ?? null;
}
