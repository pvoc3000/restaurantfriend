"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { FORM_FIELD_DRESS, FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { money } from "@/lib/specialOrders";
import { qtyLabel, settleCreditMemo, type DeliveryItem } from "@/lib/creditMemos";

/** An invoice that went out billing this order — what a memo corrects. */
export type MemoInvoice = { id: string; label: string; processor: "square" | "quickbooks" };

type Settle = "credit" | "refund" | "cash" | "check";

/**
 * ISSUE CREDIT MEMO… (218, brief §3 and §6a). PREFILLED AND CAPPED BY THE
 * DELIVERY RECORD, not typed: each short line starts at what is left to
 * credit — billed − delivered − already credited — at the price it was
 * billed at, and may be lowered, never raised. To credit more, the delivery
 * record is corrected first (Record Short…), which leaves its own trace.
 *
 * HOW IT IS SETTLED. A wholesale day (a standing order) defaults to the next
 * invoice; a retail order to a refund, since there is usually no next
 * invoice. A refund goes back through the processor that took the payment —
 * QuickBooks Payments or the pay link — or, on an invoice Square collects,
 * may be recorded as given back in cash or by check. The memo is issued
 * first; if the refund or the QuickBooks step fails, the memo's record says
 * so and can do it again.
 *
 * The tax, discount and rush shares are the database's to work out (to the
 * cent, so the order shows nothing left to bill); the total here is the
 * items', and the record shows the rest.
 */
export function IssueCreditMemo({
  orderId,
  orderNumber,
  items,
  invoices,
  standing,
  note: initialNote,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  items: DeliveryItem[];
  invoices: MemoInvoice[];
  standing: boolean;
  note: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.item_id, qtyLabel(i.creditable)]))
  );
  const [invoiceId, setInvoiceId] = useState(invoices[invoices.length - 1]?.id ?? "");
  const [settle, setSettle] = useState<Settle>(standing ? "credit" : "refund");
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const lines = items.map((i) => {
    const text = (qty[i.item_id] ?? "").trim();
    const n = text === "" ? 0 : Number(text);
    return { item: i, n };
  });
  const bad = lines.find((l) => !Number.isFinite(l.n) || l.n < 0 || l.n > l.item.creditable);
  const chosen = lines.filter((l) => l.n > 0);
  const itemsTotal = chosen.reduce((a, l) => a + Math.round(l.n * (l.item.billed_price ?? 0) * 100), 0) / 100;
  const taxed = chosen.some((l) => l.item.taxable);
  const problem = !invoice
    ? "No invoice that went out bills this order."
    : bad
      ? `${bad.item.name}: at most ${qtyLabel(bad.item.creditable)} can be credited.`
      : chosen.length === 0
        ? "Credit at least one line."
        : null;

  const settleOptions: { value: Settle; label: string }[] = [
    { value: "credit", label: "Apply to the next invoice" },
    { value: "refund", label: "Refund to the card" },
    ...(invoice?.processor === "square"
      ? ([
          { value: "cash", label: "Refunded in cash" },
          { value: "check", label: "Refunded by check" },
        ] as const)
      : []),
  ];

  async function issue() {
    if (busy || problem || !invoice) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const settlement = settle === "credit" ? "credit" : "refund";
    const { data: memoId, error: e } = await supabase.rpc("issue_credit_memo", {
      p_order: orderId,
      p_invoice: invoice.id,
      p_lines: chosen.map((l) => ({ item_id: l.item.item_id, qty: l.n })),
      p_note: note.trim() || null,
      p_settlement: settlement,
    });
    if (e || !memoId) {
      setBusy(false);
      setError(e?.message ?? "The memo was not issued.");
      return;
    }
    const result = await settleCreditMemo(
      supabase,
      { id: memoId as string, processor: invoice.processor, settlement },
      {
        handType: settle === "cash" || settle === "check" ? settle : undefined,
        reason: note.trim() || `Short on order ${orderNumber}`,
      }
    );
    const q = new URLSearchParams();
    if (!result.ok && result.message) q.set("problem", result.message);
    if (result.warning) q.set("warning", result.warning);
    router.push(`/credit-memos/${memoId as string}${q.size ? `?${q.toString()}` : ""}`);
  }

  return (
    <Dialog
      title="Issue Credit Memo"
      onClose={onClose}
      busy={busy}
      onSubmit={issue}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={DIALOG_COMMIT_CLASS} disabled={busy || !!problem}>
            {settle === "refund" ? "Issue and Refund" : "Issue"}
          </button>
        </>
      }
    >
      <div className="space-y-5 text-[14px]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-ink text-left text-xs uppercase tracking-[0.08em] text-subtle">
              <th className="py-1 pr-3 font-normal">Item</th>
              <th className="w-16 py-1 pr-3 text-right font-normal">Billed</th>
              <th className="w-20 py-1 pr-3 text-right font-normal">Delivered</th>
              <th className="w-20 py-1 pr-3 text-right font-normal">Price</th>
              <th className="w-24 py-1 text-right font-normal">Credit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.item_id} className="border-b border-hairline">
                <td className="py-2 pr-3">
                  {i.name}
                  {i.credited_qty > 0 ? (
                    <span className="block text-[12px] text-subtle">{qtyLabel(i.credited_qty)} credited already</span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{qtyLabel(i.billed_qty)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{qtyLabel(i.delivered)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(i.billed_price ?? 0)}</td>
                <td className="py-2 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Quantity of ${i.name} to credit`}
                    className={`${FORM_FIELD_DRESS} w-20 text-right tabular-nums`}
                    value={qty[i.item_id] ?? ""}
                    onChange={(e) => setQty((v) => ({ ...v, [i.item_id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 pr-3 text-right text-subtle">
                Items{taxed ? ", before tax" : ""}
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{money(itemsTotal)}</td>
            </tr>
          </tfoot>
        </table>

        {invoices.length > 1 ? (
          <div>
            <p className="mb-1 text-[13px] text-subtle">Credits invoice</p>
            <Radio
              ariaLabel="Credits invoice"
              options={invoices.map((i) => ({ value: i.id, label: i.label }))}
              value={invoiceId}
              onChange={setInvoiceId}
            />
          </div>
        ) : invoice ? (
          <p>
            <span className="text-subtle">Credits invoice </span>
            {invoice.label}
          </p>
        ) : null}

        <div>
          <p className="mb-1 text-[13px] text-subtle">Settled by</p>
          <Radio ariaLabel="Settled by" vertical options={settleOptions} value={settle} onChange={setSettle} />
        </div>

        <div>
          <label className="block text-[13px] text-subtle" htmlFor="memo-note">
            Note
          </label>
          <textarea id="memo-note" rows={2} className={FORM_TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {problem ? <p className="text-[13px] text-accent">{problem}</p> : null}
        {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
