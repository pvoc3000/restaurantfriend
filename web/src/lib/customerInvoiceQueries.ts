/**
 * CUSTOMER INVOICES (124) — the reads. Client-safe: every query goes through
 * the caller's own supabase client, so RLS applies. The server page uses it to
 * draw the record; the Send dialog uses it again to render the PDF and the
 * pay link's snapshot from the same figures.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  invoiceBalance,
  type CustomerInvoice,
  type CustomerInvoiceLine,
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

export type InvoiceViewLine = CustomerInvoiceLine & {
  order: {
    id: string;
    number: string;
    title: string | null;
    event_date: string | null;
    status: SpecialOrderStatus | null;
    tax_rate: number | null;
  } | null;
  /** The order's money TODAY, every payment included. */
  totals: OrderTotals | null;
  /** What THIS invoice has collected on the order. */
  collected: number;
  /** The order's item lines, in its own order — the one-order PDF lists them. */
  items: { name: string; qty: number; unit_price: number }[];
};

export type InvoiceViewPayment = {
  id: string;
  order_id: string;
  order_number: string | null;
  paid_on: string | null;
  amount: number;
  payment_type: string | null;
  note: string | null;
  external_ref: string | null;
};

export type InvoiceView = {
  invoice: CustomerInvoice & { org_id: string };
  customer: InvoiceCustomer | null;
  customerName: string;
  lines: InvoiceViewLine[];
  payments: InvoiceViewPayment[];
  total: number;
  paid: number;
  balance: number;
};

export async function fetchInvoiceView(
  supabase: SupabaseClient,
  id: string,
  rush: RushTerms
): Promise<InvoiceView | null> {
  const { data: inv, error } = await supabase
    .from("customer_invoices")
    .select(
      `id, org_id, number, customer_id, issued_on, due_on, notes, sent_at, paid_at, voided_at, document_path, last_sent_at, processor, external_ref,
       customers ( id, first_name, last_name, company, phone, email )`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) return null;

  const { data: lineRows, error: lineError } = await supabase
    .from("customer_invoice_lines")
    .select("id, special_order_id, description, amount, sort, square_item, sent_amount")
    .eq("invoice_id", id)
    .order("sort", { ascending: true, nullsFirst: false });
  if (lineError) throw new Error(lineError.message);

  const lines = (lineRows ?? []) as unknown as CustomerInvoiceLine[];
  const orderIds = [...new Set(lines.map((l) => l.special_order_id))];

  type OrderRow = InvoiceViewLine["order"] & {
    discount_amount: number | null;
    discount_rate: number | null;
    delivery_charge: number | null;
    rush_fee: number | null;
    rush_rate: number | null;
    ignore_balance: boolean | null;
  };
  let orders: OrderRow[] = [];
  const items = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean; name: string }[]>();
  const pays = new Map<string, { amount: number | null }[]>();
  let tagged: InvoiceViewPayment[] = [];

  if (orderIds.length) {
    const [{ data: o }, { data: it }, { data: p }] = await Promise.all([
      supabase
        .from("special_orders")
        .select(
          `id, number, title, event_date, status, tax_rate, discount_amount, discount_rate,
           delivery_charge, rush_fee, rush_rate, ignore_balance`
        )
        .in("id", orderIds),
      supabase
        .from("special_order_items")
        .select("order_id, name, qty, unit_price, taxable, sort, id")
        .in("order_id", orderIds)
        .order("sort", { ascending: true, nullsFirst: false })
        .order("id"),
      supabase
        .from("special_order_payments")
        .select("id, order_id, customer_invoice_id, paid_on, amount, payment_type, note, external_ref")
        .in("order_id", orderIds)
        .order("paid_on", { ascending: true }),
    ]);
    orders = (o ?? []) as unknown as OrderRow[];
    for (const l of it ?? []) {
      const list = items.get(l.order_id as string) ?? [];
      list.push({
        qty: l.qty as number,
        unit_price: l.unit_price as number,
        taxable: l.taxable as boolean,
        name: (l.name as string) ?? "",
      });
      items.set(l.order_id as string, list);
    }
    for (const row of p ?? []) {
      const list = pays.get(row.order_id as string) ?? [];
      list.push({ amount: row.amount as number });
      pays.set(row.order_id as string, list);
    }
    const numberOf = new Map(orders.map((x) => [x!.id, x!.number]));
    tagged = (p ?? [])
      .filter((row) => row.customer_invoice_id === id)
      .map((row) => ({
        id: row.id as string,
        order_id: row.order_id as string,
        order_number: numberOf.get(row.order_id as string) ?? null,
        paid_on: row.paid_on as string | null,
        amount: Number(row.amount),
        payment_type: row.payment_type as string | null,
        note: row.note as string | null,
        external_ref: row.external_ref as string | null,
      }));
  }

  const orderById = new Map(orders.map((o) => [o!.id, o!]));
  const viewLines: InvoiceViewLine[] = lines.map((l) => {
    const o = orderById.get(l.special_order_id) ?? null;
    return {
      ...l,
      amount: Number(l.amount),
      sent_amount: l.sent_amount === null || l.sent_amount === undefined ? null : Number(l.sent_amount),
      order: o
        ? {
            id: o.id,
            number: o.number,
            title: o.title,
            event_date: o.event_date,
            status: o.status,
            tax_rate: o.tax_rate,
          }
        : null,
      totals: o
        ? orderTotals(o, items.get(o.id) ?? [], pays.get(o.id) ?? [], rush)
        : null,
      collected: tagged
        .filter((p) => p.order_id === l.special_order_id)
        .reduce((a, p) => a + p.amount, 0),
      items: (o ? items.get(o.id) ?? [] : []).map((i) => ({
        name: i.name,
        qty: Number(i.qty ?? 0),
        unit_price: Number(i.unit_price ?? 0),
      })),
    };
  });

  const money = invoiceBalance(viewLines, tagged);
  const customer = ((inv as unknown as { customers: InvoiceCustomer | null }).customers ?? null);

  return {
    invoice: inv as unknown as CustomerInvoice & { org_id: string },
    customer,
    customerName: customerLabel(customer) || "Customer",
    lines: viewLines,
    payments: tagged,
    ...money,
  };
}
