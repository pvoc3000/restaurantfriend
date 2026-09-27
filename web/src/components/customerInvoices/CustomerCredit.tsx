"use client";

import { useState } from "react";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { RefundPayment } from "@/components/specialOrders/RefundPayment";
import { money } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";

export type CreditRow = {
  payment_id: string;
  paid_on: string | null;
  payment_type: string | null;
  processor: string | null;
  external_ref: string | null;
  note: string | null;
  credit: number;
};

/**
 * THE CUSTOMER'S CREDIT (143) — money received and applied to nothing: what a
 * revision did not need, what QuickBooks' page took beyond an invoice. It goes
 * out by being applied — by itself when their next Square invoice is sent, or
 * with Apply Credit on an invoice — or by being refunded, which a pay-link
 * payment can be from here (manager and up, `square-refund`).
 */
export function CustomerCredit({ rows, canRefund }: { rows: CreditRow[]; canRefund: boolean }) {
  const [refunding, setRefunding] = useState<CreditRow | null>(null);
  const total = Math.round(rows.reduce((a, r) => a + r.credit, 0) * 100) / 100;
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeading count={rows.length}>Credit</SectionHeading>
      <p className="text-[13px] text-muted">
        {money(total)} of theirs is applied to nothing. It goes on their next Square invoice when it is sent.
      </p>
      <table className="w-full max-w-[52rem] border-collapse text-[14px]">
        <thead>
          <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
            <th className="w-32 px-3 py-2 text-left">Paid</th>
            <th className="w-44 px-3 py-2 text-left">How</th>
            <th className="px-3 py-2 text-left">Note</th>
            <th className="w-28 px-3 py-2 text-right">Credit</th>
            {canRefund ? <th className="w-24 px-1 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.payment_id} className="hover:bg-neutral-50">
              <td className="px-3 py-2 tabular-nums text-muted">{usDate(r.paid_on)}</td>
              <td className="px-3 py-2 text-muted">{r.payment_type ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{r.note ?? ""}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.credit)}</td>
              {canRefund ? (
                <td className="whitespace-nowrap px-1 py-2 text-right">
                  {r.payment_type === "Square Online" && r.external_ref ? (
                    <button
                      type="button"
                      onClick={() => setRefunding(r)}
                      className="text-[13px] text-muted underline underline-offset-2 hover:text-ink"
                    >
                      Refund…
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {refunding ? (
        <RefundPayment
          paymentId={refunding.payment_id}
          credit
          amount={refunding.credit}
          method={(refunding.note ?? "").replace(/^Pay link · /, "") || null}
          onClose={() => setRefunding(null)}
        />
      ) : null}
    </section>
  );
}
