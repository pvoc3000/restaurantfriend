import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/filterMenus";
import { STATUS_LABEL, money, readSettings } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import { fetchInvoiceView } from "@/lib/customerInvoiceQueries";
import {
  INVOICE_STATUS_LABEL,
  invoiceNumberText,
  invoiceStatus,
  invoiceChanged,
  lineChanged,
  readInvoiceTerms,
} from "@/lib/customerInvoices";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { CustomerInvoiceCommandMenu } from "@/components/customerInvoices/CustomerInvoiceCommandMenu";
import { CustomerInvoiceLinesTable } from "@/components/customerInvoices/CustomerInvoiceLinesTable";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { canEditPage } from "@/lib/pageAccess";

const INVOICES_CRUMB = { href: "/customer-invoices", label: "Invoices" };

/**
 * One customer invoice (migration 124): what it bills, what has been paid on
 * it, and the commands — one Actions menu in the title row.
 *
 * THE LINES FOLLOW THEIR ORDERS (128): the database re-derives each one on
 * every change to its order. What the customer was SENT is kept per line, so
 * a sent invoice that has moved says so — in the header, a banner, and "sent
 * as $x" under the line — until it is sent again, keeping its number.
 */
export async function CustomerInvoiceDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const canWrite = canEditPage(session.membership.role, "/customer-invoices");
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const terms = readInvoiceTerms(session.orgSettings as Record<string, unknown>);

  let view: Awaited<ReturnType<typeof fetchInvoiceView>>;
  try {
    view = await fetchInvoiceView(supabase, id, readSettings(session.orgSettings).rush);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return (
      <p className="text-sm text-accent">
        Could not load this invoice: {message}
        {message.includes("customer_invoices") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 124 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }
  if (!view) {
    return <p className="text-sm text-muted">That invoice does not exist, or is not yours to see.</p>;
  }

  const { invoice, lines, payments } = view;
  const status = invoiceStatus(invoice, today, invoiceChanged(lines));
  const numberText = invoiceNumberText(invoice.number, terms);
  const draft = !invoice.sent_at && !invoice.voided_at;
  const trail = parseTrail(rawParams, INVOICES_CRUMB);
  const here = `/customer-invoices/${id}`;
  const changed = invoiceChanged(lines);
  const changedCount = lines.filter(lineChanged).length;

  // Every send, with its PDF (128) — what the customer had, and when.
  const { data: sendRows } = await supabase
    .from("customer_invoice_sends")
    .select("id, sent_on, sent_to, total, document_path, created_at")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false });
  const sends = (sendRows ?? []) as {
    id: string; sent_on: string; sent_to: string | null; total: number | null;
    document_path: string | null; created_at: string;
  }[];
  const paths = sends.map((x) => x.document_path).filter((x): x is string => !!x);
  const { data: signed } = paths.length
    ? await supabase.storage.from("special-order-attachments").createSignedUrls(paths, 60 * 60)
    : { data: [] as { signedUrl: string | null }[] };
  const urlOf = new Map(paths.map((path, i) => [path, signed?.[i]?.signedUrl ?? null]));

  return (
    <div className="space-y-12">
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={`Invoice ${numberText}`} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      {/* THE TITLE ROW CARRIES THE ONE ACTIONS MENU, level with the title at
          the right margin — every record screen's shape. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Invoice {numberText}
          </h1>
          <p className="text-sm text-muted">
            <span className={status === "overdue" ? "text-accent" : undefined}>
              {INVOICE_STATUS_LABEL[status]}
            </span>
            {" · "}
            {lines.length} order{lines.length === 1 ? "" : "s"} · {money(view.total)}
            {status !== "void" && view.balance > 0.005 ? (
              <span className="text-accent"> · {money(view.balance)} due</span>
            ) : null}
          </p>
        </div>
        <CustomerInvoiceCommandMenu
          id={id}
          orgId={invoice.org_id}
          numberText={numberText}
          status={status}
          balance={view.balance}
          paid={view.paid}
          today={today}
          canWrite={canWrite}
        />
      </div>

      <section className="space-y-3">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[56rem] gap-x-6 gap-y-4 sm:grid-cols-2">
          <Row label="Customer">
            {invoice.customer_id ? (
              <Link
                href={withFrom(`/customers/${invoice.customer_id}`, { href: here, label: `Invoice ${numberText}` })}
                className={`${READ_ONLY_VALUE} hover:underline`}
              >
                {view.customerName}
              </Link>
            ) : (
              <span className={READ_ONLY_VALUE}>—</span>
            )}
          </Row>
          <Row label="Email">
            <span className={READ_ONLY_VALUE}>{view.customer?.email ?? "—"}</span>
          </Row>
          <Row label="Issued">
            {canWrite && draft ? (
              <InlineValue boxed={BOXED_FIELDS} table="customer_invoices" id={id} column="issued_on"
                           kind="date" nullable={false} value={invoice.issued_on} ariaLabel="Issued" />
            ) : (
              <span className={READ_ONLY_VALUE}>{usDate(invoice.issued_on)}</span>
            )}
          </Row>
          <Row label="Due">
            {canWrite && draft ? (
              <InlineValue boxed={BOXED_FIELDS} table="customer_invoices" id={id} column="due_on"
                           kind="date" value={invoice.due_on} ariaLabel="Due" />
            ) : (
              <span className={READ_ONLY_VALUE}>{invoice.due_on ? usDate(invoice.due_on) : "—"}</span>
            )}
          </Row>
          <Row label="Sent">
            <span className={READ_ONLY_VALUE}>
              {invoice.sent_at ? usDate(invoice.sent_at) : "—"}
              {invoice.last_sent_at && invoice.last_sent_at !== invoice.sent_at
                ? ` · again ${usDate(invoice.last_sent_at)}`
                : ""}
            </span>
          </Row>
          <Row label={invoice.voided_at ? "Voided" : "Paid"}>
            <span className={READ_ONLY_VALUE}>
              {invoice.voided_at ? usDate(invoice.voided_at) : invoice.paid_at ? usDate(invoice.paid_at) : "—"}
            </span>
          </Row>
        </dl>
      </section>

      <section className="space-y-2">
        <SectionHeading count={lines.length}>Orders</SectionHeading>
        {changed && status !== "void" ? (
          <p className="text-[13px]">
            <span className="box-decoration-clone bg-mark-fill px-1">
              {changedCount === 1 ? "One order has" : `${changedCount} orders have`} changed since this
              invoice was sent, and its lines have followed. Send it again so the customer has the new
              figures — the link they hold no longer works.
            </span>
          </p>
        ) : null}
        <CustomerInvoiceLinesTable
          itemEditable={canWrite && !invoice.paid_at && !invoice.voided_at}
          rows={lines.map((l, i) => {
            return {
              id: l.id,
              position: i,
              description: l.description,
              href: withFrom(`/special-orders/${l.special_order_id}`, { href: here, label: `Invoice ${numberText}` }),
              orderStatus: l.order?.status ? STATUS_LABEL[l.order.status] : "—",
              square_item: l.square_item,
              items: l.totals?.subtotal ?? 0,
              discount: l.totals?.discount ?? 0,
              delivery: l.totals?.deliveryCharge ?? 0,
              rush: l.totals?.rushFee ?? 0,
              tax: l.totals?.tax ?? 0,
              paid: l.totals?.paid ?? 0,
              balance: l.totals ? l.totals.balance : l.amount,
              sentAmount: lineChanged(l) ? (l.sent_amount ?? null) : null,
            };
          })}
        />
      </section>

      {sends.length > 0 ? (
        <section className="space-y-2">
          {/* EVERY SEND, NEWEST FIRST (128): re-sending keeps the number, so
              this is where "what did they have, and when" is answered. */}
          <SectionHeading count={sends.length}>Sent</SectionHeading>
          <table className="w-full max-w-[60rem] border-collapse text-[14px]">
            <thead>
              <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
                <th className="w-28 px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">To</th>
                <th className="w-32 px-3 py-2 text-right">Total</th>
                <th className="w-24 px-3 py-2 text-left">PDF</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((x) => {
                const url = x.document_path ? urlOf.get(x.document_path) : null;
                return (
                  <tr key={x.id}>
                    <td className="px-3 py-2 tabular-nums text-muted">{usDate(x.sent_on)}</td>
                    <td className="px-3 py-2 text-muted">{x.sent_to ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.total === null ? "—" : money(Number(x.total))}</td>
                    <td className="px-3 py-2">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          Open
                        </a>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeading count={payments.length}>Payments</SectionHeading>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">Nothing paid yet.</p>
        ) : (
          <table className="w-full max-w-[60rem] border-collapse text-[14px]">
            <thead>
              <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
                <th className="w-28 px-3 py-2 text-left">Date</th>
                <th className="w-28 px-3 py-2 text-left">Order</th>
                <th className="w-36 px-3 py-2 text-left">How</th>
                <th className="px-3 py-2 text-left">Note</th>
                <th className="w-32 px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 tabular-nums text-muted">{usDate(p.paid_on)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">{p.order_number ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{p.payment_type ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{p.note ?? ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading>Notes</SectionHeading>
        {canWrite && draft ? (
          <InlineValue table="customer_invoices" id={id} column="notes" multiline boxed={BOXED_FIELDS}
                       value={invoice.notes} ariaLabel="Notes printed on the invoice" />
        ) : (
          <p
            className={`${READ_ONLY_VALUE} whitespace-pre-wrap ${
              BOXED_FIELDS ? "block min-h-16 w-full border border-hairline" : ""
            }`}
          >
            {invoice.notes ?? "—"}
          </p>
        )}
      </section>

    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
