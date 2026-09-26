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
  NEW_INVOICE_LABEL,
  amountFromPercent,
  newInvoiceProblem,
  parseMoney,
  percentFromAmount,
  type NewInvoiceChoice,
} from "@/lib/newPayment";

/** One width for the labels, so the amounts line up in a column. */
const LABEL = "inline-block w-[7.5rem]";

/**
 * NEW INVOICE (Mark, 2026-09-25, migration 139) — asking for money, one
 * invoice per request, as VERTICAL radios, each with its own figure:
 *
 *   (•) Balance Due:  $331.65
 *   ( ) Deposit:      [$] [%]
 *   ( ) Other:        [$]
 *
 * Continue makes a DRAFT invoice carrying the note and opens it, "where they
 * can edit it or press Send". A deposit's % is of the order's total and starts
 * at Settings' rate; typing either box fills the other, and typing in a box
 * chooses its option. Money RECEIVED is New Payment's, next to Payments.
 */
export function NewInvoiceDialog({
  orderId,
  orderNumber,
  total,
  uninvoiced,
  hasBalanceInvoice,
  hasCustomer,
  defaultDepositRate,
  from,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  /** The order's total — what a deposit's % is of. */
  total: number;
  /** `uninvoicedAmount` — what an invoice may still ask for. */
  uninvoiced: number;
  hasBalanceInvoice: boolean;
  hasCustomer: boolean;
  /** Settings' deposit rate, a fraction. */
  defaultDepositRate: number;
  /** The invoice's breadcrumb back to this order. */
  from: { href: string; label: string };
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  // The balance first — unless one is already asked for, when a deposit or
  // part payment is all that is left to choose.
  const [choice, setChoice] = useState<NewInvoiceChoice>(hasBalanceInvoice ? "deposit" : "balance");
  const [depositAmount, setDepositAmount] = useState(() =>
    amountFromPercent(total, String(toPercent(defaultDepositRate)))
  );
  const [depositPercent, setDepositPercent] = useState(() => String(toPercent(defaultDepositRate)));
  const [other, setOther] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountText = choice === "deposit" ? depositAmount : choice === "other" ? other : "";
  const problem = newInvoiceProblem({ choice, amountText, uninvoiced, hasBalanceInvoice, hasCustomer });
  const ready = problem === null && !busy;

  async function go() {
    if (!ready) return;
    setBusy(true);
    setError(null);
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
    pick: NewInvoiceChoice,
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
      title={`New Invoice — Order #${orderNumber}`}
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
            {busy ? "Creating…" : "Continue"}
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
          ariaLabel="New invoice"
          value={choice}
          onChange={setChoice}
          disabled={busy}
          className="gap-3"
          options={[
            {
              value: "balance",
              label: <span className={LABEL}>{NEW_INVOICE_LABEL.balance}:</span>,
              // What the balance invoice would bill — read, not typed, so no
              // box. Padded as a TextInput is inside its border (12 + 1 left,
              // 36 for the clear button + 1 right) so the digits line up.
              after: (
                <span className="inline-block w-28 pl-[13px] pr-[37px] text-right tabular-nums">
                  {money(Math.max(uninvoiced, 0))}
                </span>
              ),
            },
            {
              value: "deposit",
              label: <span className={LABEL}>{NEW_INVOICE_LABEL.deposit}:</span>,
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
              label: <span className={LABEL}>{NEW_INVOICE_LABEL.other}:</span>,
              after: box(other, setOther, "Other amount", "other"),
            },
          ]}
        />

        <label className="block space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Note on the Invoice
          </span>
          <TextInput value={note} onValueChange={setNote} aria-label="Note on the Invoice" fullWidth disabled={busy} />
        </label>

        {problem && (amountText.trim() || choice === "balance" || !hasCustomer) ? (
          <p className="text-[13px]">
            <span className="box-decoration-clone bg-mark-fill px-1">{problem}</span>
          </p>
        ) : null}
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
