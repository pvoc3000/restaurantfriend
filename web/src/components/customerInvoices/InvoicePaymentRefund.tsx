"use client";

import { useState } from "react";

import { refundProcessor } from "@/lib/specialOrders";
import { RefundPayment } from "@/components/specialOrders/RefundPayment";

/**
 * Refund… on a row of the invoice record's Payments tab (Mark, 2026-09-28:
 * he went looking for it on the invoice first). The same dialog and the same
 * functions as the order's Billing tab — the row is the same thing, an
 * order's share of a payment (a `payment_applications` row).
 *
 * `square-refund` reads an ORDER's share, so a Square payment on the
 * invoice's other charges is not offered here; QuickBooks' refund reads the
 * application itself, so it is.
 */
export function InvoicePaymentRefund({
  payment,
}: {
  payment: {
    id: string;
    amount: number;
    payment_type: string | null;
    external_ref: string | null;
    note: string | null;
    order_number: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const processor = refundProcessor(payment);
  if (!processor || (processor === "square" && !payment.order_number)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] text-muted underline underline-offset-2 hover:text-ink"
      >
        Refund…
      </button>
      {open && (
        <RefundPayment
          paymentId={payment.id}
          amount={payment.amount}
          method={(payment.note ?? "").replace(/^Pay link · /, "") || null}
          processor={processor}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
