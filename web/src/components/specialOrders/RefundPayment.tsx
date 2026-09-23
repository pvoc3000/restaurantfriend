"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/specialOrders";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";

/**
 * GIVE A PAY-LINK PAYMENT BACK, through Square (`square-refund`).
 *
 * The amount starts at the whole payment — a live value, the refund that will
 * really be sent if nobody changes it — and can be lowered for a part refund.
 * Square is the authority on what is left to refund (a refund made in Square's
 * dashboard counts), so the function refuses an amount over it and says the
 * figure; this dialog does not try to know.
 *
 * NOTHING ELSE ON THE ORDER MOVES (Mark, 2026-09-22: "leave status alone").
 * The refund is recorded as a negative payment and the balance follows; whether
 * the order is then cancelled or re-invoiced is the person's next step.
 */
export function RefundPayment({
  paymentId,
  amount,
  method,
  onClose,
}: {
  paymentId: string;
  amount: number;
  /** "visa ending 2998", from the payment's note. */
  method: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(amount.toFixed(2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per dialog: a second press after a lost answer is the SAME refund
  // to Square, never a second one.
  const [key] = useState(() => crypto.randomUUID());

  const n = Number(value);
  const valid = Number.isFinite(n) && n > 0 && n <= amount + 0.005;

  async function refund() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await createClient().functions.invoke("square-refund", {
      body: { payment_id: paymentId, amount: n, reason: reason.trim() || null, idempotency_key: key },
    });
    setBusy(false);
    if (e) {
      let message = e.message;
      try {
        const parsed = await (e as { context?: Response }).context?.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep the generic message
      }
      setError(message);
      return;
    }
    const warning = (data as { warning?: string } | null)?.warning;
    if (warning) {
      setError(`Refunded, but ${warning}`);
      router.refresh();
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog
      title="Refund payment"
      onClose={busy ? () => {} : onClose}
      busy={busy}
      width="max-w-md"
      onSubmit={() => void refund()}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={DIALOG_COMMIT_CLASS}
            onClick={() => void refund()}
            disabled={busy || !valid}
          >
            {busy ? "Refunding…" : `Refund ${valid ? money(n) : ""}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[14px]">
          {money(amount)} paid online{method ? ` (${method})` : ""}. The money goes back the way it
          came, through Square.
        </p>
        <label className="block space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Amount
          </span>
          <TextInput value={value} onValueChange={setValue} aria-label="Refund amount" className="w-32" autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Reason
          </span>
          <TextInput value={reason} onValueChange={setReason} aria-label="Refund reason" className="w-full" />
        </label>
        {error && <p className="text-[13px] text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
