"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { DateField } from "@/components/ui/DateField";
import { money } from "@/lib/specialOrders";

export type PaymentRow = {
  id: string;
  paid_on: string | null;
  amount: number | null;
  payment_type: string | null;
  note: string | null;
  external_ref: string | null;
};

/**
 * Decision 2's vocabulary, kept as it is in the data: `Square Invoice` on 1,188
 * of the 1,190 real payments, `Square Online` on one, `comp` on one — plus the
 * `legacy` type the migration synthesizes for the 5,267 pre-2022 orders whose
 * payment was a calc field rather than a row.
 *
 * `allowNew`, because payment methods are a business fact and not a schema one:
 * the day Donut Friend takes a bank transfer, nobody should need a migration.
 */
const PAYMENT_TYPES = [
  { value: "Square Invoice", label: "Square Invoice", hint: "the usual" },
  { value: "Square Online", label: "Square Online" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "comp", label: "Comp" },
  { value: "legacy", label: "Legacy", hint: "migrated from FileMaker's paid total" },
];

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
  balance,
  canWrite,
  today,
}: {
  orderId: string;
  orgId: string;
  rows: PaymentRow[];
  balance: number;
  canWrite: boolean;
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState<string | null>(today);
  const [type, setType] = useState("Square Invoice");
  const [note, setNote] = useState("");

  function reset() {
    setAmount("");
    setPaidOn(today);
    setType("Square Invoice");
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
              <th className="px-3 py-2 text-left">Note</th>
              {canWrite ? <th className="w-8 px-1 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue table="special_order_payments" id={p.id} column="paid_on" kind="date"
                                 value={p.paid_on} ariaLabel="Payment date" />
                  ) : (
                    <span className="tabular-nums">{p.paid_on ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {canWrite ? (
                    <InlineValue table="special_order_payments" id={p.id} column="amount" kind="number"
                                 value={p.amount} nullable={false} align="right" className="text-right"
                                 ariaLabel="Payment amount" format={(v) => money(Number(v))} />
                  ) : (
                    money(Number(p.amount ?? 0))
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue table="special_order_payments" id={p.id} column="payment_type" kind="pick"
                                 allowNew clearable options={PAYMENT_TYPES} value={p.payment_type}
                                 ariaLabel="How it was paid" />
                  ) : (
                    <span className="text-muted">{p.payment_type ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite ? (
                    <InlineValue table="special_order_payments" id={p.id} column="note" value={p.note}
                                 ariaLabel="Payment note" placeholder="—" />
                  ) : (
                    <span className="text-muted">{p.note ?? "—"}</span>
                  )}
                </td>
                {canWrite ? (
                  <td className="px-1 py-2 text-right">
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

      {canWrite ? (
        adding ? (
          <div className="flex flex-wrap items-end gap-3 border border-hairline p-4">
            <Field label="Amount">
              <TextInput
                value={amount}
                onValueChange={setAmount}
                placeholder={balance > 0 ? balance.toFixed(2) : "0.00"}
                aria-label="Amount received"
                className="w-32"
                autoFocus
              />
            </Field>
            <Field label="Date">
              <DateField value={paidOn} onChange={setPaidOn} ariaLabel="Payment date" className="w-40" />
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
              <TextInput value={note} onValueChange={setNote} placeholder="10% deposit" aria-label="Payment note" className="w-56" />
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
          <button type="button" className={BUTTON_CLASS} onClick={() => setAdding(true)}>
            Take a payment
          </button>
        )
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
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
