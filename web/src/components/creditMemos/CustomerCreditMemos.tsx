"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { usePublishRecordSet } from "@/lib/recordSet";
import { money } from "@/lib/specialOrders";
import { parseMoney } from "@/lib/newPayment";
import { usDate } from "@/lib/specialOrderDocs";
import { CREDIT_MEMO_KIND_LABEL, settleCreditMemo, type CreditMemoKind, type CreditMemoSettlement } from "@/lib/creditMemos";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { TabPicker } from "@/components/ui/TabPicker";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";

export type CustomerMemoRow = {
  id: string;
  label: string;
  kind: CreditMemoKind;
  reason_code: string;
  issued_on: string;
  total: number;
  unapplied: number;
  settlement: CreditMemoSettlement;
  processor: "square" | "quickbooks";
  invoice_label: string | null;
  order_number: string | null;
  voided_at: string | null;
};

/**
 * THE CUSTOMER'S CREDIT MEMOS (218) — every memo, newest first, each a link to
 * its record, which walks this list as its found set. Beside the Credit
 * section: a memo's unapplied credit is theirs exactly as a payment's is, and
 * comes off their next invoice when it is sent.
 *
 * NEW ALLOWANCE… (manager and up) sits in the strip above the list — the
 * filter-row rule for a create command. An allowance is an amount and a
 * reason with no quantity behind it (brief §4); a short on a delivered order
 * is issued from the order instead, where the delivery record caps it.
 */
export function CustomerCreditMemos({
  customerId,
  rows,
  canIssue,
  from,
  reasons,
  orders,
  invoices,
}: {
  customerId: string;
  rows: CustomerMemoRow[];
  canIssue: boolean;
  /** This tab, for the record's breadcrumb. */
  from: Crumb;
  /** `orgs.settings.customer_credit_memos.allowance_reasons`. */
  reasons: string[];
  orders: { id: string; label: string }[];
  /** The customer's invoices that went out — what a refunded allowance can
   *  come back off. */
  invoices: { id: string; label: string; posted: boolean }[];
}) {
  const records = useMemo(
    () => rows.map((r) => ({ id: r.id, href: withFrom(`/credit-memos/${r.id}`, from) })),
    [rows, from]
  );
  usePublishRecordSet(from.href.split("?")[0], records);
  const [open, setOpen] = useState(false);

  if (rows.length === 0 && !canIssue) return null;
  return (
    <section className="space-y-2">
      <SectionHeading count={rows.length}>Credit memos</SectionHeading>
      {canIssue ? (
        <div className="flex items-center gap-4">
          <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
            New Allowance…
          </button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <table className="w-full max-w-[60rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="w-28 px-3 py-2 text-left">Memo</th>
              <th className="w-28 px-3 py-2 text-left">Issued</th>
              <th className="w-32 px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="w-32 px-3 py-2 text-left">Settled</th>
              <th className="w-24 px-3 py-2 text-right">Total</th>
              <th className="w-24 px-3 py-2 text-right">Unapplied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`hover:bg-neutral-50 ${r.voided_at ? "text-faint" : ""}`}>
                <td className="px-3 py-2 tabular-nums">
                  <Link href={records[i].href} className="hover:underline">
                    {r.label}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">{usDate(r.issued_on)}</td>
                <td className="px-3 py-2 text-muted">{CREDIT_MEMO_KIND_LABEL[r.kind]}</td>
                <td className="px-3 py-2 text-muted">
                  {r.reason_code}
                  {r.invoice_label ? ` · invoice ${r.invoice_label}` : ""}
                </td>
                <td className="px-3 py-2 text-muted">
                  {r.voided_at ? "Void" : r.settlement === "refund" ? "Refund" : "Credit"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {!r.voided_at && r.settlement === "credit" && r.unapplied > 0.005 ? money(r.unapplied) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? (
        <NewAllowance
          customerId={customerId}
          reasons={reasons}
          orders={orders}
          invoices={invoices}
          from={from}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";

function NewAllowance({
  customerId,
  reasons,
  orders,
  invoices,
  from,
  onClose,
}: {
  customerId: string;
  reasons: string[];
  orders: { id: string; label: string }[];
  invoices: { id: string; label: string; posted: boolean }[];
  from: Crumb;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<CreditMemoSettlement>("credit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = parseMoney(amount);
  const posted = invoices.find((i) => i.id === invoiceId)?.posted ?? false;
  const refundable = Boolean(invoiceId) && posted;
  const ok = typed !== null && Boolean(reason) && (settlement === "credit" || refundable);

  const issue = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const { data: id, error: e } = await supabase.rpc("issue_allowance", {
      p_customer: customerId,
      p_amount: typed,
      p_reason: reason,
      p_note: note.trim() || null,
      p_order: orderId,
      p_invoice: invoiceId,
      p_settlement: settlement,
    });
    if (e || !id) {
      setBusy(false);
      setError(e?.message ?? "The allowance was not issued.");
      return;
    }
    // Issued. The next step (QuickBooks, or the refund) can fail on its own and
    // be done again from the record, which says so.
    const { data: memo } = await supabase
      .from("customer_credit_memos")
      .select("processor, settlement")
      .eq("id", id as string)
      .maybeSingle();
    const result = memo
      ? await settleCreditMemo(supabase, {
          id: id as string,
          processor: memo.processor as "square" | "quickbooks",
          settlement: memo.settlement as CreditMemoSettlement,
        })
      : { ok: true, message: null, warning: null };
    const q = new URLSearchParams();
    if (!result.ok && result.message) q.set("problem", result.message);
    else if (result.warning) q.set("warning", result.warning);
    const base = withFrom(`/credit-memos/${id as string}`, from);
    router.push(q.toString() ? `${base}${base.includes("?") ? "&" : "?"}${q.toString()}` : base);
  };

  return (
    <Dialog
      title="New Allowance"
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-lg"
      onSubmit={() => void issue()}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void issue()} disabled={!ok || busy}>
            {busy ? "Issuing…" : `Issue ${typed !== null ? money(typed) : ""}`.trim()}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <label className="block space-y-1.5">
            <span className={LABEL}>Amount</span>
            <TextInput value={amount} onValueChange={setAmount} aria-label="Allowance amount" fullWidth autoFocus />
          </label>
          <div className="space-y-1.5">
            <span className={LABEL}>Reason</span>
            <PickList
              variant="field"
              boxed
              ariaLabel="Reason"
              value={reason}
              options={reasons.map((r) => ({ value: r, label: r }))}
              onPick={(v) => setReason(v || null)}
            />
          </div>
          <div className="space-y-1.5">
            <span className={LABEL}>Order</span>
            <PickList
              variant="field"
              boxed
              clearable
              ariaLabel="Order it is for"
              value={orderId}
              options={orders.map((o) => ({ value: o.id, label: o.label }))}
              onPick={(v) => setOrderId(v || null)}
            />
          </div>
          <div className="space-y-1.5">
            <span className={LABEL}>Invoice</span>
            <PickList
              variant="field"
              boxed
              clearable
              ariaLabel="Invoice it credits"
              value={invoiceId}
              options={invoices.map((i) => ({ value: i.id, label: i.label }))}
              onPick={(v) => {
                setInvoiceId(v || null);
                if (!v) setSettlement("credit");
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className={LABEL}>Settled</span>
          <TabPicker
            ariaLabel="How it is settled"
            value={settlement}
            onChange={(k) => setSettlement(k)}
            options={[
              { key: "credit", label: "Apply to the next invoice" },
              ...(refundable ? [{ key: "refund" as const, label: "Refund to the card" }] : []),
            ]}
          />
        </div>
        <label className="block space-y-1.5">
          <span className={LABEL}>Note</span>
          <textarea
            value={note}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className={`${FORM_FIELD_DRESS} w-full`}
            aria-label="Note printed on the memo"
          />
        </label>
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
