"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { TextInput } from "@/components/ui/TextInput";
import { money } from "@/lib/specialOrders";
import { withFrom } from "@/lib/breadcrumbs";
import { toPercent } from "@/lib/percent";
import {
  NEW_PAYMENT_LABEL,
  amountFromPercent,
  newPaymentProblem,
  parseMoney,
  percentFromAmount,
  type NewPaymentChoice,
} from "@/lib/newPayment";

/**
 * NEW PAYMENT (Mark, 2026-09-25, migration 139) — the order's one door for
 * money, four choices as VERTICAL radios, each carrying its own box:
 *
 *   (•) Cash Payment: [$]
 *   ( ) Invoice Balance Due
 *   ( ) Invoice Deposit: [$] [%]
 *   ( ) Invoice Other: [$]
 *
 * Cash is recorded on the order there and then. The other three make an
 * invoice of their own — a DRAFT, carrying the note — and open it, "where they
 * can edit it or press Send". A deposit's % is of the order's total and starts
 * at Settings' rate; typing either box fills the other.
 *
 * Typing into an option's box chooses that option, so nobody types a deposit
 * and sends cash.
 */
/** One width for the labels, so the amount boxes line up in a column. */
const LABEL = "inline-block w-[8.5rem]";

export function NewPaymentDialog({
  orderId,
  orgId,
  orderNumber,
  total,
  uninvoiced,
  hasBalanceInvoice,
  hasCustomer,
  defaultDepositRate,
  today,
  from,
  onClose,
  onCash,
}: {
  orderId: string;
  orgId: string;
  orderNumber: string;
  /** The order's total — what a deposit's % is of. */
  total: number;
  /** `uninvoicedAmount` — what an invoice may still ask for. */
  uninvoiced: number;
  hasBalanceInvoice: boolean;
  hasCustomer: boolean;
  /** Settings' deposit rate, a fraction. */
  defaultDepositRate: number;
  /** The org's calendar day — a cash payment's date. */
  today: string;
  /** The invoice's breadcrumb back to this order. */
  from: { href: string; label: string };
  onClose: () => void;
  /** After cash is recorded — the caller asks whether it settled the order. */
  onCash: (amount: number) => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [choice, setChoice] = useState<NewPaymentChoice>("cash");
  const [cash, setCash] = useState("");
  const [depositAmount, setDepositAmount] = useState(() =>
    amountFromPercent(total, String(toPercent(defaultDepositRate)))
  );
  const [depositPercent, setDepositPercent] = useState(() => String(toPercent(defaultDepositRate)));
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountText =
    choice === "cash" ? cash : choice === "deposit" ? depositAmount : choice === "other" ? other : "";
  const problem = newPaymentProblem({ choice, amountText, uninvoiced, hasBalanceInvoice, hasCustomer });
  const ready = problem === null && !busy;

  async function go() {
    if (!ready) return;
    setBusy(true);
    setError(null);

    if (choice === "cash") {
      const amount = parseMoney(cash)!;
      const { data, error: e } = await supabase
        .from("special_order_payments")
        .insert({
          // Explicit — design rule 1.
          org_id: orgId,
          order_id: orderId,
          amount,
          paid_on: today,
          payment_type: "Cash",
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
      onCash(amount);
      return;
    }

    const { data, error: e } = await supabase.rpc("create_payment_invoice", {
      p_order: orderId,
      p_kind: choice,
      p_amount: choice === "balance" ? null : parseMoney(amountText),
      p_note: note.trim() || null,
    });
    if (e || !data) {
      setBusy(false);
      setError(e?.message ?? "The invoice was not created.");
      return;
    }
    router.push(withFrom(`/customer-invoices/${data as string}`, from));
  }

  const box = (
    value: string,
    set: (v: string) => void,
    label: string,
    pick: NewPaymentChoice,
    width = "w-28",
    after?: (v: string) => void
  ) => (
    <TextInput
      value={value}
      onValueChange={(v) => {
        set(v);
        after?.(v);
        setChoice(pick);
      }}
      onFocus={() => setChoice(pick)}
      inputMode="decimal"
      aria-label={label}
      className={`${width} text-right tabular-nums`}
      disabled={busy}
    />
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
            {busy ? "Working…" : "Continue"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] text-muted">
          Order total {money(total)} · not yet invoiced {money(Math.max(uninvoiced, 0))}
        </p>

        <Radio
          vertical
          ariaLabel="New payment"
          value={choice}
          onChange={setChoice}
          disabled={busy}
          className="gap-3"
          options={[
            {
              value: "cash",
              label: <span className={LABEL}>{NEW_PAYMENT_LABEL.cash}:</span>,
              after: box(cash, setCash, "Cash amount", "cash"),
            },
            { value: "balance", label: NEW_PAYMENT_LABEL.balance },
            {
              value: "deposit",
              label: <span className={LABEL}>{NEW_PAYMENT_LABEL.deposit}:</span>,
              after: (
                <>
                  {box(depositAmount, setDepositAmount, "Deposit amount", "deposit", "w-28", (v) =>
                    setDepositPercent(percentFromAmount(total, v))
                  )}
                  <span className="inline-flex items-center gap-1">
                    {box(depositPercent, setDepositPercent, "Deposit percentage", "deposit", "w-20", (v) =>
                      setDepositAmount(amountFromPercent(total, v))
                    )}
                    <span className="text-muted">%</span>
                  </span>
                </>
              ),
            },
            {
              value: "other",
              label: <span className={LABEL}>{NEW_PAYMENT_LABEL.other}:</span>,
              after: box(other, setOther, "Other amount", "other"),
            },
          ]}
        />

        <label className="block space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Note</span>
          <TextInput value={note} onValueChange={setNote} aria-label="Note" fullWidth disabled={busy} />
        </label>

        {problem && (amountText.trim() || choice === "balance" || choice !== "cash" && !hasCustomer) ? (
          <p className="text-[13px]">
            <span className="box-decoration-clone bg-mark-fill px-1">{problem}</span>
          </p>
        ) : null}
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
