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

import {
  groupInvoiceLines,
  invoiceBalance,
  type CustomerInvoice,
  type CustomerInvoiceLine,
  type InvoiceGroup,
} from "./customerInvoices";
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
        .select("id, special_order_id, amount, customer_payments ( paid_on, payment_type, note, external_ref )")
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
          `id, number, title, event_date, status, tax_rate, square_item, discount_amount, discount_rate,
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
        totals: orderTotals(row as never, itemsOf.get(row.id) ?? [], paysOf.get(row.id) ?? [], rush),
      });
    }
  }

  const numberOf = (orderId: string | null) => (orderId ? orders.get(orderId)?.number ?? null : null);
  const payments: InvoiceViewPayment[] = ((appRows ?? []) as unknown as {
    id: string;
    special_order_id: string | null;
    amount: number;
    customer_payments: { paid_on: string | null; payment_type: string | null; note: string | null; external_ref: string | null } | null;
  }[])
    .map((a) => ({
      id: a.id,
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
