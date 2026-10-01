/**
 * CUSTOMER INVOICES (migration 124) — the pure half.
 *
 * Since 141 an invoice OWNS its lines: adding an order copies its charges —
 * items, discount, delivery, rush, tax, and "Less invoice N" for what its
 * other invoices bill — and a FREE line ("Delivery Fee") belongs to no order.
 * A sent invoice, or one holding money, is frozen. The lines group by order
 * for the paper, the pay link and QuickBooks; this module does the grouping.
 * Cafe Knotted's week is the first user, and nothing here assumes a week.
 *
 * Fixture-tested; imports nothing that talks to a server.
 */

import { usDate } from "./specialOrderDocs";
import { businessDaysBefore } from "./specialOrders";

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
  /** 143: 1 for an invoice as first made; a revision is 2, 3… of the same
   *  number, and names the invoice it replaces. */
  revision?: number;
  revision_of?: string | null;
  /** `{ qbo: { id, sync_token, doc_number, invoice_link, attachments } }` once
   *  a QuickBooks invoice has been pushed (131). */
  external_ref?: Record<string, unknown> | null;
};

/** Square (the pay link) or QuickBooks Payments (131). */
export type InvoiceProcessor = "square" | "quickbooks";

/**
 * WHAT A NEW INVOICE COLLECTS THROUGH unless somebody picks the other (Mark,
 * 2026-10-01: "make paying through quickbooks the default option on special
 * orders and invoices"). Square until then. Both create dialogs — an order's
 * Create Invoice… and the invoices list's New invoice — start here, so they
 * cannot disagree. It is only the dialog's starting value; the choice is still
 * offered every time, and an existing invoice keeps what it has.
 */
export const DEFAULT_PROCESSOR: InvoiceProcessor = "quickbooks";

/** QuickBooks first, the default (Mark, 2026-10-01). */
export const PROCESSOR_OPTIONS: { value: InvoiceProcessor; label: string }[] = [
  { value: "quickbooks", label: "QuickBooks" },
  { value: "square", label: "Square" },
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

/**
 * WHAT A LINE ASKS FOR (migration 139). `balance` is an order's charges;
 * `deposit` and `other` are a fixed amount somebody asked for with New
 * Invoice. Since 141 the line's TYPE says what it is; this says why.
 */
export type InvoiceLineKind = "balance" | "deposit" | "other";

/**
 * WHAT A LINE IS (141). An order's charges are `item` … `tax`, less
 * `prior_billing` ("Less invoice 1015"); `deposit` is a fixed figure;
 * `order_total` is one line for a whole order, the shape invoices sent before
 * 141 have. A FREE line — no order — is an `item` or a `delivery`.
 */
export type InvoiceLineType =
  | "item"
  | "discount"
  | "delivery"
  | "rush"
  | "tax"
  | "deposit"
  | "prior_billing"
  | "order_total";

/** What a free line can be, for Add Line…. */
export const FREE_LINE_TYPES: { value: "item" | "delivery"; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "item", label: "Item" },
];

/** "" for a plain balance line, so a one-invoice order reads as it did. The
 *  line's own wording says "Balance due" once the order has other invoices. */
export const LINE_KIND_LABEL: Record<InvoiceLineKind, string> = {
  balance: "",
  deposit: "Deposit",
  other: "Part payment",
};

export type CustomerInvoiceLine = {
  id: string;
  /** Null on a FREE line, which belongs to the invoice alone (141). */
  special_order_id: string | null;
  line_type: InvoiceLineType;
  description: string;
  qty: number | null;
  unit_price: number | null;
  amount: number;
  taxable: boolean;
  /** On a tax line, the order's rate. */
  tax_rate: number | null;
  /** "Order #10057 · Cafe Knotted SO (M-Th) · 10/5/2026", frozen when copied. */
  order_label: string | null;
  sort: number | null;
  square_item: SquareItem;
  /** 139 — why an order's line is here; see `InvoiceLineKind`. */
  kind?: InvoiceLineKind;
};

export type InvoiceStatus = "draft" | "sent" | "overdue" | "paid" | "void";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = ["draft", "sent", "overdue", "paid", "void"];

/**
 * The status chip's colours (Mark, 2026-09-24: "an invoice chip class like
 * BILL_STAGE_CLASS or PO_STATUS_CLASS"), on those two maps' terms. Outstanding
 * wears the warm marks — sent yellow, overdue red (it needs a person); paid is
 * the quiet white a paid bill wears, finished business; draft and void keep
 * the neutral and the faint ones a PO's draft and void have. (128's orange
 * "changed since sent" went with 141: a sent invoice no longer changes.)
 */
export const INVOICE_STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "border border-neutral-300 bg-neutral-100 text-muted",
  sent: "border border-ink bg-[var(--rf-yellow-200)] text-ink",
  overdue: "border border-ink bg-[var(--rf-red-200)] text-ink",
  paid: "border border-ink bg-white text-ink",
  void: "border border-neutral-300 bg-white text-faint",
};

/**
 * DERIVED, never stored — 124 keeps only the invoice's own dates. Void wins
 * over everything (a voided invoice that was paid is a refund to make, which
 * the screen says separately). Then paid over sent; overdue is a sent invoice
 * past its due date. Dates are ISO strings, so they compare as text.
 */
export function invoiceStatus(
  inv: Pick<CustomerInvoice, "sent_at" | "paid_at" | "voided_at" | "due_on">,
  today: string
): InvoiceStatus {
  if (inv.voided_at) return "void";
  if (inv.paid_at) return "paid";
  if (!inv.sent_at) return "draft";
  if (inv.due_on && inv.due_on < today) return "overdue";
  return "sent";
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function invoiceTotal(lines: Pick<CustomerInvoiceLine, "amount">[]): number {
  return cents(lines.reduce((a, l) => a + Number(l.amount || 0), 0));
}

/** Money APPLIED TO THIS INVOICE (140's applications) — an order's money
 *  held elsewhere is not this invoice's until it is sent (141). Refunds are
 *  negative and count. */
export function invoiceBalance(
  lines: Pick<CustomerInvoiceLine, "amount">[],
  payments: { amount: number | null }[]
): { total: number; paid: number; balance: number } {
  const total = invoiceTotal(lines);
  const paid = cents(payments.reduce((a, p) => a + Number(p.amount || 0), 0));
  return { total, paid, balance: cents(total - paid) };
}

/** The printed invoice's Totals window (Mark, 2026-09-27). */
export type InvoiceTotalsBreakdown = {
  subtotal: number;
  discount: number;
  delivery: number;
  rush: number;
  tax: number;
  /** "Less invoice N" — what the orders' other invoices already bill (141). */
  prior: number;
  /** What has been applied to this invoice. */
  payments: number;
};

/**
 * THE LINES, SUMMED BY TYPE (141) — so the Totals window reads like an order's
 * and adds to Amount due to the cent: Subtotal − Discount + Delivery + Rush
 * fee + Tax − Invoiced earlier − Payments. Items, deposits and the one-line
 * orders sent before 141 are the Subtotal; a free Delivery Fee is Delivery.
 */
export function invoiceTotalsBreakdown(
  lines: Pick<CustomerInvoiceLine, "line_type" | "amount">[],
  paid: number
): InvoiceTotalsBreakdown {
  const by = (types: InvoiceLineType[]) =>
    cents(lines.filter((l) => types.includes(l.line_type)).reduce((a, l) => a + Number(l.amount || 0), 0));
  return {
    subtotal: by(["item", "deposit", "order_total"]),
    discount: -by(["discount"]),
    delivery: by(["delivery"]),
    rush: by(["rush"]),
    tax: by(["tax"]),
    prior: -by(["prior_billing"]),
    payments: cents(paid),
  };
}

/* ==========================================================================
 * THE GROUPS — each order's lines together, then the invoice's own
 * ========================================================================== */

/** How an order sits on an invoice: its CHARGES copied (less what is billed
 *  elsewhere), a fixed DEPOSIT, or one ORDER_TOTAL line from before 141. */
export type InvoiceGroupKind = "charges" | "deposit" | "order_total" | "free";

export type InvoiceGroup<L extends Pick<CustomerInvoiceLine, "special_order_id" | "line_type" | "amount" | "sort" | "order_label" | "description"> = CustomerInvoiceLine> = {
  /** The order's id, or "free" — the pay link's and the breakdown's key. */
  key: string;
  orderId: string | null;
  /** The band: the order's label, or "Other charges". */
  label: string;
  kind: InvoiceGroupKind;
  lines: L[];
  /** What the group bills on this invoice. */
  net: number;
};

export const FREE_GROUP_LABEL = "Other charges";

/**
 * The lines in their groups: orders by event date then number (the order a
 * payment is split in, 141's `customer_invoice_payment_groups`), each group's
 * lines in their own order, and the free lines last.
 */
export function groupInvoiceLines<
  L extends Pick<CustomerInvoiceLine, "special_order_id" | "line_type" | "amount" | "sort" | "order_label" | "description">
>(lines: L[], orders: Map<string, { number: string; event_date: string | null }>): InvoiceGroup<L>[] {
  const byKey = new Map<string, L[]>();
  for (const l of lines) {
    const k = l.special_order_id ?? "free";
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }
  const bySort = (a: L, b: L) => (a.sort ?? 0) - (b.sort ?? 0);
  const groups: InvoiceGroup<L>[] = [];
  for (const [key, ls] of byKey) {
    const sorted = [...ls].sort(bySort);
    const free = key === "free";
    groups.push({
      key,
      orderId: free ? null : key,
      label: free ? FREE_GROUP_LABEL : sorted[0]?.order_label || `Order #${orders.get(key)?.number ?? "?"}`,
      kind: free
        ? "free"
        : sorted.some((l) => l.line_type === "deposit")
          ? "deposit"
          : sorted.some((l) => l.line_type === "order_total")
            ? "order_total"
            : "charges",
      lines: sorted,
      net: cents(sorted.reduce((a, l) => a + Number(l.amount || 0), 0)),
    });
  }
  // The free lines LAST, by rule — not by a sentinel string, which a locale
  // collation happily sorts ahead of the digits of a date.
  return groups.sort((a, b) => {
    if (!a.orderId || !b.orderId) return Number(!a.orderId) - Number(!b.orderId);
    const ao = orders.get(a.orderId);
    const bo = orders.get(b.orderId);
    return (
      (ao?.event_date ?? "9999").localeCompare(bo?.event_date ?? "9999") ||
      (ao?.number ?? "").localeCompare(bo?.number ?? "", undefined, { numeric: true })
    );
  });
}

/**
 * A group's money in `orderTotals`' shape, from its LINES — what the pay
 * link's breakdown and the QuickBooks push are cut from, so they bill what the
 * paper says rather than what the order says today. `total` is the charges
 * before "Less invoice"; the group's `net` is what it bills here.
 */
export function groupTotals(lines: Pick<CustomerInvoiceLine, "line_type" | "amount" | "taxable">[]): {
  subtotal: number;
  taxableSubtotal: number;
  discount: number;
  deliveryCharge: number;
  rushFee: number;
  tax: number;
  total: number;
} {
  const sum = (pick: (l: (typeof lines)[number]) => boolean) =>
    cents(lines.filter(pick).reduce((a, l) => a + Number(l.amount || 0), 0));
  const subtotal = sum((l) => l.line_type === "item" || l.line_type === "order_total" || l.line_type === "deposit");
  const taxableSubtotal = sum((l) => l.line_type === "item" && l.taxable);
  const discount = -sum((l) => l.line_type === "discount");
  const deliveryCharge = sum((l) => l.line_type === "delivery");
  const rushFee = sum((l) => l.line_type === "rush");
  const tax = sum((l) => l.line_type === "tax");
  return {
    subtotal,
    taxableSubtotal,
    discount,
    deliveryCharge,
    rushFee,
    tax,
    total: cents(subtotal - discount + deliveryCharge + rushFee + tax),
  };
}

/**
 * A breakdown SCALED to what a group bills here — its charges less "Less
 * invoice N", or a deposit's share of the order. Every part is scaled and the
 * untaxed goods take the difference, so the parts always add to `net` exactly
 * (`_shared/squareOrder` checks the total to the cent).
 */
export function scaleBreakdown(p: PayBreakdownParts, net: number): PayBreakdownParts {
  if (Math.abs(p.total - net) < 0.005) return { ...p, total: cents(net) };
  if (!(p.total > 0)) return { taxable_net: 0, other_net: cents(net), delivery: 0, tax: 0, tax_rate: p.tax_rate, total: cents(net) };
  const f = net / p.total;
  const taxable_net = cents(p.taxable_net * f);
  const delivery = cents(p.delivery * f);
  const tax = cents(p.tax * f);
  return {
    taxable_net,
    delivery,
    tax,
    other_net: cents(net - taxable_net - delivery - tax),
    tax_rate: p.tax_rate,
    total: cents(net),
  };
}

/**
 * What the pay page lists (the snapshot's `lines`): each order ONCE, for what
 * it bills here — a deposit says so — and each free line as itself.
 */
export function snapshotLines<
  L extends Pick<CustomerInvoiceLine, "special_order_id" | "line_type" | "amount" | "sort" | "order_label" | "description">
>(groups: InvoiceGroup<L>[]): { description: string; amount: number }[] {
  return groups.flatMap((g) =>
    g.orderId
      ? [{ description: g.kind === "deposit" ? `${g.lines[0]?.description ?? "Deposit"} · ${g.label}` : g.label, amount: g.net }]
      : g.lines.map((l) => ({ description: l.description, amount: cents(Number(l.amount)) }))
  );
}

/* ==========================================================================
 * THE PAPER — what the printed invoice's table says (Mark, 2026-09-27)
 * ========================================================================== */

/** One row's money in the printed columns. Signed: a discount is negative, so
 *  the five add up to what the row charges. */
export type PaperParts = { subtotal: number; discount: number; delivery: number; rush: number; tax: number };

export const PAPER_COLUMNS: { key: keyof PaperParts; label: string }[] = [
  { key: "subtotal", label: "Subtotal" },
  { key: "discount", label: "Discount" },
  { key: "delivery", label: "Delivery" },
  { key: "rush", label: "Rush fee" },
  { key: "tax", label: "Tax" },
];

export type PaperRow = {
  description: string;
  /** What the row charges: its parts added up, or an item's amount. */
  amount: number;
  /** The row's money by column, when the paper has columns. */
  parts?: PaperParts;
  /** A one-order invoice's items, when the paper is itemized. */
  detail?: { rows: { label: string; amount: number }[] };
  /** An OTHER CHARGE (141's free line), not an order. */
  free?: boolean;
};

/**
 * THE PRINTED INVOICE'S ROWS. Mark, 2026-09-27: "the numbers do not add up"
 * — each order's Amount was everything it cost, while the Totals window began
 * at a Subtotal of items. Now every figure sits in its own COLUMN, and each
 * column adds up to its line in the Totals window:
 *
 * - Several orders (or none): a row per order, its Subtotal, Discount,
 *   Delivery, Rush fee and Tax; then each other charge, an Item in Subtotal
 *   and a Delivery charge in Delivery.
 * - ONE order is ITEMIZED instead, its items in one Amount column that adds
 *   up to the Subtotal (Mark, 2026-09-23: a regular customer is used to
 *   seeing what they ordered) — unless an other charge is Delivery, which has
 *   no place in that column, and the paper takes the columns.
 *
 * "Invoiced earlier" and the payments are the invoice's, not a row's, and
 * stay in the Totals window alone.
 */
export function invoicePaper<
  L extends Pick<CustomerInvoiceLine, "special_order_id" | "line_type" | "amount" | "sort" | "order_label" | "description" | "qty" | "unit_price" | "taxable">
>(groups: InvoiceGroup<L>[]): { columns: boolean; rows: PaperRow[] } {
  const orderCount = groups.filter((g) => g.orderId).length;
  const freeDelivery = groups.some((g) => !g.orderId && g.lines.some((l) => l.line_type === "delivery"));
  const columns = orderCount !== 1 || freeDelivery;
  const qtyText = (q: number) => (q % 1 === 0 ? String(q) : q.toFixed(2));
  // `money` in lib/specialOrders, whose shape a price is printed in.
  const dollars = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
  const rows = groups.flatMap((g): PaperRow[] => {
    if (!g.orderId) {
      return g.lines.map((l) => {
        const amount = cents(Number(l.amount));
        const delivery = l.line_type === "delivery";
        return {
          description: l.description,
          amount,
          free: true,
          parts: { subtotal: delivery ? 0 : amount, discount: 0, delivery: delivery ? amount : 0, rush: 0, tax: 0 },
        };
      });
    }
    const t = groupTotals(g.lines);
    const parts: PaperParts = { subtotal: t.subtotal, discount: -t.discount, delivery: t.deliveryCharge, rush: t.rushFee, tax: t.tax };
    const items = g.lines.filter((l) => l.line_type === "item");
    return [
      {
        description: g.kind === "deposit" ? `${g.lines[0]?.description ?? "Deposit"} · ${g.label}` : g.label,
        amount: t.total,
        parts,
        detail:
          !columns && g.kind === "charges" && items.length > 0
            ? {
                rows: items.map((i) => ({
                  label:
                    i.qty !== null && i.unit_price !== null
                      ? `${qtyText(Number(i.qty))} × ${i.description} @ ${dollars(Number(i.unit_price))}`
                      : i.description,
                  amount: cents(Number(i.amount)),
                })),
              }
            : undefined,
      },
    ];
  });
  return { columns, rows };
}

/** The columns a paper's rows use; Subtotal always. */
export function paperColumns(rows: Pick<PaperRow, "parts">[]): typeof PAPER_COLUMNS {
  return PAPER_COLUMNS.filter(
    (c) => c.key === "subtotal" || rows.some((r) => Math.abs(r.parts?.[c.key] ?? 0) >= 0.005)
  );
}

/** The Totals window's lines, as the PDF prints them: Subtotal always, the
 *  rest when not zero, then what has been paid and what is due. */
export function paperTotals(
  b: Omit<InvoiceTotalsBreakdown, "payments">,
  paid: number,
  due: number
): { label: string; value: number; grand?: boolean }[] {
  const lines: { label: string; value: number; grand?: boolean }[] = [
    { label: "Subtotal", value: b.subtotal },
    { label: "Discount", value: -b.discount },
    { label: "Delivery", value: b.delivery },
    { label: "Rush fee", value: b.rush },
    { label: "Tax", value: b.tax },
    { label: "Invoiced earlier", value: -b.prior },
    { label: "Paid", value: -paid },
  ];
  return lines
    .filter((t) => t.label === "Subtotal" || Math.abs(t.value) >= 0.005)
    .map((t) => ({ ...t, value: cents(t.value) }))
    .concat([{ label: "Amount due", value: cents(due), grand: true }]);
}

/**
 * THE EMAIL'S `{orders}` (2026-09-27: "make the pay page and email match the
 * new columns") — the paper in plain text, which has no columns: each order
 * with its figures on the line beneath ("Subtotal $573.50 · Delivery $50.00"),
 * or its items when the paper is itemized; then the other charges; then the
 * Totals window's lines.
 */
export function paperText(
  paper: { columns: boolean; rows: PaperRow[] },
  b: Omit<InvoiceTotalsBreakdown, "payments">,
  paid: number,
  due: number
): string {
  const dollars = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
  const shown = paperColumns(paper.rows);
  const row = (r: PaperRow): string[] => {
    if (!paper.columns) {
      if (r.detail) return [r.description, ...r.detail.rows.map((d) => `   ${d.label} — ${dollars(d.amount)}`)];
      return [`${r.description} — ${dollars(r.amount)}`];
    }
    const figures = shown
      .map((c) => ({ c, v: r.parts?.[c.key] ?? 0 }))
      .filter(({ v }) => Math.abs(v) >= 0.005)
      .map(({ c, v }) => `${c.label} ${dollars(v)}`);
    return [r.description, `   ${figures.join(" · ") || dollars(0)}`];
  };
  const orders = paper.rows.filter((r) => !r.free);
  const charges = paper.rows.filter((r) => r.free);
  const out: string[] = [...orders.flatMap(row)];
  if (charges.length) out.push(...(orders.length ? ["", "Other charges"] : []), ...charges.flatMap(row));
  out.push("", ...paperTotals(b, paid, due).map((t) => `${t.label}: ${dollars(t.value)}`));
  return out.join("\n");
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
  /** A wholesale order (`isWholesaleOrder`) — its invoice keeps the terms. */
  wholesale?: boolean;
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

export type InvoiceTerms = {
  /** Days after issue, for an invoice with no dated order on it. */
  termsDays: number;
  /** Business days before the earliest event an invoice is due — see `dueDateFor`. */
  dueBusinessDaysBefore: number;
  prefix: string;
};

export const DEFAULT_INVOICE_TERMS: InvoiceTerms = { termsDays: 4, dueBusinessDaysBefore: 2, prefix: "" };

export function readInvoiceTerms(orgSettings: Record<string, unknown> | null | undefined): InvoiceTerms {
  const ci = ((orgSettings ?? {}).customer_invoices ?? {}) as Record<string, unknown>;
  const days = Number(ci.terms_days);
  // `?? NaN`, not `Number(undefined)` alone — that is NaN anyway, but a null
  // would read as 0 and make every invoice due on its event day.
  const before = Number(ci.due_business_days_before ?? NaN);
  return {
    termsDays: Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_INVOICE_TERMS.termsDays,
    dueBusinessDaysBefore:
      Number.isFinite(before) && before >= 0 ? Math.floor(before) : DEFAULT_INVOICE_TERMS.dueBusinessDaysBefore,
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

/**
 * A NEW INVOICE'S DUE DATE. For SPECIAL ORDERS: two business days before the
 * earliest event, or today when the event is closer than that (Mark,
 * 2026-09-29: SO-10092's event was 10/1 and its invoice said due 10/3, "2 days
 * after the event instead of 2 days before").
 *
 * WHOLESALE KEEPS ITS TERMS — `today + termsDays`, Sunday's invoice due
 * Thursday (Mark, same day: "this is for special orders only and shouldn't
 * affect wholesale orders"). A weekly invoice is sent ahead of deliveries that
 * start the next morning, so the event rule would make it due the day it is
 * sent. An invoice carrying ANY wholesale order keeps the terms, and so does
 * one with no dated order (New Invoice starts with none).
 *
 * The EARLIEST event governs an invoice of several special orders, because
 * that is the first one the kitchen would have to make unpaid. Business days
 * skip Saturday and Sunday only — no holiday calendar, for `businessDaysUntil`'s
 * reason. It is the dialog's starting value; the Due field stays editable.
 */
export function dueDateFor(
  orders: { event_date: string | null; wholesale?: boolean }[],
  today: string,
  terms: Pick<InvoiceTerms, "termsDays" | "dueBusinessDaysBefore"> = DEFAULT_INVOICE_TERMS
): string {
  const dated = orders.map((o) => o.event_date).filter((d): d is string => !!d).sort();
  if (dated.length === 0 || orders.some((o) => o.wholesale)) return addDays(today, terms.termsDays);
  const due = businessDaysBefore(dated[0], terms.dueBusinessDaysBefore);
  return due < today ? today : due;
}

/** "1001", or "DF-1001" with a prefix; a revision (143) is "1001-2". What
 *  the paper, the email and QuickBooks' DocNumber print. */
export function invoiceNumberText(number: number, terms: Pick<InvoiceTerms, "prefix">, revision = 1): string {
  return `${terms.prefix}${number}${revision > 1 ? `-${revision}` : ""}`;
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
 * shape rather than the order's `QuoteSnapshot`: one row per order and one per
 * free line (`snapshotLines`), no itemisation — the attached PDF is the paper.
 * `kind` is what tells the page which it is holding.
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
  /** The printed invoice's rows and columns (2026-09-27), so the page reads
   *  as the paper does; absent on a link sent before. */
  paper?: { columns: boolean; rows: PaperRow[] };
  /** The Totals window as sent, less the payments — the page reads those live. */
  breakdown?: Omit<InvoiceTotalsBreakdown, "payments">;
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
