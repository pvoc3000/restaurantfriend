"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { useRouter } from "next/navigation";

import {
  afterPaymentSettled,
  type Consequence,
  type WorkflowOrder,
} from "@/lib/orderWorkflow";
import { WorkflowOffer } from "./WorkflowOffer";
import { RefundPayment } from "./RefundPayment";
import { NewPaymentDialog } from "./NewPaymentDialog";
import { InvoiceStatusChip } from "@/components/customerInvoices/InvoiceStatusChip";
import type { InvoiceStatus } from "@/lib/customerInvoices";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import {
  PAYMENT_TYPE_OPTIONS as PAYMENT_TYPES,
  isRefundablePayment,
  money,
} from "@/lib/specialOrders";

export type PaymentRow = {
  id: string;
  paid_on: string | null;
  amount: number | null;
  payment_type: string | null;
  note: string | null;
  external_ref: string | null;
  /** The customer invoice this payment was taken on (124), if any. */
  invoice?: { label: string; href: string } | null;
};

/** One of the order's invoices (139: an order can be on several — a deposit,
 *  a part payment, the balance), as the Payments tab lists them. */
export type OrderInvoiceRow = {
  id: string;
  label: string;
  href: string;
  /** "Deposit", "Balance due", "Part payment" — or "" for a plain one. */
  what: string;
  /** What it bills for THIS order. */
  amount: number;
  status: InvoiceStatus;
};

/** What New Payment… needs to know about the order. */
export type NewPaymentContext = {
  orderNumber: string;
  total: number;
  uninvoiced: number;
  hasBalanceInvoice: boolean;
  hasCustomer: boolean;
  defaultDepositRate: number;
  from: { href: string; label: string };
};

/**
 * Payments as ROWS, which is decision 2's whole point.
 *
 * There is no `paid` status and no payments TABLE beyond this one — payment is
 * a fact QuickBooks will own, and two truths about the same money is worse than
 * one truth elsewhere. The balance on the totals card is derived from these.
 *
 * `external_ref` exists from day one and nothing writes it yet: it is where a
 * Square invoice id lands when decision 20's approve-and-pay arrives, and the
 * acceptance test for v1 is that adding it needs no schema surgery.
 */
export function OrderPayments({
  orderId,
  orgId,
  rows,
  invoices = [],
  newPayment = null,
  balance,
  canWrite,
  canRefund = false,
  today,
  workflow,
}: {
  orderId: string;
  orgId: string;
  rows: PaymentRow[];
  /** Its invoices, void ones left out (139). */
  invoices?: OrderInvoiceRow[];
  /**
   * NEW PAYMENT… (Mark, 2026-09-25) — the one door for money: cash now, or an
   * invoice for the balance, a deposit or another amount. Null where an order
   * cannot take one (a template, a standing order).
   */
  newPayment?: NewPaymentContext | null;
  balance: number;
  canWrite: boolean;
  /** Manager and up — `canRefundPayments`. Offers Refund… on pay-link rows. */
  canRefund?: boolean;
  today: string;
  /** Enough of the order to ask whether a settling payment finishes it. */
  workflow: WorkflowOrder;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [offer, setOffer] = useState<Consequence[] | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [opening, setOpening] = useState(false);

  /**
   * RECORDING THE MONEY IS THE PAID EVENT (Mark, 2026-08-21) — asked only
   * when cash SETTLES the order, which is why it reads the balance rather than
   * the payment. `balance` is the figure BEFORE this payment; the server has
   * not re-rendered yet. An invoice's payment settles the order in the
   * database instead (139's allocate).
   */
  function afterCash(amount: number) {
    if (balance - amount <= 0.005) {
      const cs = afterPaymentSettled(workflow, today);
      if (cs.length > 0) setOffer(cs);
    }
  }

  async function remove(row: PaymentRow) {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Remove the ${money(Number(row.amount ?? 0))} payment?\n\nThe balance recomputes without it. This is a record of money received — remove it only if it was entered by mistake.`
        ),
        confirmLabel: "Remove",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_payments")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("Nothing was removed — the database refused it silently.");
      else router.refresh();
    });
  }

  // The Invoice column only where some payment has one — the thousands of
  // orders billed on their own keep the table they had.
  const showInvoice = rows.some((p) => p.invoice);

  return (
    <div className="space-y-8">
    {invoices.length > 0 || newPayment ? (
      <section className="space-y-2">
        {/* THE ORDER'S INVOICES, then what they collected (Mark, 2026-09-25:
            "Back on the special order page, the invoice is shown along with
            its status"). ALWAYS THERE on an order that can take a payment,
            empty or not (Mark, same day) — like Payments below it. */}
        <SectionHeading count={invoices.length}>Invoices</SectionHeading>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
        <table className="w-full max-w-[52rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="w-36 px-3 py-2 text-left">Invoice</th>
              <th className="px-3 py-2 text-left">For</th>
              <th className="w-28 px-3 py-2 text-right">Amount</th>
              <th className="w-44 px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <Link href={i.href} className="underline underline-offset-2">
                    {i.label}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{i.what || "Order"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(i.amount)}</td>
                <td className="px-3 py-2">
                  <InvoiceStatusChip status={i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </section>
    ) : null}
    <section className="space-y-2">
      <SectionHeading count={rows.length}>Payments</SectionHeading>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing received yet.</p>
      ) : (
        <table className="w-full max-w-[52rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="w-36 px-3 py-2 text-left">Date</th>
              <th className="w-28 px-3 py-2 text-right">Amount</th>
              <th className="w-44 px-3 py-2 text-left">How</th>
              {showInvoice ? <th className="w-32 px-3 py-2 text-left">Invoice</th> : null}
              <th className="px-3 py-2 text-left">Note</th>
              {canWrite ? <th className="w-8 px-1 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue boxed={BOXED_FIELDS} table="special_order_payments" id={p.id} column="paid_on" kind="date"
                                 value={p.paid_on} ariaLabel="Payment date" />
                  ) : (
                    <span className="tabular-nums">{p.paid_on ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {canWrite ? (
                    <InlineValue boxed={BOXED_FIELDS} table="special_order_payments" id={p.id} column="amount" kind="number"
                                 value={p.amount} nullable={false} align="right" className="text-right"
                                 ariaLabel="Payment amount" format={(v) => money(Number(v))} />
                  ) : (
                    money(Number(p.amount ?? 0))
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue boxed={BOXED_FIELDS} table="special_order_payments" id={p.id} column="payment_type" kind="pick"
                                 allowNew clearable options={PAYMENT_TYPES} value={p.payment_type}
                                 ariaLabel="How it was paid" />
                  ) : (
                    <span className="text-muted">{p.payment_type ?? "—"}</span>
                  )}
                </td>
                {showInvoice ? (
                  <td className="px-3 py-2">
                    {p.invoice ? (
                      <Link href={p.invoice.href} className="underline underline-offset-2">
                        {p.invoice.label}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue boxed={BOXED_FIELDS} table="special_order_payments" id={p.id} column="note" value={p.note}
                                 ariaLabel="Payment note" placeholder="—" />
                  ) : (
                    <span className="text-muted">{p.note ?? "—"}</span>
                  )}
                </td>
                {canWrite ? (
                  <td className="whitespace-nowrap px-1 py-2 text-right">
                    {canRefund && isRefundablePayment(p) ? (
                      <button
                        type="button"
                        onClick={() => setRefunding(p)}
                        disabled={pending}
                        className="mr-2 text-[13px] text-muted underline underline-offset-2 hover:text-ink disabled:opacity-35"
                      >
                        Refund…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      disabled={pending}
                      aria-label="Remove this payment"
                      className="px-1 text-[15px] leading-none text-subtle hover:text-accent disabled:opacity-35"
                    >
                      ×
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && newPayment ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BUTTON_CLASS} onClick={() => setOpening(true)}>
            New Payment…
          </button>
        </div>
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {opening && newPayment && (
        <NewPaymentDialog
          orderId={orderId}
          orgId={orgId}
          orderNumber={newPayment.orderNumber}
          total={newPayment.total}
          uninvoiced={newPayment.uninvoiced}
          hasBalanceInvoice={newPayment.hasBalanceInvoice}
          hasCustomer={newPayment.hasCustomer}
          defaultDepositRate={newPayment.defaultDepositRate}
          today={today}
          from={newPayment.from}
          onClose={() => setOpening(false)}
          onCash={afterCash}
        />
      )}
      {refunding && (
        <RefundPayment
          paymentId={refunding.id}
          amount={Number(refunding.amount ?? 0)}
          method={(refunding.note ?? "").replace(/^Pay link · /, "") || null}
          onClose={() => setRefunding(null)}
        />
      )}
      {/* Asked only once the balance is clear — see `afterCash`. */}
      {offer && (
        <WorkflowOffer
          orderId={orderId}
          orgId={orgId}
          consequences={offer}
          onClose={() => setOffer(null)}
          title="Paid in full"
        />
      )}
    </section>
    </div>
  );
}
