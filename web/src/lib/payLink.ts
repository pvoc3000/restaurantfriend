/**
 * THE PAY LINK — `/pay/{token}` (migration 119).
 *
 * Pure, so it is fixture-tested and imports nothing that talks to a server:
 * what each state says to a customer, how dollars become the integer cents
 * Square counts in, and which of Square's two script hosts to load.
 *
 * The decision behind the feature is in CLAUDE.md's customer-invoices thread
 * (Mark, 2026-09-22): Square collects, on our own page, through Square's Web
 * Payments SDK — because Square will not let the API pay an invoice Square
 * hosts, and the invoice is ours.
 */

import type { QuoteSnapshot } from "./specialOrderSend";
import type { CustomerInvoiceSnapshot } from "./customerInvoices";

/**
 * What the pay page renders — the invoice AS SENT. The same document shape as
 * the quote's snapshot, and for the same reason: a capability URL exposes the
 * paper that was already emailed and nothing behind it.
 */
export type InvoiceSnapshot = QuoteSnapshot | CustomerInvoiceSnapshot;

export type SquareConfig = {
  environment: "production" | "sandbox";
  application_id: string;
  location_id: string;
};

export type PayTokenState =
  | { state: "unknown" }
  | { state: "superseded" }
  | { state: "cancelled" }
  | { state: "paid"; invoice?: InvoiceSnapshot; total?: number; paid?: number }
  | {
      state: "open";
      invoice: InvoiceSnapshot;
      total: number;
      paid: number;
      balance: number;
      /** Null when `orgs.settings.square_payments` is not filled in. */
      square: SquareConfig | null;
    };

/** What `square-pay` answers. */
export type PayResult =
  | { state: "paid"; amount: number; method?: string; receipt_url?: string; warning?: string }
  | { state: "declined"; message: string }
  | { state: "unconfirmed"; message: string }
  | { state: "busy" }
  | { state: "unknown" | "superseded" | "cancelled" };

/**
 * Integer cents, or null for anything that is not a whole number of cents.
 *
 * Postgres numeric arrives over JSON as a number or a string; `Math.round`
 * rather than truncation because 19.99 × 100 is 1998.9999999999998 in binary
 * floating point, and truncating that charges a customer a cent short. A value
 * with a THIRD decimal place is refused rather than rounded — no invoice total
 * is ever that, so one arriving means something upstream is wrong. The edge
 * function carries a copy of this; keep them the same.
 */
export function toCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents;
}

/** Square's SDK is served from a different host per environment, and a
 *  sandbox application id is refused by the production script. */
export function squareScriptUrl(environment: SquareConfig["environment"]): string {
  return environment === "sandbox"
    ? "https://sandbox.web.squarecdn.com/v1/square.js"
    : "https://web.squarecdn.com/v1/square.js";
}

/** Where the customer goes. The `/q/` link's twin. */
export function payUrl(token: string, base: string): string {
  return `${base.replace(/\/$/, "")}/pay/${token}`;
}

/**
 * The paragraph `{pay_line}` fills. The whole paragraph rather than the bare
 * link, so a template that leaves the token out simply offers no link.
 */
export function payLine(link: string): string {
  return link ? `\nYou can pay online here by card, Apple Pay, Google Pay or our gift card:\n${link}\n` : "";
}

/** The same sentence for QuickBooks' own pay page (131), which takes cards and
 *  bank transfers — not our gift card, and not the wallets Square offers. */
export function quickBooksPayLine(link: string): string {
  return link ? `\nYou can pay online here by card or bank transfer:\n${link}\n` : "";
}

/**
 * What every state other than `open` MEANS to somebody holding the link, in
 * their words. A customer reading the wrong sentence here is the failure of
 * this feature nobody would report.
 */
export function payStateMessage(
  state: PayTokenState["state"] | "busy" | "unavailable"
): { title: string; body: string } {
  switch (state) {
    case "unknown":
      return {
        title: "This link isn’t valid",
        body:
          "It may have been mistyped, or the invoice may have been withdrawn. " +
          "Reply to the email we sent you and we’ll sort it out.",
      };
    case "superseded":
      return {
        title: "This invoice has been updated",
        body: "Please check your email for the current one — the link in the newest message is the one to use.",
      };
    case "cancelled":
      return {
        title: "This order was cancelled",
        body: "There’s nothing to pay. If that’s a surprise, reply to our email and we’ll sort it out.",
      };
    case "paid":
      return {
        title: "Paid — thank you",
        body: "There’s nothing left to pay on this invoice.",
      };
    case "busy":
      return {
        title: "A payment is already in progress",
        body: "This invoice is being paid in another window. Please wait a couple of minutes and reload this page before trying again.",
      };
    case "unavailable":
      return {
        title: "Online payment isn’t available",
        body: "Please reply to our email and we’ll help you pay another way.",
      };
    case "open":
      return { title: "", body: "" };
  }
}
