"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { PAYMENT_TYPE_OPTIONS, money } from "@/lib/specialOrders";
import {
  defaultApplyTo,
  newPaymentProblem,
  parseMoney,
  type OpenInvoice,
} from "@/lib/newPayment";

/** "The order" in the Apply to radios — no invoice. */
const ORDER = "order";

/**
 * NEW PAYMENT (Mark, 2026-09-25) — money RECEIVED: how much, how, when, a
 * note, and what it pays. Asking for money is New Invoice's.
 *
 * APPLY TO is the point of the split. A payment on an order with an open
 * invoice must be ON that invoice, or the invoice goes on asking for money
 * already paid and the balance invoice shrinks instead. So each open invoice
 * is a choice ("Invoice 1010 · Deposit · $3.80 due"), the OLDEST first and
 * chosen, then "The order — no invoice". On an invoice it goes through
 * `record_customer_invoice_payment` — the invoice record's own Record
 * Payment, which closes the invoice when met and settles the order when ITS
 * balance reaches zero (139). On the order it is a plain payment row, the
 * old Take a payment.
 */
export function NewPaymentDialog({
  orderId,
  orgId,
  orderNumber,
  openInvoices,
  today,
  onClose,
  onOrderPayment,
}: {
  orderId: string;
  orgId: string;
  orderNumber: string;
  openInvoices: OpenInvoice[];
  /** The org's calendar day — the payment date it starts at. */
  today: string;
  onClose: () => void;
  /** After a payment on the ORDER — the caller asks whether it settled it. An
   *  invoice payment settles the order in the database instead. */
  onOrderPayment: (amount: number) => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const sorted = [...openInvoices].sort((a, b) => a.number - b.number);
  const [applyTo, setApplyTo] = useState<string>(defaultApplyTo(sorted)?.id ?? ORDER);
  const [amount, setAmount] = useState("");
  const [how, setHow] = useState("cash");
  const [paidOn, setPaidOn] = useState<string | null>(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoice = sorted.find((i) => i.id === applyTo) ?? null;
  const problem = newPaymentProblem({ amountText: amount, applyTo: invoice });
  const ready = problem === null && !busy && !!paidOn;
  const value = parseMoney(amount);

  async function go() {
    if (!ready || value === null) return;
    setBusy(true);
    setError(null);

    if (invoice) {
      const { error: e } = await supabase.rpc("record_customer_invoice_payment", {
        p_invoice: invoice.id,
        p_amount: value,
        p_type: how || null,
        p_paid_on: paidOn,
        p_note: note.trim() || null,
        p_ref: null,
      });
      setBusy(false);
      if (e) {
        setError(e.message);
        return;
      }
      onClose();
      router.refresh();
      return;
    }

    const { data, error: e } = await supabase
      .from("special_order_payments")
      .insert({
        // Explicit — design rule 1.
        org_id: orgId,
        order_id: orderId,
        amount: value,
        paid_on: paidOn,
        payment_type: how || null,
        note: note.trim() || null,
      })
      .select("id");
    setBusy(false);
    if (e || !data?.length) {
      setError(e?.message ?? "Nothing was recorded — the database refused it and said nothing.");
      return;
    }
    onClose();
    router.refresh();
    onOrderPayment(value);
  }

  const caption = (text: string) => (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{text}</span>
  );

  return (
    <Dialog
      title={`New Payment — Order #${orderNumber}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-lg"
      onSubmit={() => void go()}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void go()} disabled={!ready}>
            {busy ? "Recording…" : value !== null ? `Record ${money(value)}` : "Record"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          {caption("Apply to")}
          <Radio
            vertical
            ariaLabel="Apply to"
            value={applyTo}
            onChange={setApplyTo}
            disabled={busy}
            className="gap-2"
            options={[
              ...sorted.map((i) => ({
                value: i.id,
                label: `${[i.label, i.what].filter(Boolean).join(" · ")} · ${money(i.due)} due`,
              })),
              { value: ORDER, label: "The order — no invoice" },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block space-y-1.5">
            {caption("Amount")}
            <TextInput
              value={amount}
              onValueChange={setAmount}
              inputMode="decimal"
              aria-label="Amount received"
              className="w-32 text-right tabular-nums"
              disabled={busy}
              autoFocus
            />
          </label>
          <div className="space-y-1.5">
            {caption("How")}
            <PickList
              value={how}
              onPick={setHow}
              variant="field"
              allowNew
              ariaLabel="How it was paid"
              options={PAYMENT_TYPE_OPTIONS}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            {caption("Date")}
            {/* The bordered box; `boxed` fills its track, so the width is the
                wrapper's. */}
            <div className="w-40">
              <DateField value={paidOn} onChange={setPaidOn} ariaLabel="Payment date" boxed />
            </div>
          </div>
        </div>

        <label className="block space-y-1.5">
          {caption("Note")}
          <TextInput value={note} onValueChange={setNote} aria-label="Payment note" fullWidth disabled={busy} />
        </label>

        {problem && amount.trim() ? (
          <p className="text-[13px]">
            <span className="box-decoration-clone bg-mark-fill px-1">{problem}</span>
          </p>
        ) : null}
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
