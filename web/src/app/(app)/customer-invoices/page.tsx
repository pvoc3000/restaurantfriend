import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { canEditPage } from "@/lib/pageAccess";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { customerLabel } from "@/lib/specialOrders";
import { invoiceStatus, readInvoiceTerms, invoiceNumberText } from "@/lib/customerInvoices";
import { sweepRows } from "@/lib/customerInvoiceQueries";
import {
  CustomerInvoicesList,
  type CustomerInvoiceRow,
} from "@/components/customerInvoices/CustomerInvoicesList";

/**
 * Every customer invoice (migration 124), newest first, with its money from
 * `customer_invoice_totals` (144) — one row an invoice, where this page used
 * to sweep every line and every payment and add them up. PAGED anyway: 1,000
 * rows is PostgREST's silent cap, and a weekly customer is 52 a year.
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

  type Row = {
    id: string;
    number: number;
    revision: number;
    customer_id: string | null;
    location_id: string | null;
    issued_on: string;
    due_on: string | null;
    sent_at: string | null;
    paid_at: string | null;
    voided_at: string | null;
    processor: string | null;
    total: number;
    applied: number;
    balance: number;
    order_count: number;
    customers: Parameters<typeof customerLabel>[0];
  };
  let invoices: Row[];
  try {
    invoices = await sweepRows<Row>(
      () =>
        supabase
          .from("customer_invoice_totals")
          .select(
            `id, number, revision, customer_id, location_id, issued_on, due_on, sent_at, paid_at, voided_at, processor,
             total, applied, balance, order_count,
             customers ( id, first_name, last_name, company )`
          )
          .eq("org_id", orgId),
      ["id"]
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return (
      <p className="text-sm text-accent">
        Could not load invoices: {message}
        {message.includes("customer_invoice_totals") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 144 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }
  const shopCode = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: CustomerInvoiceRow[] = invoices
    .sort((a, b) => b.number - a.number || b.revision - a.revision)
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      numberText: invoiceNumberText(inv.number, terms, inv.revision),
      customer_id: inv.customer_id,
      customer: customerLabel(inv.customers) || "—",
      shop: (inv.location_id && shopCode.get(inv.location_id)) || null,
      issued_on: inv.issued_on,
      due_on: inv.due_on,
      status: invoiceStatus(inv, today),
      processor: inv.processor === "quickbooks" ? "quickbooks" : "square",
      orders: inv.order_count,
      total: Number(inv.total),
      paid: Number(inv.applied),
      balance: Number(inv.balance),
    }));

  return (
    <CustomerInvoicesList
      rows={rows}
      initialFilters={params}
      initialSearch={parseFilterSearch(params)}
      create={
        canEditPage(session.membership.role, "/customer-invoices")
          ? {
              orgId,
              shops: session.activeLocations.map((l) => ({ id: l.id, code: l.code })),
              today,
              termsDays: terms.termsDays,
            }
          : null
      }
    />
  );
}
