/**
 * CUSTOMER INVOICES (migration 124) — the pure half.
 *
 * One invoice, one line per order, one pay link. Cafe Knotted's week is the
 * first user: seven standing-order days billed once, sent Sunday, due
 * Thursday. Weekly is Knotted's arrangement rather than a rule, and regular
 * special orders are meant to move onto this record later — a one-order
 * invoice is simply one line — so nothing here assumes a week.
 *
 * Fixture-tested; imports nothing that talks to a server.
 */

import { usDate } from "./specialOrderDocs";

/* ==========================================================================
 * THE RECORD
 * ========================================================================== */

export type CustomerInvoice = {
  id: string;
  number: number;
  customer_id: string | null;
  issued_on: string;
  due_on: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  document_path: string | null;
  /** The latest send (128); `sent_at` stays the first. */
  last_sent_at?: string | null;
  /** Who takes the money (131). Locked once sent. */
  processor?: InvoiceProcessor;
  /** `{ qbo: { id, sync_token, doc_number, invoice_link, attachments } }` once
   *  a QuickBooks invoice has been pushed (131). */
  external_ref?: Record<string, unknown> | null;
};

/** Square (the pay link, the default) or QuickBooks Payments (131). */
export type InvoiceProcessor = "square" | "quickbooks";

export const PROCESSOR_OPTIONS: { value: InvoiceProcessor; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "quickbooks", label: "QuickBooks" },
];

export const PROCESSOR_LABEL: Record<InvoiceProcessor, string> = {
  square: "Square",
  quickbooks: "QuickBooks",
};

/**
 * WHICH SQUARE ITEM A LINE IS SOLD AS (126) — a kind, resolved to this
 * environment's variation at pay time. Written at creation by 125's rule (a
 * standing-order day is Wholesale) and changeable per line until the invoice
 * is paid or void.
 */
export type SquareItem = "special_order" | "wholesale";

export const SQUARE_ITEM_OPTIONS: { value: SquareItem; label: string }[] = [
  { value: "special_order", label: "Special Order" },
  { value: "wholesale", label: "Wholesale Order" },
];

export const SQUARE_ITEM_LABEL: Record<SquareItem, string> = {
  special_order: "Special Order",
  wholesale: "Wholesale Order",
};

export type CustomerInvoiceLine = {
  id: string;
  special_order_id: string;
  description: string;
  amount: number;
  sort: number | null;
  square_item: SquareItem;
  /** What this line said when the invoice was last sent (128); null before. */
  sent_amount?: number | null;
};

export type InvoiceStatus = "draft" | "sent" | "changed" | "overdue" | "paid" | "void";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  changed: "Changed since sent",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = ["draft", "sent", "changed", "overdue", "paid", "void"];

/**
 * The status chip's colours (Mark, 2026-09-24: "an invoice chip class like
 * BILL_STAGE_CLASS or PO_STATUS_CLASS"), on those two maps' terms. Outstanding
 * wears the warm marks — sent yellow, changed-since-sent orange (it needs
 * sending again), overdue red (it needs a person); paid is the quiet white a
 * paid bill wears, finished business; draft and void keep the neutral and the
 * faint ones a PO's draft and void have.
 */
export const INVOICE_STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "border border-neutral-300 bg-neutral-100 text-muted",
  sent: "border border-ink bg-[var(--rf-yellow-200)] text-ink",
  changed: "border border-ink bg-[var(--rf-orange-200)] text-ink",
  overdue: "border border-ink bg-[var(--rf-red-200)] text-ink",
  paid: "border border-ink bg-white text-ink",
  void: "border border-neutral-300 bg-white text-faint",
};

/**
 * DERIVED, never stored — 124 keeps only the invoice's own dates. Void wins
 * over everything (a voided invoice that was paid is a refund to make, which
 * the screen says separately). CHANGED SINCE SENT (128) comes next, over paid
 * as well: an order that shrank after payment leaves a paid invoice that owes
 * the customer a credit, and the customer's copy is wrong either way until it
 * is re-sent. Then paid over sent; overdue is a sent invoice past its due
 * date. Dates are ISO strings, so they compare as text.
 */
export function invoiceStatus(
  inv: Pick<CustomerInvoice, "sent_at" | "paid_at" | "voided_at" | "due_on">,
  today: string,
  /** `invoiceChanged(lines)` — false where the caller has no lines. */
  changed = false
): InvoiceStatus {
  if (inv.voided_at) return "void";
  if (inv.sent_at && changed) return "changed";
  if (inv.paid_at) return "paid";
  if (!inv.sent_at) return "draft";
  if (inv.due_on && inv.due_on < today) return "overdue";
  return "sent";
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function invoiceTotal(lines: Pick<CustomerInvoiceLine, "amount">[]): number {
  return cents(lines.reduce((a, l) => a + Number(l.amount || 0), 0));
}

/** Payments TAGGED WITH THIS INVOICE only — an order's other payments (a
 *  deposit taken before it was invoiced) were netted out of its line when the
 *  line was written. Refunds are negative rows and count. */
export function invoiceBalance(
  lines: Pick<CustomerInvoiceLine, "amount">[],
  payments: { amount: number | null }[]
): { total: number; paid: number; balance: number } {
  const total = invoiceTotal(lines);
  const paid = cents(payments.reduce((a, p) => a + Number(p.amount || 0), 0));
  return { total, paid, balance: cents(total - paid) };
}

/* ==========================================================================
 * THE LINE
 * ========================================================================== */

/**
 * "Order #10070 · Birthday · 9/26/2026" — Mark's wording for an order on one
 * line (2026-09-22, the pay page; 2026-09-23, the invoice). The order's own
 * name, else the customer's; the date is the EVENT's, the one the customer
 * knows the order by. Empty parts drop out.
 */
export function orderLineDescription(o: {
  number: string;
  title: string | null;
  customer_name?: string | null;
  event_date: string | null;
}): string {
  return [`Order #${o.number}`, o.title || o.customer_name || "", usDate(o.event_date)]
    .filter((part) => part && part.trim() !== "")
    .join(" · ");
}

/**
 * WHETHER A LINE HAS MOVED SINCE THE CUSTOMER LAST SAW IT (128). The line
 * follows its order automatically; what went out is `sent_amount`. A cent or
 * more either way, and never before the first send.
 */
export function lineChanged(line: { amount: number; sent_amount?: number | null }): boolean {
  if (line.sent_amount === null || line.sent_amount === undefined) return false;
  return Math.abs(cents(Number(line.amount) - Number(line.sent_amount))) >= 0.01;
}

export function invoiceChanged(lines: { amount: number; sent_amount?: number | null }[]): boolean {
  return lines.some(lineChanged);
}

/* ==========================================================================
 * CREATING ONE
 * ========================================================================== */

/** The slice of a list row the create command needs. */
export type InvoiceCandidate = {
  id: string;
  number: string;
  kind: string;
  status: string | null;
  title: string | null;
  event_date: string | null;
  customer_id: string | null;
  customer_name: string;
  /** Where the money lands (120): the kitchen, else the pickup shop. */
  shop: string | null;
  balance: number;
  /** Already on a customer invoice that is not void. */
  on_invoice?: boolean;
};

/**
 * Why a selection cannot become one invoice, in words — or an empty list.
 * The SAME rules `create_customer_invoice` enforces, said before the dialog
 * opens rather than as a Postgres error after it commits. Since 127 the list
 * knows which orders are already invoiced too; the database still checks.
 */
export function createRefusals(rows: InvoiceCandidate[]): string[] {
  const out: string[] = [];
  if (rows.length === 0) return ["Select the orders to invoice."];
  const notOrders = rows.filter((r) => r.kind !== "order");
  if (notOrders.length) {
    out.push(`${plural(notOrders.length, "row is", "rows are")} a template or a standing order, not a day.`);
  }
  const cancelled = rows.filter((r) => r.kind === "order" && r.status === "cancelled");
  if (cancelled.length) out.push(`${plural(cancelled.length, "order is", "orders are")} cancelled.`);
  const customers = new Set(rows.map((r) => r.customer_id ?? ""));
  if (customers.has("")) out.push("An order with no customer cannot be invoiced.");
  else if (customers.size > 1) out.push("An invoice is for one customer — these are for several.");
  const shops = new Set(rows.map((r) => r.shop ?? ""));
  if (shops.size > 1) {
    out.push("These orders are made at different shops, so one payment cannot cover them.");
  }
  const taken = rows.filter((r) => r.on_invoice);
  if (taken.length) {
    out.push(`${plural(taken.length, "order is", "orders are")} already on an invoice — void that one first.`);
  }
  const settled = rows.filter((r) => r.kind === "order" && r.balance <= 0.005);
  if (settled.length) out.push(`${plural(settled.length, "order has", "orders have")} nothing owed.`);
  return out;
}

/**
 * The lines, oldest event first, each for what the order still OWES — its
 * balance, not its total, so an order with a deposit already taken is not
 * billed for it twice. For Knotted's days, which carry no payments until the
 * invoice is paid, balance and total are the same figure.
 */
export function invoiceLinesFor(
  rows: InvoiceCandidate[]
): { order_id: string; description: string; amount: number }[] {
  return [...rows]
    .sort(
      (a, b) =>
        (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999") ||
        a.number.localeCompare(b.number, undefined, { numeric: true })
    )
    .map((r) => ({
      order_id: r.id,
      description: orderLineDescription(r),
      amount: cents(r.balance),
    }));
}

/**
 * A ONE-TIME CODE FOR "OPEN SEND ON ARRIVAL" (`?send=<code>`). A bare
 * `?send=1` reopened the card every time the page came back from Next's
 * cache — Mark, 2026-09-23: "I navigated away from the invoice, then back
 * again and … the send invoice by email panel popped up". The invoice page
 * remembers each code it has acted on, for the tab's lifetime.
 */
export function sendIntent(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* ==========================================================================
 * TERMS AND NAMES — `orgs.settings.customer_invoices`, design rule 2
 * ========================================================================== */

export type InvoiceTerms = { termsDays: number; prefix: string };

export const DEFAULT_INVOICE_TERMS: InvoiceTerms = { termsDays: 4, prefix: "" };

export function readInvoiceTerms(orgSettings: Record<string, unknown> | null | undefined): InvoiceTerms {
  const ci = ((orgSettings ?? {}).customer_invoices ?? {}) as Record<string, unknown>;
  const days = Number(ci.terms_days);
  return {
    termsDays: Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_INVOICE_TERMS.termsDays,
    prefix: typeof ci.prefix === "string" ? ci.prefix : DEFAULT_INVOICE_TERMS.prefix,
  };
}

/** `issued` + `days`, as an ISO date. Calendar days, in UTC arithmetic so a
 *  daylight-saving night cannot move the answer. */
export function addDays(issued: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(issued);
  if (!m) return issued;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "1001", or "DF-1001" with a prefix. What the paper and the email print. */
export function invoiceNumberText(number: number, terms: Pick<InvoiceTerms, "prefix">): string {
  return `${terms.prefix}${number}`;
}

export function invoiceFileName(numberText: string, date: string): string {
  const dotted = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10).replace(/-/g, ".") : date;
  return `INVOICE#${numberText}_${dotted}.pdf`;
}

/* ==========================================================================
 * THE SNAPSHOT — what `/pay/{token}` shows for an invoice
 * ========================================================================== */

/**
 * The invoice AS SENT, the pay token's `document_snapshot` (124). Its own
 * shape rather than the order's `QuoteSnapshot`: it has lines of its own, one
 * per order, and no event, fulfillment or itemisation — the attached PDF is
 * the paper. `kind` is what tells the page which it is holding.
 */
export type CustomerInvoiceSnapshot = {
  kind: "customer_invoice";
  /** With the org's prefix — what the paper prints. */
  number: string;
  /** The customer, which is what Square's line and the page's heading say. */
  title: string;
  customer_name: string;
  issued_on: string;
  due_on: string | null;
  lines: { description: string; amount: number }[];
  totals: { total: number };
  notes_quote: string | null;
  org: { name: string; addressLine: string; contactLine: string; terms: string };
  sent_on: string;
};

export function isCustomerInvoiceSnapshot(s: unknown): s is CustomerInvoiceSnapshot {
  return !!s && typeof s === "object" && (s as { kind?: unknown }).kind === "customer_invoice";
}

/* ==========================================================================
 * THE PAY LINK'S BREAKDOWN — one invoice, several orders
 * ========================================================================== */

export type PayBreakdownParts = {
  taxable_net: number;
  other_net: number;
  delivery: number;
  tax: number;
  tax_rate: number;
  total: number;
};

/**
 * The orders' breakdowns summed into one, for the single Square order behind
 * an invoice payment (`_shared/squareOrder`). Square applies ONE tax rate per
 * line, so orders taxed at different rates cannot share a taxable line: that
 * returns null, and `buildSquareOrder` falls back to one line for the whole
 * amount — the payment still goes through, it is only less itemised.
 */
export function sumBreakdowns(parts: PayBreakdownParts[]): PayBreakdownParts | null {
  if (parts.length === 0) return null;
  const taxed = parts.filter((p) => p.taxable_net > 0);
  const rates = new Set(taxed.map((p) => p.tax_rate));
  if (rates.size > 1) return null;
  const sum = (k: keyof PayBreakdownParts) => cents(parts.reduce((a, p) => a + Number(p[k] || 0), 0));
  return {
    taxable_net: sum("taxable_net"),
    other_net: sum("other_net"),
    delivery: sum("delivery"),
    tax: sum("tax"),
    tax_rate: taxed[0]?.tax_rate ?? 0,
    total: sum("total"),
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
