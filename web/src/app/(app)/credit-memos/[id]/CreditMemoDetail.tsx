import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/filterMenus";
import { money } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import { canEditPage } from "@/lib/pageAccess";
import {
  CREDIT_MEMO_KIND_LABEL,
  fetchCreditMemoView,
  outstandingStep,
  paperLine,
  qtyLabel,
  settlementLabel,
} from "@/lib/creditMemos";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { CreditMemoCommandMenu } from "@/components/creditMemos/CreditMemoCommandMenu";

const CUSTOMERS_CRUMB = { href: "/customers", label: "Customers" };

const PROCESSOR = { square: "Square", quickbooks: "QuickBooks" } as const;

/**
 * ONE CUSTOMER CREDIT MEMO (migration 218, docs/customer-credit-memos-brief.md):
 * what it credits and why, its lines as the paper prints them, and where its
 * credit went — applied to an invoice, or refunded. A memo is frozen once
 * issued (§9); what can still change is the step its issue left undone, how
 * an unapplied one is settled, and Void.
 *
 * Reached from the order that was shorted, the customer's Billing tab, or the
 * Issue Credit Memo dialog, which comes here with `?problem=` when the
 * QuickBooks push or the refund failed and `?warning=` when it went through
 * with something to say.
 */
export async function CreditMemoDetail({ id, rawParams }: { id: string; rawParams: RawSearchParams }) {
  const session = await getAppSession();
  const supabase = await createClient();
  const canWrite = canEditPage(session.membership.role, "/credit-memos");
  const settings = session.orgSettings as Record<string, unknown>;

  let view: Awaited<ReturnType<typeof fetchCreditMemoView>>;
  try {
    view = await fetchCreditMemoView(supabase, id, settings);
  } catch (e) {
    return <p className="text-sm text-accent">Could not load this credit memo: {e instanceof Error ? e.message : String(e)}</p>;
  }
  if (!view) {
    return <p className="text-sm text-muted">That credit memo does not exist, or is not yours to see.</p>;
  }

  const { memo } = view;
  const trail = parseTrail(rawParams, CUSTOMERS_CRUMB);
  const here = { href: `/credit-memos/${id}`, label: `Credit memo ${view.label}` };
  const step = outstandingStep(view);
  const status = settlementLabel(view);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const problem = one(rawParams.problem);
  const warning = one(rawParams.warning);
  const qbo = memo.external_ref?.qbo;
  const lines = view.lines.map(paperLine);
  const quantities = lines.some((l) => l.kind === "item");

  return (
    <div className="space-y-12">
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={`Credit memo ${view.label}`} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Credit memo {view.label}
          </h1>
          <p className="text-sm text-muted">
            {CREDIT_MEMO_KIND_LABEL[memo.kind]} · {money(view.total)} ·{" "}
            <span className={memo.voided_at ? "text-accent" : ""}>{status}</span>
          </p>
        </div>
        <CreditMemoCommandMenu
          id={id}
          orgId={memo.org_id}
          label={view.label}
          processor={memo.processor}
          settlement={memo.settlement}
          step={step}
          applied={view.applied}
          voided={Boolean(memo.voided_at)}
          inQuickBooks={Boolean(qbo?.id)}
          canWrite={canWrite}
        />
      </div>

      {/* WHAT THE ISSUE LEFT UNDONE, said where the manager lands. The
          dialog's own words when it came here; otherwise the record's. */}
      {problem && step ? (
        <p className="text-[13px] text-accent">
          {problem} {step === "push" ? "Use Send to QuickBooks to try again." : "Use Refund Again to try again."}
        </p>
      ) : warning ? (
        <p className="text-[13px]">
          <span className="box-decoration-clone bg-mark-fill px-1">{warning}</span>
        </p>
      ) : step === "push" ? (
        <p className="text-[13px] text-accent">
          Not in QuickBooks yet, so it cannot come off their next QuickBooks invoice. Use Send to QuickBooks.
        </p>
      ) : step === "refund" ? (
        <p className="text-[13px] text-accent">Not refunded yet. Use Refund Again, or Change to Credit.</p>
      ) : null}

      <section className="space-y-3">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[56rem] gap-x-6 gap-y-4 sm:grid-cols-2">
          <Row label="Customer">
            <Link href={withFrom(`/customers/${memo.customer_id}`, here)} className={`${READ_ONLY_VALUE} hover:underline`}>
              {view.customer.name}
            </Link>
          </Row>
          <Row label="Issued">
            <span className={READ_ONLY_VALUE}>{usDate(memo.issued_on)}</span>
          </Row>
          <Row label="Credits invoice">
            {view.invoice ? (
              <Link href={withFrom(`/customer-invoices/${view.invoice.id}`, here)} className={`${READ_ONLY_VALUE} hover:underline`}>
                {view.invoice.label}
              </Link>
            ) : (
              <span className={READ_ONLY_VALUE}>—</span>
            )}
          </Row>
          <Row label="Order">
            {view.order ? (
              <Link href={withFrom(`/special-orders/${view.order.id}`, here)} className={`${READ_ONLY_VALUE} hover:underline`}>
                {[view.order.number, view.order.title].filter(Boolean).join(" · ")}
              </Link>
            ) : (
              <span className={READ_ONLY_VALUE}>—</span>
            )}
          </Row>
          <Row label="Reason">
            <span className={READ_ONLY_VALUE}>{memo.reason_code}</span>
          </Row>
          <Row label="Settled">
            <span className={READ_ONLY_VALUE}>
              {memo.settlement === "refund" ? "Refunded" : "Applied as credit"} · {status}
            </span>
          </Row>
          <Row label="Collected through">
            <span className={READ_ONLY_VALUE}>{PROCESSOR[memo.processor]}</span>
          </Row>
          {memo.processor === "quickbooks" ? (
            <Row label="In QuickBooks">
              <span className={READ_ONLY_VALUE}>
                {qbo?.id ? (
                  <a
                    href={`https://app.qbo.intuit.com/app/creditmemo?txnId=${encodeURIComponent(qbo.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Credit memo {qbo.doc_number ?? qbo.id}
                  </a>
                ) : memo.settlement === "refund" ? (
                  "As a refund receipt, when it is refunded"
                ) : (
                  "Not yet"
                )}
              </span>
            </Row>
          ) : null}
          <Row label="Sent">
            <span className={READ_ONLY_VALUE}>{memo.sent_at ? usDate(memo.sent_at) : "—"}</span>
          </Row>
          {memo.voided_at ? (
            <Row label="Voided">
              <span className={READ_ONLY_VALUE}>{usDate(memo.voided_at)}</span>
            </Row>
          ) : null}
          <Row label="Note">
            <span className={`${READ_ONLY_VALUE} whitespace-pre-wrap`}>{memo.note ?? "—"}</span>
          </Row>
        </dl>
      </section>

      <section className="space-y-2">
        <SectionHeading count={lines.length}>Lines</SectionHeading>
        <table className="w-full max-w-[60rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-3 py-2 text-left">Item</th>
              {quantities ? (
                <>
                  <th className="w-20 px-3 py-2 text-right">Billed</th>
                  <th className="w-24 px-3 py-2 text-right">Delivered</th>
                  <th className="w-24 px-3 py-2 text-right">Price</th>
                  <th className="w-20 px-3 py-2 text-right">Short</th>
                </>
              ) : null}
              <th className="w-28 px-3 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2">{l.item}</td>
                {quantities ? (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{l.billed === null ? "" : qtyLabel(l.billed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{l.delivered === null ? "" : qtyLabel(l.delivered)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{l.price === null ? "" : money(l.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.short === null ? "" : qtyLabel(l.short)}</td>
                  </>
                ) : null}
                <td className={`px-3 py-2 text-right tabular-nums ${l.amount < 0 ? "text-muted" : ""}`}>{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold">
              <td className="px-3 py-2" colSpan={quantities ? 5 : 1}>
                Total credit
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(view.total)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <SectionHeading count={view.applications.length + view.refunds.length}>Where it went</SectionHeading>
        {view.applications.length === 0 ? (
          <p className="text-sm text-muted">
            {memo.voided_at
              ? "Nothing — it is void."
              : memo.settlement === "refund"
              ? "Not refunded yet."
              : `Nothing yet. ${money(view.unapplied)} comes off their next ${PROCESSOR[memo.processor]} invoice when it is sent.`}
          </p>
        ) : (
          <table className="w-full max-w-[60rem] border-collapse text-[14px]">
            <thead>
              <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
                <th className="w-32 px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">What</th>
                <th className="w-32 px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {memo.settlement === "refund"
                ? view.refunds.map((r, i) => (
                    <tr key={`r${i}`}>
                      <td className="px-3 py-2 tabular-nums text-muted">{usDate(r.paid_on)}</td>
                      <td className="px-3 py-2 text-muted">
                        Refunded {money(r.amount)} · {r.payment_type ?? "—"}
                        {r.method ? ` to ${r.method}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))
                : view.applications.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2 tabular-nums text-muted">{usDate(a.created_at.slice(0, 10))}</td>
                      <td className="px-3 py-2 text-muted">
                        Applied to{" "}
                        {a.invoice_id ? (
                          <Link href={withFrom(`/customer-invoices/${a.invoice_id}`, here)} className="underline underline-offset-2">
                            invoice {a.invoice_label}
                          </Link>
                        ) : (
                          "an order"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(a.amount)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
        {memo.settlement === "credit" && view.applied > 0 && view.unapplied > 0.005 ? (
          <p className="text-[13px] text-muted">{money(view.unapplied)} is still their credit.</p>
        ) : null}
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
