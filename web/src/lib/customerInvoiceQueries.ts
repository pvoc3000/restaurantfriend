/**
 * CUSTOMER INVOICES (124) — the reads. Client-safe: every query goes through
 * the caller's own supabase client, so RLS applies. The server page uses it to
 * draw the record; the Send dialog uses it again to render the PDF and the
 * pay link's snapshot from the same figures.
 *
 * Since 141 the invoice's LINES are its content — copied from its orders, or
 * free — so the paper, the pay link and QuickBooks read them, not the orders.
 * The orders are read for their links, their status and (for a deposit, or a
 * one-line order sent before 141) the money a breakdown is cut from.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { refundLeft } from "./customerPayments";

import {
  groupInvoiceLines,
  invoiceBalance,
  invoiceNumberText,
  type CustomerInvoice,
  type CustomerInvoiceLine,
  type InvoiceGroup,
  type InvoiceTerms,
} from "./customerInvoices";
import {
  buildStatement,
  type AccountEntry,
  type AccountInvoice,
  type StatementDocument,
} from "./customerStatement";
import {
  customerLabel,
  orderTotals,
  type OrderTotals,
  type RushTerms,
  type SpecialOrderStatus,
} from "./specialOrders";

export type InvoiceCustomer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
};

export type InvoiceOrder = {
  id: string;
  number: string;
  title: string | null;
  event_date: string | null;
  status: SpecialOrderStatus | null;
  tax_rate: number | null;
  square_item: "special_order" | "wholesale";
  /** The shop that makes it — its QuickBooks Class and Location (165). */
  kitchen_location_id: string | null;
  /** The order's money TODAY — what a deposit's breakdown is cut from. */
  totals: OrderTotals;
};

/** One order's standing on the invoice (141's `customer_invoice_groups`). */
export type InvoiceGroupState = {
  special_order_id: string;
  kind: string;
  billed: number;
  /** What a fresh copy of the order would bill here now. */
  expected: number;
  /** The draft's copy no longer matches the order. */
  stale: boolean;
};

export type InvoiceViewPayment = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  paid_on: string | null;
  amount: number;
  payment_type: string | null;
  note: string | null;
  external_ref: string | null;
  /** The payment this row is a share of, and the payment a refund gives
   *  back — so the tab can tell what is left to refund (`refundLeft`). */
  payment_id: string;
  refund_of: string | null;
  refundable: number;
};

export type InvoiceView = {
  invoice: CustomerInvoice & { org_id: string; location_id: string | null };
  customer: InvoiceCustomer | null;
  customerName: string;
  lines: CustomerInvoiceLine[];
  groups: InvoiceGroup[];
  orders: Map<string, InvoiceOrder>;
  groupState: Map<string, InvoiceGroupState>;
  payments: InvoiceViewPayment[];
  /** Sent, void or holding money: its lines are settled (141). */
  frozen: boolean;
  total: number;
  paid: number;
  balance: number;
};

const LINE_COLUMNS =
  "id, special_order_id, line_type, description, qty, unit_price, amount, taxable, tax_rate, order_label, sort, square_item, kind";

export async function fetchInvoiceView(
  supabase: SupabaseClient,
  id: string,
  rush: RushTerms
): Promise<InvoiceView | null> {
  const { data: inv, error } = await supabase
    .from("customer_invoices")
    .select(
      `id, org_id, number, revision, revision_of, customer_id, location_id, issued_on, due_on, notes, sent_at, paid_at, voided_at, document_path, last_sent_at, processor, external_ref,
       customers ( id, first_name, last_name, company, phone, email )`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) return null;

  const [{ data: lineRows, error: lineError }, { data: appRows, error: appError }, { data: groupRows }] =
    await Promise.all([
      supabase.from("customer_invoice_lines").select(LINE_COLUMNS).eq("invoice_id", id),
      // What THIS invoice has collected, free lines' money included — the
      // ledger's applications to it (140), each with its payment's facts.
      supabase
        .from("payment_applications")
        .select("id, payment_id, special_order_id, amount, customer_payments ( paid_on, payment_type, note, external_ref, refund_of )")
        .eq("customer_invoice_id", id),
      supabase.rpc("customer_invoice_groups", { p_invoice: id }),
    ]);
  if (lineError) throw new Error(lineError.message);
  if (appError) throw new Error(appError.message);

  const lines = ((lineRows ?? []) as unknown as CustomerInvoiceLine[]).map((l) => ({
    ...l,
    amount: Number(l.amount),
    qty: l.qty === null ? null : Number(l.qty),
    unit_price: l.unit_price === null ? null : Number(l.unit_price),
  }));
  const orderIds = [...new Set(lines.map((l) => l.special_order_id).filter((o): o is string => !!o))];

  const orders = new Map<string, InvoiceOrder>();
  if (orderIds.length) {
    const [{ data: o }, { data: it }, { data: p }] = await Promise.all([
      supabase
        .from("special_orders")
        .select(
          `id, number, title, event_date, status, tax_rate, square_item, kitchen_location_id, discount_amount, discount_rate,
           delivery_charge, rush_fee, rush_rate, ignore_balance`
        )
        .in("id", orderIds),
      supabase
        .from("special_order_items")
        .select("order_id, qty, unit_price, taxable, sort, id")
        .in("order_id", orderIds)
        .order("sort", { ascending: true, nullsFirst: false })
        .order("id"),
      supabase.from("order_payments").select("order_id, amount").in("order_id", orderIds),
    ]);
    const itemsOf = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean }[]>();
    for (const l of it ?? []) {
      itemsOf.set(l.order_id as string, [
        ...(itemsOf.get(l.order_id as string) ?? []),
        { qty: l.qty as number, unit_price: l.unit_price as number, taxable: l.taxable as boolean },
      ]);
    }
    const paysOf = new Map<string, { amount: number | null }[]>();
    for (const row of p ?? []) {
      paysOf.set(row.order_id as string, [...(paysOf.get(row.order_id as string) ?? []), { amount: row.amount as number }]);
    }
    for (const row of (o ?? []) as unknown as (InvoiceOrder & Record<string, unknown>)[]) {
      orders.set(row.id, {
        id: row.id,
        number: row.number,
        title: row.title,
        event_date: row.event_date,
        status: row.status,
        tax_rate: row.tax_rate,
        square_item: row.square_item,
        kitchen_location_id: row.kitchen_location_id ?? null,
        totals: orderTotals(row as never, itemsOf.get(row.id) ?? [], paysOf.get(row.id) ?? [], rush),
      });
    }
  }

  const numberOf = (orderId: string | null) => (orderId ? orders.get(orderId)?.number ?? null : null);
  const appList = ((appRows ?? []) as unknown as {
    id: string;
    payment_id: string;
    special_order_id: string | null;
    amount: number;
    customer_payments: {
      paid_on: string | null; payment_type: string | null; note: string | null; external_ref: string | null; refund_of: string | null;
    } | null;
  }[]);
  const refundRows = appList.map((a) => ({
    refund_of: a.customer_payments?.refund_of ?? null,
    amount: Number(a.amount),
    order_id: a.special_order_id,
  }));
  const payments: InvoiceViewPayment[] = appList
    .map((a) => ({
      id: a.id,
      payment_id: a.payment_id,
      refund_of: a.customer_payments?.refund_of ?? null,
      refundable: refundLeft({ payment_id: a.payment_id, amount: Number(a.amount), order_id: a.special_order_id }, refundRows),
      order_id: a.special_order_id,
      order_number: numberOf(a.special_order_id),
      paid_on: a.customer_payments?.paid_on ?? null,
      amount: Number(a.amount),
      payment_type: a.customer_payments?.payment_type ?? null,
      note: a.customer_payments?.note ?? null,
      external_ref: a.customer_payments?.external_ref ?? null,
    }))
    .sort((a, b) => (a.paid_on ?? "").localeCompare(b.paid_on ?? ""));

  const groupState = new Map<string, InvoiceGroupState>(
    ((groupRows ?? []) as InvoiceGroupState[]).map((g) => [
      g.special_order_id,
      { ...g, billed: Number(g.billed), expected: Number(g.expected) },
    ])
  );

  const money = invoiceBalance(lines, payments);
  const customer = (inv as unknown as { customers: InvoiceCustomer | null }).customers ?? null;
  const invoice = inv as unknown as InvoiceView["invoice"];

  return {
    invoice,
    customer,
    customerName: customerLabel(customer) || "Customer",
    lines,
    groups: groupInvoiceLines(lines, orders),
    orders,
    groupState,
    payments,
    frozen: Boolean(invoice.sent_at || invoice.voided_at || payments.length > 0),
    ...money,
  };
}

/* ==========================================================================
 * THE STATEMENT (144) — a customer's posted invoices and the money that
 * reached their account, both SWEPT: PostgREST stops at 1,000 rows without a
 * word, and a weekly customer has a row a week for as long as they buy.
 * ========================================================================== */

type Page = {
  order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => Page;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/** Every row, a page at a time, in an order that is unique on `columns` —
 *  or the pages overlap. `build` is a function: a query builder is single-use. */
export async function sweepRows<T>(build: () => unknown, columns: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = build() as Page;
    for (const c of columns) q = q.order(c, { ascending: true, nullsFirst: false });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function fetchStatement(
  supabase: SupabaseClient,
  customerId: string,
  from: string,
  to: string,
  terms: Pick<InvoiceTerms, "prefix">
): Promise<StatementDocument> {
  const [{ data: customer, error }, invoiceRows, entryRows] = await Promise.all([
    supabase
      .from("customers")
      .select("first_name, last_name, company, phone, email")
      .eq("id", customerId)
      .maybeSingle(),
    sweepRows<{
      id: string;
      number: number;
      revision: number;
      issued_on: string;
      due_on: string | null;
      sent_at: string | null;
      voided_at: string | null;
      total: number;
      posted: boolean;
    }>(
      () =>
        supabase
          .from("customer_invoice_totals")
          .select("id, number, revision, issued_on, due_on, sent_at, voided_at, total, posted")
          .eq("customer_id", customerId),
      ["id"]
    ),
    sweepRows<AccountEntry>(
      () =>
        supabase
          .from("customer_account_entries")
          .select("payment_id, paid_on, payment_type, customer_invoice_id, amount, created_at")
          .eq("customer_id", customerId),
      ["payment_id", "customer_invoice_id"]
    ),
  ]);
  if (error) throw new Error(error.message);

  // On the account, and a sent invoice since voided — at no charge, so the
  // number the customer was sent is still accounted for.
  const invoices: AccountInvoice[] = invoiceRows
    .filter((r) => r.posted || (r.voided_at && r.sent_at))
    .map((r) => ({
      id: r.id,
      label: invoiceNumberText(r.number, terms, r.revision),
      issued_on: r.issued_on,
      due_on: r.due_on,
      total: Number(r.total),
      void: !r.posted,
    }));
  const entries = entryRows.map((e) => ({ ...e, amount: Number(e.amount) }));

  return {
    customer: (customer ?? null) as StatementDocument["customer"],
    statement: buildStatement({ invoices, entries, from, to }),
  };
}
