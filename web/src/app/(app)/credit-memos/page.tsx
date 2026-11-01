import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { customerLabel } from "@/lib/specialOrders";
import { invoiceNumberText, readInvoiceTerms } from "@/lib/customerInvoices";
import { sweepRows } from "@/lib/customerInvoiceQueries";
import { creditMemoNumberText, readMemoPrefix, type CreditMemoKind } from "@/lib/creditMemos";
import { CreditMemosList, memoStatus, type CreditMemoRow } from "@/components/creditMemos/CreditMemosList";

/**
 * EVERY CUSTOMER CREDIT MEMO (218), newest first — their own list beside
 * Invoices (Mark, 2026-11-01: "they should live with invoices, unless you
 * think they deserve their own page"). Their own page, because a memo is
 * its own document with its own number series, as QuickBooks keeps it: on the
 * Invoices list it would sit among money the customer owes and muddle every
 * total there.
 *
 * Totals and what is unapplied are summed here from the lines and the
 * applications — a memo is a handful of rows, and a view for it would be one
 * more thing to keep in step with 218. PAGED anyway, PostgREST's silent cap.
 */
export default async function CreditMemosPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const orgId = session.membership.org_id;
  const settings = session.orgSettings as Record<string, unknown>;
  const prefix = readMemoPrefix(settings);
  const terms = readInvoiceTerms(settings);

  type Memo = {
    id: string;
    number: number;
    kind: CreditMemoKind;
    reason_code: string;
    issued_on: string;
    processor: "square" | "quickbooks";
    settlement: "credit" | "refund";
    voided_at: string | null;
    sent_at: string | null;
    external_ref: { qbo?: { id?: string } } | null;
    customers: Parameters<typeof customerLabel>[0];
    customer_invoices: { number: number; revision: number } | null;
    special_orders: { number: string } | null;
  };
  let memos: Memo[];
  let lines: { memo_id: string; amount: number }[];
  let applied: { credit_memo_id: string; amount: number }[];
  try {
    [memos, lines, applied] = await Promise.all([
      sweepRows<Memo>(
        () =>
          supabase
            .from("customer_credit_memos")
            .select(
              `id, number, kind, reason_code, issued_on, processor, settlement, voided_at, sent_at, external_ref,
               customers ( id, first_name, last_name, company ),
               customer_invoices:credits_invoice_id ( number, revision ),
               special_orders ( number )`
            )
            .eq("org_id", orgId),
        ["id"]
      ),
      sweepRows<{ memo_id: string; amount: number }>(
        () => supabase.from("customer_credit_memo_lines").select("id, memo_id, amount").eq("org_id", orgId),
        ["id"]
      ),
      sweepRows<{ credit_memo_id: string; amount: number }>(
        () =>
          supabase
            .from("payment_applications")
            .select("id, credit_memo_id, amount")
            .eq("org_id", orgId)
            .not("credit_memo_id", "is", null),
        ["id"]
      ),
    ]);
  } catch (e) {
    return <p className="text-sm text-accent">Could not load credit memos: {e instanceof Error ? e.message : String(e)}</p>;
  }

  const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((a, r) => a + Number(r.amount) * 100, 0)) / 100;
  const linesOf = new Map<string, { amount: number }[]>();
  for (const l of lines) linesOf.set(l.memo_id, [...(linesOf.get(l.memo_id) ?? []), l]);
  const appsOf = new Map<string, { amount: number }[]>();
  for (const a of applied) appsOf.set(a.credit_memo_id, [...(appsOf.get(a.credit_memo_id) ?? []), a]);

  const rows: CreditMemoRow[] = memos
    .sort((a, b) => b.number - a.number)
    .map((m) => {
      const total = sum(linesOf.get(m.id) ?? []);
      const used = sum(appsOf.get(m.id) ?? []);
      return {
        id: m.id,
        number: m.number,
        numberText: creditMemoNumberText(m.number, prefix),
        customer: customerLabel(m.customers) || "—",
        kind: m.kind,
        reason: m.reason_code,
        issued_on: m.issued_on,
        invoice: m.customer_invoices ? invoiceNumberText(m.customer_invoices.number, terms, m.customer_invoices.revision) : null,
        order: m.special_orders?.number ?? null,
        processor: m.processor,
        inQuickBooks: Boolean(m.external_ref?.qbo?.id),
        status: memoStatus({ voided: Boolean(m.voided_at), settlement: m.settlement, total, used }),
        total,
        unapplied: Math.round((total - used) * 100) / 100,
      };
    });

  return <CreditMemosList rows={rows} initialFilters={params} initialSearch={parseFilterSearch(params)} />;
}
