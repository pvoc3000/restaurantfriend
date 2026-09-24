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
import { CreateInvoiceDialog } from "@/components/customerInvoices/CreateInvoiceDialog";
import type { InvoiceCandidate } from "@/lib/customerInvoices";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { DateField } from "@/components/ui/DateField";
import {
  DEFAULT_PAYMENT_TYPE,
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
  invoice = null,
  createInvoice = null,
  balance,
  canWrite,
  canRefund = false,
  today,
  workflow,
}: {
  orderId: string;
  orgId: string;
  rows: PaymentRow[];
  /**
   * The customer invoice that bills this order (124). While there is one, the
   * money is taken ON THE INVOICE — split across its orders — so this section
   * offers no Take a payment of its own (Mark, 2026-09-23): a payment typed
   * here would not count against the invoice, which would go on asking for it.
   */
  invoice?: { label: string; href: string } | null;
  /**
   * CREATE INVOICE, beside Take a payment (Mark, 2026-09-23) — the same
   * dialog as the Actions menu's Create Invoice…, stopping at the draft.
   * Offered only while no invoice bills the order.
   */
  createInvoice?: { candidate: InvoiceCandidate; from: { href: string; label: string } } | null;
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
  const [adding, setAdding] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState<string | null>(today);
  const [type, setType] = useState(DEFAULT_PAYMENT_TYPE);
  const [note, setNote] = useState("");

  function reset() {
    setAmount("");
    setPaidOn(today);
    setType(DEFAULT_PAYMENT_TYPE);
    setNote("");
  }

  function take() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) return;
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_payments")
        .insert({
          // Explicit — design rule 1.
          org_id: orgId,
          order_id: orderId,
          amount: value,
          paid_on: paidOn,
          payment_type: type || null,
          note: note.trim() || null,
        })
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was recorded — the database refused it and said nothing.");
        return;
      }
      reset();
      setAdding(false);
      router.refresh();

      /**
       * RECORDING THE MONEY IS THE PAID EVENT (Mark, 2026-08-21).
       *
       * Asked only when this payment SETTLES the order, which is why it reads
       * the balance rather than the payment: a deposit on a wedding order is
       * not the moment an invoice is paid, and asking on every part-payment
       * would teach somebody to dismiss the question by the time it mattered.
       *
       * `balance` is the figure BEFORE this payment — the server has not
       * re-rendered yet — so the test subtracts what was just taken. A credit
       * (a negative payment) can only move it the wrong way, which the
       * comparison handles by being a comparison rather than a flag.
       */
      if (balance - value <= 0.005) {
        const cs = afterPaymentSettled(workflow, paidOn ?? today);
        if (cs.length > 0) setOffer(cs);
      }
    });
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

      {invoice ? (
        <p className="text-[13px] text-muted">
          Billed on{" "}
          <Link href={invoice.href} className="text-ink underline underline-offset-2">
            {invoice.label}
          </Link>{" "}
          — payments are recorded there.
        </p>
      ) : canWrite ? (
        adding ? (
          <div className="flex flex-wrap items-end gap-3 border border-hairline p-4">
            <Field label="Amount">
              <TextInput
                value={amount}
                onValueChange={setAmount}
                placeholder={balance > 0 ? balance.toFixed(2) : ""}
                aria-label="Amount received"
                className="w-32"
                autoFocus
              />
            </Field>
            <Field label="Date">
              {/* The bordered box (Mark, 2026-09-16). `boxed` fills its track,
                  so the width is the wrapper's — `className` reaches only the
                  input inside. */}
              <div className="w-40">
                <DateField value={paidOn} onChange={setPaidOn} ariaLabel="Payment date" boxed />
              </div>
            </Field>
            <Field label="How">
              <PickList
                value={type}
                onPick={setType}
                variant="field"
                allowNew
                ariaLabel="How it was paid"
                options={PAYMENT_TYPES}
                className="w-48"
              />
            </Field>
            <Field label="Note">
              <TextInput value={note} onValueChange={setNote} aria-label="Payment note" className="w-56" />
            </Field>
            <button type="button" className={BUTTON_CLASS} onClick={take} disabled={pending || !amount.trim()}>
              {pending ? "Recording…" : "Record"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); reset(); }}
              className="text-[13px] text-muted underline underline-offset-2 hover:text-ink"
            >
              Cancel
            </button>
            {/* The balance is stated where the amount is typed, because "how
                much is left" is the question this form exists to answer. It is
                a PLACEHOLDER rather than a prefilled value: a deposit is the
                normal case here (FMP's own notes are full of "10% deposit"). */}
            {balance > 0 ? (
              <span className="text-[12px] text-muted">{money(balance)} outstanding</span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {createInvoice ? (
              <button type="button" className={BUTTON_CLASS} onClick={() => setCreatingInvoice(true)}>
                Create invoice…
              </button>
            ) : null}
            <button type="button" className={BUTTON_CLASS} onClick={() => setAdding(true)}>
              Take a payment
            </button>
          </div>
        )
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {creatingInvoice && createInvoice && (
        <CreateInvoiceDialog
          candidates={[createInvoice.candidate]}
          orgId={orgId}
          today={today}
          onClose={() => setCreatingInvoice(false)}
          from={createInvoice.from}
          thenSend={false}
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
      {/* Asked only once the balance is clear — see `take`. */}
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
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
