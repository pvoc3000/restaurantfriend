import { invoiceNumberText, invoiceStatus, readInvoiceTerms } from "@/lib/customerInvoices";
import { customerLabel, money, type CustomerName } from "@/lib/specialOrders";

import { CARD_ITEMS, StartCard, type CardItem } from "../StartCard";
import { shortDate, type Result, type StartContext, type Supabase } from "./shared";

export async function InvoicesWidget(ctx: StartContext) {
  return (
    <InvoicesCard
      result={await loadInvoices(ctx.supabase, ctx.shop.id)}
      today={ctx.today}
      shopCode={ctx.shop.code}
      terms={readInvoiceTerms(ctx.session.orgSettings as Record<string, unknown>)}
    />
  );
}

type InvoiceRow = {
  id: string;
  number: number;
  revision: number;
  issued_on: string;
  due_on: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  balance: number;
  customer: CustomerName | null;
};

/** This shop's invoices not yet paid or void — drafts, and sent ones still
 *  owing — with their balances from `customer_invoice_totals`. */
async function loadInvoices(supabase: Supabase, loc: string): Promise<Result<InvoiceRow[]>> {
  const rows: InvoiceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("customer_invoice_totals")
      .select(
        `id, number, revision, issued_on, due_on, sent_at, paid_at, voided_at, balance,
         customers ( first_name, last_name, company )`
      )
      .eq("location_id", loc)
      .is("voided_at", null)
      .is("paid_at", null)
      .order("id")
      .range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const r of data ?? []) {
      const raw = r as unknown as Record<string, unknown>;
      const customer = raw.customers as CustomerName | CustomerName[] | null;
      rows.push({
        id: raw.id as string,
        number: raw.number as number,
        revision: (raw.revision as number) ?? 1,
        issued_on: raw.issued_on as string,
        due_on: (raw.due_on as string | null) ?? null,
        sent_at: (raw.sent_at as string | null) ?? null,
        paid_at: null,
        voided_at: null,
        balance: Number(raw.balance),
        customer: (Array.isArray(customer) ? customer[0] : customer) ?? null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return { data: rows, error: null };
}

/**
 * THE INVOICES CARD — what this shop has billed and not been paid, and what it
 * has drafted and not sent. Each count is a status the invoice list filters
 * by (`invoiceStatus`), with this shop set, so the two agree.
 */
function InvoicesCard({
  result,
  today,
  shopCode,
  terms,
}: {
  result: Result<InvoiceRow[]>;
  today: string;
  shopCode: string;
  terms: ReturnType<typeof readInvoiceTerms>;
}) {
  if (result.data === null) {
    return <StartCard lines={[]} error={result.error} />;
  }
  const withStatus = result.data.map((r) => ({ r, status: invoiceStatus(r, today) }));
  const overdue = withStatus
    .filter((x) => x.status === "overdue" && x.r.balance > 0.005)
    .sort((a, b) => (a.r.due_on ?? "").localeCompare(b.r.due_on ?? ""));
  const sent = withStatus
    .filter((x) => x.status === "sent" && x.r.balance > 0.005)
    .sort((a, b) => (a.r.due_on ?? "9999").localeCompare(b.r.due_on ?? "9999"));
  const drafts = withStatus.filter((x) => x.status === "draft");

  const list = (status: string) => `/customer-invoices?status=${status}&shop=${encodeURIComponent(shopCode)}`;
  const items: CardItem[] = [...overdue, ...sent].slice(0, CARD_ITEMS).map(({ r, status }) => ({
    primary: `${invoiceNumberText(r.number, terms, r.revision)} ${r.customer ? customerLabel(r.customer) : ""}`.trim(),
    secondary: `${money(r.balance)} · ${status === "overdue" ? "overdue since" : "due"} ${shortDate(r.due_on)}`,
    href: `/customer-invoices/${r.id}`,
  }));

  return (
    <StartCard
      lines={[
        { count: overdue.length, label: "overdue", href: list("overdue") },
        { count: sent.length, label: "sent, awaiting payment", href: list("sent") },
        { count: drafts.length, label: "drafts not sent", href: list("draft") },
      ]}
      items={items}
    />
  );
}
