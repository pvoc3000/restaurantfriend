"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { Checkbox } from "@/components/ui/Checkbox";
import { FORM_FIELD_DRESS, FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { money } from "@/lib/specialOrders";
import { qtyLabel, settleCreditMemo, type OrderDelivery } from "@/lib/creditMemos";

/** An invoice that went out billing this order — what a memo corrects. */
export type MemoInvoice = { id: string; label: string; processor: "square" | "quickbooks" };

type Settle = "credit" | "refund" | "cash" | "check";

const cents = (n: number) => Math.round(n * 100);
const parse = (text: string | undefined) => {
  const t = (text ?? "").trim();
  return t === "" ? 0 : Number(t);
};

/**
 * ISSUE CREDIT MEMO… and REFUND… — ONE DIALOG (218, 220). Mark, 2026-11-01:
 * "Tap 'Refund…' and it brings up the 'Record Short…' dialogue … Sometimes we
 * might want to issue a refund for delivery … for the rush fee … an arbitrary
 * refund … including an 'All' option to refund the entire order."
 *
 * WHAT IT GIVES BACK, all on one memo:
 *   · SHORTS — each item's quantity that did not go out. It starts at what the
 *     delivery record already leaves creditable; raising it records the short
 *     too (`record_order_short`, with the note as its reason), so a refund is
 *     never ahead of the record. Shorts correct billing: nothing re-bills them.
 *   · DELIVERY, RUSH FEE, ANOTHER AMOUNT — money back on a sale that stands,
 *     each at most what is left of it, with a reason from Settings.
 *   · ALL — every short and everything else still billed, tax included.
 * The tax, discount and rush shares of a short are the database's to work out
 * (to the cent, so the order shows nothing left to bill).
 *
 * HOW IT IS SETTLED. A wholesale day (a standing order) defaults to the next
 * invoice; anything else to a refund. A refund goes back through the processor
 * that took the payment — QuickBooks Payments or the pay link — or, on an
 * invoice Square collects, may be recorded as given back in cash or by check.
 * The memo is issued first; if the refund or the QuickBooks step fails, the
 * memo's record says so and can do it again.
 */
export function IssueCreditMemo({
  orderId,
  orderNumber,
  delivery,
  invoices,
  invoiceId: initialInvoice,
  reasons,
  standing,
  refund = false,
  note: initialNote,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  delivery: OrderDelivery;
  invoices: MemoInvoice[];
  /** The invoice to start on — the one a refunded payment was taken on. */
  invoiceId?: string;
  /** `readAllowanceReasons`: why anything but a short is given back. */
  reasons: string[];
  standing: boolean;
  /** Opened as Refund… from the Billing tab. */
  refund?: boolean;
  note: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const rf = delivery.refundable;
  // Every item an invoice billed more of than a memo has credited.
  const items = delivery.items.filter((i) => i.billed_qty - i.credited_qty > 0.005);
  const most = (i: (typeof items)[number]) => Math.min(i.creditable + i.delivered, i.billed_qty - i.credited_qty);

  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.item_id, i.creditable > 0 ? qtyLabel(i.creditable) : ""]))
  );
  const [deliveryAmt, setDeliveryAmt] = useState("");
  const [rushAmt, setRushAmt] = useState("");
  const [otherAmt, setOtherAmt] = useState("");
  const [reason, setReason] = useState<string>("");
  const [all, setAll] = useState(false);
  const [invoiceId, setInvoiceId] = useState(
    initialInvoice && invoices.some((i) => i.id === initialInvoice) ? initialInvoice : invoices[invoices.length - 1]?.id ?? ""
  );
  const [settle, setSettle] = useState<Settle>(standing ? "credit" : "refund");
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const lines = items.map((i) => ({ item: i, n: parse(qty[i.item_id]) }));
  const bad = lines.find((l) => !Number.isFinite(l.n) || l.n < 0 || l.n > most(l.item) + 0.005);
  const shorts = all ? [] : lines.filter((l) => l.n > 0);
  const raises = shorts.filter((l) => l.n > l.item.creditable + 0.005);
  const d = all ? 0 : parse(deliveryAmt);
  const r = all ? 0 : parse(rushAmt);
  const o = all ? 0 : parse(otherAmt);
  const extra = all || d > 0 || r > 0 || o > 0;
  const itemsCents = shorts.reduce((a, l) => a + Math.round(l.n * (l.item.billed_price ?? 0) * 100), 0);
  const totalCents = all ? cents(rf.total) : itemsCents + cents(d) + cents(r) + cents(o);
  const taxed = !all && shorts.some((l) => l.item.taxable);

  const problem = !invoice
    ? "No invoice that went out bills this order."
    : bad
      ? `${bad.item.name}: at most ${qtyLabel(most(bad.item))} can be credited.`
      : [d, r, o].some((n) => !Number.isFinite(n) || n < 0)
        ? "An amount is a number."
        : d > rf.delivery + 0.005
          ? `At most ${money(rf.delivery)} of the delivery charge is left.`
          : r > rf.rush + 0.005
            ? `At most ${money(rf.rush)} of the rush fee is left.`
            : all && rf.allowance > 0.005
              ? "An amount was already given back on this order; refund the rest as another amount."
              : totalCents / 100 > rf.total + 0.005
                ? `At most ${money(rf.total)} is left to give back on this order.`
                : totalCents <= 0
                  ? "Give back at least one thing."
                  : extra && !reason
                    ? "Choose why."
                    : raises.length > 0 && !note.trim()
                      ? "Say in the note why it was short."
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
    // A short beyond the record goes on the record first.
    if (raises.length) {
      const { error: e } = await supabase.rpc("record_order_short", {
        p_order: orderId,
        p_lines: raises.map((l) => ({
          item_id: l.item.item_id,
          delivered: Math.max(0, Math.round((l.item.delivered - (l.n - l.item.creditable)) * 100) / 100),
        })),
        p_note: note.trim(),
      });
      if (e) {
        setBusy(false);
        setError(e.message);
        return;
      }
    }
    const settlement = settle === "credit" ? "credit" : "refund";
    const { data: memoId, error: e } = await supabase.rpc("issue_order_credit_memo", {
      p_order: orderId,
      p_invoice: invoice.id,
      p_shorts: shorts.map((l) => ({ item_id: l.item.item_id, qty: l.n })),
      p_delivery: d,
      p_rush: r,
      p_other: o,
      p_reason: extra ? reason : null,
      p_all: all,
      p_note: note.trim() || null,
      p_settlement: settlement,
    });
    if (e || !memoId) {
      setBusy(false);
      setError(e?.message ?? "The memo was not issued.");
      if (raises.length) router.refresh();
      return;
    }
    const result = await settleCreditMemo(
      supabase,
      { id: memoId as string, processor: invoice.processor, settlement },
      {
        handType: settle === "cash" || settle === "check" ? settle : undefined,
        reason: note.trim() || `${refund ? "Refund" : "Credit"} on order ${orderNumber}`,
      }
    );
    const q = new URLSearchParams();
    if (!result.ok && result.message) q.set("problem", result.message);
    if (result.warning) q.set("warning", result.warning);
    router.push(`/credit-memos/${memoId as string}${q.size ? `?${q.toString()}` : ""}`);
  }

  const amountInput = (label: string, value: string, set: (v: string) => void, left: number) => (
    <tr className="border-b border-hairline">
      <td className="py-2 pr-3" colSpan={3}>
        {label}
        <span className="block text-[12px] text-subtle">{money(left)} left</span>
      </td>
      <td className="py-2 text-right" colSpan={2}>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${label} to give back`}
          className={`${FORM_FIELD_DRESS} w-24 text-right tabular-nums`}
          value={value}
          disabled={all}
          onChange={(e) => set(e.target.value)}
        />
      </td>
    </tr>
  );

  return (
    <Dialog
      title={refund ? "Refund" : "Issue Credit Memo"}
      onClose={onClose}
      busy={busy}
      onSubmit={issue}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void issue()} className={DIALOG_COMMIT_CLASS} disabled={busy || !!problem}>
            {settle !== "refund" ? "Issue" : taxed ? "Issue and Refund" : `Refund ${money(totalCents / 100)}`}
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
              <th className="w-24 py-1 text-right font-normal">Short</th>
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
                    aria-label={`Quantity of ${i.name} short`}
                    className={`${FORM_FIELD_DRESS} w-20 text-right tabular-nums`}
                    value={all ? qtyLabel(i.creditable) : qty[i.item_id] ?? ""}
                    disabled={all}
                    onChange={(e) => setQty((v) => ({ ...v, [i.item_id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
            {rf.delivery > 0.005 ? amountInput("Delivery", deliveryAmt, setDeliveryAmt, rf.delivery) : null}
            {rf.rush > 0.005 ? amountInput("Rush fee", rushAmt, setRushAmt, rf.rush) : null}
            {amountInput("Another amount", otherAmt, setOtherAmt, rf.total)}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 pr-3 text-right text-subtle">
                {all ? "The whole order, with tax" : taxed ? "Total, before tax on the items" : "Total"}
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{money(totalCents / 100)}</td>
            </tr>
          </tfoot>
        </table>

        <Checkbox checked={all} onChange={setAll}>
          All — everything left on the order, {money(rf.total)}
        </Checkbox>

        {extra ? (
          <div>
            <p className="mb-1 text-[13px] text-subtle">Why</p>
            <Radio ariaLabel="Why" options={reasons.map((x) => ({ value: x, label: x }))} value={reason} onChange={setReason} />
          </div>
        ) : null}

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
