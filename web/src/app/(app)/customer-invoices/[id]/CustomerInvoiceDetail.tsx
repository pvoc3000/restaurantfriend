import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/filterMenus";
import { STATUS_LABEL, money, readSettings } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import { fetchInvoiceView } from "@/lib/customerInvoiceQueries";
import {
  PROCESSOR_LABEL,
  invoiceNumberText,
  invoiceStatus,
  readInvoiceTerms,
} from "@/lib/customerInvoices";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { CustomerInvoiceCommandMenu } from "@/components/customerInvoices/CustomerInvoiceCommandMenu";
import { InvoiceOrders, type InvoiceOrderRow } from "@/components/customerInvoices/InvoiceOrders";
import { InvoiceLines, type InvoiceLineRow } from "@/components/customerInvoices/InvoiceLines";
import { InvoiceStatusChip } from "@/components/customerInvoices/InvoiceStatusChip";
import { ProcessorField } from "@/components/customerInvoices/ProcessorField";
import { QuickBooksPaymentCheck } from "@/components/customerInvoices/QuickBooksPaymentCheck";
import { InvoicePaymentRefund } from "@/components/customerInvoices/InvoicePaymentRefund";
import { canRefundPayments } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { canEditPage } from "@/lib/pageAccess";

const INVOICES_CRUMB = { href: "/customer-invoices", label: "Invoices" };

/**
 * One customer invoice (migration 124): what it bills, what has been paid on
 * it, and the commands — one Actions menu in the title row.
 *
 * THE INVOICE OWNS ITS LINES (141): its orders' charges, copied when they were
 * added, and lines of its own. While it is a draft, orders are added, updated
 * from their order or removed, and free lines edited; once it has gone out or
 * holds money it is settled, and every send's PDF is kept below.
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
  // Refund… — manager and up, the order's Billing tab's rule (`canRefundPayments`).
  const canRefund = canRefundPayments(session.membership.role);
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

  const { invoice, payments, groups } = view;
  const status = invoiceStatus(invoice, today);
  const numberText = invoiceNumberText(invoice.number, terms, invoice.revision);
  // Editable: nothing sent, nothing void, no money on it (141).
  const draft = !view.frozen;
  const trail = parseTrail(rawParams, INVOICES_CRUMB);
  const TABS = [
    { key: "detail", label: "Detail" },
    { key: "charges", label: "Charges" },
    { key: "payments", label: "Payments" },
  ] as const;
  type Tab = (typeof TABS)[number]["key"];
  const tabHref = (t: Tab) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(rawParams)) {
      const one = Array.isArray(v) ? v[0] : v;
      if (k !== "tab" && k !== "send" && one) q.set(k, one);
    }
    if (t !== "detail") q.set("tab", t);
    const qs = q.toString();
    return `/customer-invoices/${id}${qs ? `?${qs}` : ""}`;
  };
  const activeTab: Tab = TABS.some((t) => t.key === rawParams.tab) ? (rawParams.tab as Tab) : "detail";
  const here = `/customer-invoices/${id}`;
  const orderGroups = groups.filter((g) => g.orderId);
  const shop = session.locations.find((l) => l.id === invoice.location_id)?.code ?? null;
  const backHere = { href: here, label: `Invoice ${numberText}` };

  const orderRows: InvoiceOrderRow[] = orderGroups.map((g) => {
    const order = view.orders.get(g.orderId!);
    const state = view.groupState.get(g.orderId!);
    return {
      orderId: g.orderId!,
      label: g.label,
      href: withFrom(`/special-orders/${g.orderId}`, backHere),
      status: order?.status ? STATUS_LABEL[order.status] : "—",
      kind: g.kind,
      note: g.kind === "deposit" ? g.lines[0]?.description ?? "Deposit" : null,
      soldAs: order?.square_item ?? g.lines[0]?.square_item ?? "special_order",
      billed: g.net,
      expected: state?.expected ?? g.net,
      stale: draft && Boolean(state?.stale),
      // What it copied here (141): its items, then its discount, delivery,
      // rush, tax and any "Less invoice" — shown when the row is opened.
      lines: g.lines.map((l) => ({
        description: l.description,
        qty: l.qty,
        unitPrice: l.unit_price,
        amount: l.amount,
      })),
    };
  });
  // OTHER CHARGES (Mark, 2026-09-27): only the invoice's own lines. An
  // order's copied lines are under its row in Orders, not repeated here.
  const chargeRows: InvoiceLineRow[] = groups
    .filter((g) => !g.orderId)
    .flatMap((g) => g.lines)
    .map((l, position) => ({
      id: l.id,
      position,
      description: l.description,
      lineType: l.line_type === "delivery" ? "delivery" : "item",
      qty: l.qty,
      unitPrice: l.unit_price,
      amount: l.amount,
    }));
  const processor = invoice.processor ?? "square";
  const qbo = (invoice.external_ref as { qbo?: { id?: string; doc_number?: string | null; invoice_link?: string | null } } | null)?.qbo;

  // REVISIONS (143): what this replaces, and what replaces it — a draft being
  // made, or a sent one that already did. And the customer's CREDIT, which
  // Apply Credit offers while a Square invoice still owes.
  const [{ data: originalRow }, { data: revisionRows }, { data: creditRows }] = await Promise.all([
    invoice.revision_of
      ? supabase.from("customer_invoices").select("id, number, revision, voided_at").eq("id", invoice.revision_of).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("customer_invoices").select("id, number, revision, sent_at, voided_at").eq("revision_of", id),
    invoice.customer_id
      ? supabase.rpc("customer_credit", { p_customer: invoice.customer_id })
      : Promise.resolve({ data: [] }),
  ]);
  type Related = { id: string; number: number; revision: number; sent_at?: string | null; voided_at: string | null };
  const original = (originalRow as Related | null) ?? null;
  const revisions = ((revisionRows ?? []) as Related[]).filter((r) => !r.voided_at);
  const pendingRevision = revisions.find((r) => !r.sent_at) ?? null;
  const replacedBy = revisions.find((r) => r.sent_at) ?? null;
  const isPendingRevision = Boolean(invoice.revision_of && !invoice.sent_at && !invoice.voided_at);
  const credit = Math.round(((creditRows ?? []) as { credit: number }[]).reduce((a, c) => a + Number(c.credit), 0) * 100) / 100;
  const labelOf = (r: Related) => `Invoice ${invoiceNumberText(r.number, terms, r.revision)}`;
  const relatedHref = (r: Related) => withFrom(`/customer-invoices/${r.id}`, backHere);

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

  const tabItems = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    href: tabHref(t.key),
    count: t.key === "charges" ? orderRows.length + chargeRows.length : t.key === "payments" ? payments.length : undefined,
  }));

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
          {/* The status chip beside the title — the PO record's shape. */}
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              Invoice {numberText}
            </h1>
            <InvoiceStatusChip status={status} />
          </div>
          <p className="text-sm text-muted">
            {orderGroups.length} order{orderGroups.length === 1 ? "" : "s"} · {money(view.total)}
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
          inQuickBooks={Boolean(qbo?.id)}
          processor={processor}
          revisable={
            Boolean(invoice.sent_at) && !invoice.voided_at && !isPendingRevision && !pendingRevision
          }
          credit={processor === "square" ? credit : 0}
          autoSend={typeof rawParams.send === "string" ? rawParams.send : null}
        />
      </div>

      {/* WHAT REPLACES WHAT (143) — said once, where it matters. */}
      {isPendingRevision && original ? (
        <p className="text-[13px]">
          <span className="box-decoration-clone bg-mark-fill px-1">
            A draft revision of{" "}
            <Link href={relatedHref(original)} className="underline underline-offset-2">{labelOf(original)}</Link>.
            Sending it voids {labelOf(original)} and moves what was paid on it here.
          </span>
        </p>
      ) : pendingRevision ? (
        <p className="text-[13px]">
          <span className="box-decoration-clone bg-mark-fill px-1">
            Being revised as{" "}
            <Link href={relatedHref(pendingRevision)} className="underline underline-offset-2">{labelOf(pendingRevision)}</Link>{" "}
            (a draft). This invoice is still the one the customer pays until that is sent.
          </span>
        </p>
      ) : replacedBy ? (
        <p className="text-[13px] text-muted">
          Replaced by{" "}
          <Link href={relatedHref(replacedBy)} className="underline underline-offset-2">{labelOf(replacedBy)}</Link>.
        </p>
      ) : invoice.revision_of && original ? (
        <p className="text-[13px] text-muted">
          Replaces <Link href={relatedHref(original)} className="underline underline-offset-2">{labelOf(original)}</Link>.
        </p>
      ) : null}

      {/* THREE TABS (Mark, 2026-09-27: "Detail", "Charges", "Payments") —
          the order record's section nav, the tab in the URL. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this invoice" value={activeTab} items={tabItems} />
        </div>
        <div className="lg:hidden">
          <SectionNav orientation="horizontal" ariaLabel="Which part of this invoice" value={activeTab} items={tabItems} />
        </div>

        <div className="min-w-0 flex-1 space-y-12">
          {activeTab === "detail" && (
            <>
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
                  <Row label="Shop">
                    {/* The shop whose Square location collects (141) — the orders
                        added must be made there. */}
                    <span className={READ_ONLY_VALUE}>{shop ?? "—"}</span>
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
                  <Row label="Collect through">
                    {/* 131: chosen per invoice, locked once sent — the customer then
                        holds that processor's link — and once it is in QuickBooks,
                        which Send to QuickBooks can do before any send. Void it to
                        change its mind. */}
                    {canWrite && draft && !qbo?.id ? (
                      <ProcessorField key={processor} id={id} value={processor} />
                    ) : (
                      <span className={READ_ONLY_VALUE}>{PROCESSOR_LABEL[processor]}</span>
                    )}
                  </Row>
                  <Row label={invoice.voided_at ? "Voided" : "Paid"}>
                    <span className={READ_ONLY_VALUE}>
                      {invoice.voided_at ? usDate(invoice.voided_at) : invoice.paid_at ? usDate(invoice.paid_at) : "—"}
                    </span>
                  </Row>
                  {processor === "quickbooks" ? (
                    <Row label="In QuickBooks">
                      <span className={READ_ONLY_VALUE}>
                        {qbo?.id ? (
                          <>
                            <a href={`https://app.qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(qbo.id)}`}
                               target="_blank" rel="noreferrer" className="underline underline-offset-2">
                              Invoice {qbo.doc_number ?? qbo.id}
                            </a>
                            {qbo.invoice_link ? (
                              <>
                                {" · "}
                                <a href={qbo.invoice_link} target="_blank" rel="noreferrer"
                                   className="underline underline-offset-2">
                                  Pay page
                                </a>
                              </>
                            ) : null}
                          </>
                        ) : (
                          "Not yet — it goes when the invoice is sent"
                        )}
                      </span>
                    </Row>
                  ) : null}
                </dl>
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
            </>
          )}

          {activeTab === "charges" && (
            <>
              <InvoiceOrders
                invoiceId={id}
                customerId={invoice.customer_id as string}
                locationId={invoice.location_id}
                rows={orderRows}
                draft={canWrite && draft}
                soldAsEditable={canWrite && !invoice.paid_at && !invoice.voided_at}
              />

              <InvoiceLines invoiceId={id} orgId={invoice.org_id} rows={chargeRows} draft={canWrite && draft} />
            </>
          )}

          {activeTab === "payments" && (
            <>
              {sends.length > 0 ? (
                <section className="space-y-2">
                  {/* EVERY SEND, NEWEST FIRST (128): re-sending keeps the number, so
                      this is where "what did they have, and when" is answered.
                      At the top of Payments (Mark, 2026-09-28): what was asked
                      for, and when, above what came in. */}
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
                {canWrite && processor === "quickbooks" && qbo?.id && !invoice.paid_at && !invoice.voided_at ? (
                  <QuickBooksPaymentCheck id={id} />
                ) : null}
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
                        {canRefund ? <th className="w-20 px-3 py-2" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2 tabular-nums text-muted">{usDate(p.paid_on)}</td>
                          <td className="px-3 py-2 tabular-nums text-muted">{p.order_number ?? "Other charges"}</td>
                          <td className="px-3 py-2 text-muted">{p.payment_type ?? "—"}</td>
                          <td className="px-3 py-2 text-muted">{p.note ?? ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(p.amount)}</td>
                          {canRefund ? (
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              <InvoicePaymentRefund payment={p} />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>

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
