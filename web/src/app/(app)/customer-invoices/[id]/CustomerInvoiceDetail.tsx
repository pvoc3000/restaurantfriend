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
  lineDrift,
  readInvoiceTerms,
} from "@/lib/customerInvoices";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { CustomerInvoiceCommandMenu } from "@/components/customerInvoices/CustomerInvoiceCommandMenu";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { canEditPage } from "@/lib/pageAccess";

const INVOICES_CRUMB = { href: "/customer-invoices", label: "Invoices" };

/**
 * One customer invoice (migration 124): what it bills, what has been paid on
 * it, and the commands — one Actions menu in the title row.
 *
 * THE LINES ARE THE PAPER. Each is frozen at the amount written when the
 * invoice was made (and frozen harder once it is sent — the database refuses
 * an edit). If an order has changed since, the row SAYS so beside the figure
 * rather than quietly re-deriving it: the customer is holding the old number.
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
  const status = invoiceStatus(invoice, today);
  const numberText = invoiceNumberText(invoice.number, terms);
  const draft = !invoice.sent_at && !invoice.voided_at;
  const trail = parseTrail(rawParams, INVOICES_CRUMB);
  const here = `/customer-invoices/${id}`;
  const drifted = lines.filter(
    (l) => l.totals && lineDrift(l.amount, l.totals.balance + l.collected) !== null
  );

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
            <span className={READ_ONLY_VALUE}>{invoice.sent_at ? usDate(invoice.sent_at) : "—"}</span>
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
        {drifted.length > 0 ? (
          <p className="text-[13px]">
            <span className="box-decoration-clone bg-mark-fill px-1">
              {drifted.length === 1 ? "One order has" : `${drifted.length} orders have`} changed since
              this invoice was written.
              {draft
                ? " Update Amounts rewrites the lines from the orders as they are now."
                : " It has been sent, so its lines stay as the customer has them — void it and invoice again to change them."}
            </span>
          </p>
        ) : null}
        <table className="w-full max-w-[60rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-3 py-2 text-left">Line</th>
              <th className="w-28 px-3 py-2 text-left">Order status</th>
              <th className="w-32 px-3 py-2 text-right">Amount</th>
              <th className="w-32 px-3 py-2 text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const drift = l.totals ? lineDrift(l.amount, l.totals.balance + l.collected) : null;
              return (
                <tr key={l.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <Link
                      href={withFrom(`/special-orders/${l.special_order_id}`, { href: here, label: `Invoice ${numberText}` })}
                      className="hover:underline"
                    >
                      {l.description}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {l.order?.status ? STATUS_LABEL[l.order.status] : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(l.amount)}
                    {drift !== null ? (
                      <span className="block text-[12px] text-accent">
                        now {money(l.amount + drift)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {l.collected !== 0 ? money(l.collected) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(view.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{view.paid !== 0 ? money(view.paid) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </section>

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
