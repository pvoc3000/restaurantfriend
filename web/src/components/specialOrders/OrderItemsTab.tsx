"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { FORM_FIELD_DRESS, FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { OrderLines } from "./OrderLines";
import { IssueCreditMemo, type MemoInvoice } from "@/components/creditMemos/IssueCreditMemo";
import { creditableItems, normalizeDelivery, qtyLabel, type OrderDelivery } from "@/lib/creditMemos";

type Delivery = {
  /** 217's `order_delivery`, as the server read it. */
  raw: unknown;
  /** Supervisor and up (the order screen's own write access). */
  canRecord: boolean;
  /** Manager and up: issue a memo, or decide on no credit. */
  canIssue: boolean;
  orderNumber: string;
  /** A day of a standing order — wholesale, whose memo is credit by default. */
  standing: boolean;
  /** The invoices that went out billing this order: what a memo can correct. */
  invoices: MemoInvoice[];
};

/**
 * THE ITEMS TAB WITH ITS DELIVERY RECORD (217, brief §1 and §3): the lines,
 * each with what went OUT beside what was ordered, and — when a short is on
 * record — a notice above them saying what it means for the money.
 *
 * DELIVERED DEFAULTS TO ORDERED (Mark, 2026-10-31: "we can change it if
 * anything ever goes wrong"), so nothing here asks anyone to confirm a
 * delivery. Record Short… is how one is changed, and a reason goes with it.
 * What happens next follows from the invoices: a short before invoicing is
 * simply billed as delivered; a short on quantity an invoice already billed
 * waits for a manager — Issue Credit Memo…, or No Credit… with why — and
 * the order's to-do says so until one of them happens.
 */
export function OrderItemsTab({
  delivery,
  ...lines
}: Omit<ComponentProps<typeof OrderLines>, "delivered" | "onRecordShort"> & { delivery: Delivery | null }) {
  const d = useMemo(() => normalizeDelivery(delivery?.raw), [delivery?.raw]);
  const [recording, setRecording] = useState<string | null | "all">(null);
  const [issuing, setIssuing] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const delivered = useMemo(
    () =>
      d ? new Map(d.items.map((i) => [i.item_id, { delivered: i.delivered, recorded: i.recorded, note: i.note }])) : undefined,
    [d]
  );

  return (
    <div className="space-y-6">
      {delivery && d ? (
        <ShortNotice
          d={d}
          delivery={delivery}
          onRecord={() => setRecording("all")}
          onIssue={() => setIssuing(true)}
          onDecide={() => setDeciding(true)}
        />
      ) : null}
      <OrderLines
        {...lines}
        delivered={delivered}
        onRecordShort={delivery?.canRecord ? (itemId) => setRecording(itemId) : undefined}
      />
      {recording && d && delivery ? (
        <RecordShortDialog
          orderId={lines.orderId}
          d={d}
          focus={recording === "all" ? null : recording}
          onClose={() => setRecording(null)}
        />
      ) : null}
      {issuing && d && delivery ? (
        <IssueCreditMemo
          orderId={lines.orderId}
          orderNumber={delivery.orderNumber}
          items={creditableItems(d)}
          invoices={delivery.invoices}
          standing={delivery.standing}
          note={d.items.find((i) => i.creditable > 0 && i.note)?.note ?? ""}
          onClose={() => setIssuing(false)}
        />
      ) : null}
      {deciding && d ? (
        <NoCreditDialog orderId={lines.orderId} current={d.short_decision_note} onClose={() => setDeciding(false)} />
      ) : null}
    </div>
  );
}

/**
 * WHAT THE RECORD SAYS, above the lines — only when there is something to say:
 * a short on record, a memo given, or a decision. "Delivered 518 of 560
 * Knotted Bismark — dropped a rack. INV-10025-2 billed all 560."
 */
function ShortNotice({
  d,
  delivery,
  onRecord,
  onIssue,
  onDecide,
}: {
  d: OrderDelivery;
  delivery: Delivery;
  onRecord: () => void;
  onIssue: () => void;
  onDecide: () => void;
}) {
  const shorts = d.items.filter((i) => i.recorded);
  const open = creditableItems(d);
  const credited = d.items.filter((i) => i.credited_qty > 0);
  if (shorts.length === 0 && credited.length === 0 && !d.short_decision) {
    return delivery.canRecord ? (
      <div className="flex justify-end">
        <button type="button" className={SMALL_BUTTON_CLASS} onClick={onRecord}>
          Record Short…
        </button>
      </div>
    ) : null;
  }
  const billedLabel = delivery.invoices.map((i) => i.label).join(", ");
  return (
    <div className="border border-ink bg-white px-4 py-3 text-[14px]">
      <ul className="space-y-1">
        {shorts.map((i) => (
          <li key={i.item_id}>
            <span className="font-semibold">
              Delivered {qtyLabel(i.delivered)} of {qtyLabel(i.ordered)} {i.name}
            </span>
            {i.note ? <> — {i.note}</> : null}
            <span className="text-subtle">
              {i.recorded_by ? ` · ${i.recorded_by}` : ""}
              {i.recorded_at ? ` · ${new Date(i.recorded_at).toLocaleDateString("en-US")}` : ""}
            </span>
            {i.billed_qty > 0 ? (
              <span className="block text-[13px] text-muted">
                {billedLabel ? `${billedLabel} billed ${qtyLabel(i.billed_qty)}` : `Billed ${qtyLabel(i.billed_qty)}`}
                {i.credited_qty > 0 ? ` · credited ${qtyLabel(i.credited_qty)}` : ""}
                {i.creditable > 0 ? ` · ${qtyLabel(i.creditable)} not credited` : ""}
              </span>
            ) : (
              <span className="block text-[13px] text-muted">Not invoiced yet — it will be billed as delivered.</span>
            )}
          </li>
        ))}
        {credited
          .filter((i) => !i.recorded)
          .map((i) => (
            <li key={i.item_id} className="text-muted">
              {i.name}: credited {qtyLabel(i.credited_qty)}, now delivered as ordered — the credit is billed again on the
              next invoice.
            </li>
          ))}
        {d.short_decision ? (
          <li>
            <span className="font-semibold">No credit</span>
            {d.short_decision_note ? <> — {d.short_decision_note}</> : null}
            <span className="text-subtle">{d.short_decision_by ? ` · ${d.short_decision_by}` : ""}</span>
          </li>
        ) : null}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {delivery.canIssue && open.length > 0 ? (
          <>
            <button type="button" className={BUTTON_CLASS} onClick={onIssue}>
              Issue Credit Memo…
            </button>
            <button type="button" className={BUTTON_CLASS} onClick={onDecide}>
              No Credit…
            </button>
          </>
        ) : null}
        {delivery.canIssue && d.short_decision ? (
          <button type="button" className={BUTTON_CLASS} onClick={onDecide}>
            Change Decision…
          </button>
        ) : null}
        {delivery.canRecord ? (
          <button type="button" className={BUTTON_CLASS} onClick={onRecord}>
            Record Short…
          </button>
        ) : null}
      </div>
      {!delivery.canIssue && open.length > 0 ? (
        <p className="mt-2 text-[13px] text-muted">A manager issues the credit memo.</p>
      ) : null}
    </div>
  );
}

/**
 * RECORD SHORT… — each line's Ordered and what was Delivered, and a reason.
 * A line set back to its ordered quantity is cleared. Only the lines that
 * changed are written (`record_order_short`, which refuses more than ordered
 * and a short with no reason).
 */
function RecordShortDialog({
  orderId,
  d,
  focus,
  onClose,
}: {
  orderId: string;
  d: OrderDelivery;
  focus: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.items.map((i) => [i.item_id, qtyLabel(i.delivered)]))
  );
  const [note, setNote] = useState(() => d.items.find((i) => i.note)?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = d.items.map((i) => {
    const text = (values[i.item_id] ?? "").trim();
    const n = text === "" ? NaN : Number(text);
    return { item: i, n, changed: Number.isFinite(n) && n !== i.delivered };
  });
  const invalid = parsed.find((p) => !Number.isFinite(p.n) || p.n < 0 || p.n > p.item.ordered);
  const changed = parsed.filter((p) => p.changed);
  const anyShort = parsed.some((p) => Number.isFinite(p.n) && p.n < p.item.ordered);
  const problem = invalid
    ? `${invalid.item.name}: delivered is a number from 0 to ${qtyLabel(invalid.item.ordered)}.`
    : changed.length === 0
      ? null
      : anyShort && !note.trim()
        ? "A short needs a reason."
        : null;

  async function save() {
    if (busy || problem || changed.length === 0) return;
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("record_order_short", {
      p_order: orderId,
      p_lines: changed.map((p) => ({ item_id: p.item.item_id, delivered: p.n })),
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      title="Record Short"
      onClose={onClose}
      busy={busy}
      onSubmit={save}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={DIALOG_COMMIT_CLASS} disabled={busy || !!problem || changed.length === 0}>
            Save
          </button>
        </>
      }
    >
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-ink text-left text-xs uppercase tracking-[0.08em] text-subtle">
            <th className="py-1 pr-3 font-normal">Item</th>
            <th className="w-24 py-1 pr-3 text-right font-normal">Ordered</th>
            <th className="w-28 py-1 text-right font-normal">Delivered</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.item_id} className="border-b border-hairline">
              <td className="py-2 pr-3">{i.name}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{qtyLabel(i.ordered)}</td>
              <td className="py-2 text-right">
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus={focus === i.item_id}
                  aria-label={`Delivered of ${i.name}`}
                  className={`${FORM_FIELD_DRESS} w-24 text-right tabular-nums`}
                  value={values[i.item_id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [i.item_id]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="mt-4 block text-[13px] text-subtle" htmlFor="short-reason">
        Reason
      </label>
      <textarea
        id="short-reason"
        rows={2}
        className={FORM_TEXTAREA}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {problem && changed.length > 0 ? <p className="mt-2 text-[13px] text-accent">{problem}</p> : null}
      {error ? <p className="mt-2 text-[13px] text-accent">{error}</p> : null}
    </Dialog>
  );
}

/** NO CREDIT… — a manager decides a short gets no memo (a make-good, a gift),
 *  with why. An empty reason withdraws the decision. */
function NoCreditDialog({ orderId, current, onClose }: { orderId: string; current: string | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(withdraw = false) {
    if (busy || (!withdraw && !note.trim())) return;
    setBusy(true);
    const { error: e } = await createClient().rpc("decide_order_short", {
      p_order: orderId,
      p_note: withdraw ? null : note.trim(),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      title="No Credit"
      onClose={onClose}
      busy={busy}
      onSubmit={() => save()}
      footer={
        <>
          {current ? (
            <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => save(true)}>
              Reopen for a Memo
            </button>
          ) : null}
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={DIALOG_COMMIT_CLASS} disabled={busy || !note.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="block text-[13px] text-subtle" htmlFor="no-credit-reason">
        Why no credit
      </label>
      <textarea
        id="no-credit-reason"
        rows={3}
        className={FORM_TEXTAREA}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? <p className="mt-2 text-[13px] text-accent">{error}</p> : null}
    </Dialog>
  );
}
