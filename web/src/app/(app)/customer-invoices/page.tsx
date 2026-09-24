import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { customerLabel } from "@/lib/specialOrders";
import { invoiceBalance, invoiceChanged, invoiceStatus, readInvoiceTerms, invoiceNumberText } from "@/lib/customerInvoices";
import {
  CustomerInvoicesList,
  type CustomerInvoiceRow,
} from "@/components/customerInvoices/CustomerInvoicesList";

/**
 * Every customer invoice (migration 124), newest first. Small today — one a
 * week for Knotted — but the lines and the payments are PAGED anyway: 1,000
 * rows is PostgREST's silent cap, and a year of weekly invoices is 364 lines.
 */
export default async function CustomerInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const orgId = session.membership.org_id;
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const terms = readInvoiceTerms(session.orgSettings as Record<string, unknown>);

  const { data: invoices, error } = await supabase
    .from("customer_invoices")
    .select(
      `id, number, customer_id, issued_on, due_on, sent_at, paid_at, voided_at,
       customers ( id, first_name, last_name, company )`
    )
    .eq("org_id", orgId)
    .order("number", { ascending: false });

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load invoices: {error.message}
        {error.message.includes("customer_invoices") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 124 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }

  const [lines, payments] = await Promise.all([
    paged<{ invoice_id: string; amount: number; sent_amount: number | null }>(supabase, "customer_invoice_lines", "invoice_id, amount, sent_amount", orgId),
    paged<{ customer_invoice_id: string | null; amount: number }>(
      supabase,
      "special_order_payments",
      "customer_invoice_id, amount",
      orgId,
      true
    ),
  ]);

  const rows: CustomerInvoiceRow[] = (invoices ?? []).map((inv) => {
    const mine = lines.filter((l) => l.invoice_id === inv.id);
    const money = invoiceBalance(
      mine,
      payments.filter((p) => p.customer_invoice_id === inv.id)
    );
    const customer = (inv as unknown as { customers: Parameters<typeof customerLabel>[0] }).customers;
    return {
      id: inv.id as string,
      number: inv.number as number,
      numberText: invoiceNumberText(inv.number as number, terms),
      customer_id: inv.customer_id as string | null,
      customer: customerLabel(customer) || "—",
      issued_on: inv.issued_on as string,
      due_on: inv.due_on as string | null,
      status: invoiceStatus(inv as never, today, invoiceChanged(mine)),
      orders: mine.length,
      ...money,
    };
  });

  return (
    <CustomerInvoicesList
      rows={rows}
      initialFilters={params}
      initialSearch={parseFilterSearch(params)}
    />
  );
}

async function paged<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orgId: string,
  taggedOnly = false
): Promise<T[]> {
  const out: T[] = [];
  // `.order()` before `.range()`, or the pages overlap.
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).eq("org_id", orgId);
    if (taggedOnly) q = q.not("customer_invoice_id", "is", null);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
