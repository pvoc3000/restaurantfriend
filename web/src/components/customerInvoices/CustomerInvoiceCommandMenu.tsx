"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  DEFAULT_PAYMENT_TYPE,
  PAYMENT_TYPE_OPTIONS,
  money,
} from "@/lib/specialOrders";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";
import { invoiceFileName, type InvoiceStatus } from "@/lib/customerInvoices";
import { SendCustomerInvoice, renderInvoicePdf } from "./SendCustomerInvoice";

/**
 * The invoice record's commands (migration 124), as ONE "Actions" menu level
 * with the title at the right margin — every record screen's shape (Mark,
 * 2026-09-23: "like every other page in the app"). Groups: the document
 * (Preview, Download, Send…), the money (Record Payment…), and the destructive
 * pair (Void…, Delete).
 *
 * SEND is the one that matters, and it lives in `SendCustomerInvoice` — the
 * compose card with the PDF beside it, `SendDocument`'s shape. The rest:
 *
 * - **Record Payment…** — a cheque, cash, a Square invoice paid outside the
 *   link. `record_customer_invoice_payment` splits it across the orders oldest
 *   first, exactly as a pay-link payment is split, and refuses more than is
 *   owed.
 * The lines follow their orders by themselves (128), so there is no Update
 * Amounts: a sent invoice that has changed is re-sent with Send Again….
 * - **Void…** — the invoice stops asking for money, its link reads cancelled,
 *   and its orders are free to go on another invoice. Payments already taken
 *   stay on the orders; a refund is its own act on the order's Payments table.
 * - **Delete** — an unsent invoice with nothing paid, for a mistake.
 */
export function CustomerInvoiceCommandMenu({
  id,
  orgId,
  numberText,
  status,
  balance,
  paid,
  today,
  canWrite,
  autoSend = false,
}: {
  id: string;
  orgId: string;
  numberText: string;
  status: InvoiceStatus;
  balance: number;
  paid: number;
  /** The ORG's calendar day — what a payment and a void are dated. */
  today: string;
  canWrite: boolean;
  /** Reached with `?send=1`: open Send at once (Create and Send). */
  autoSend?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payOn, setPayOn] = useState<string | null>(today);
  const [payType, setPayType] = useState(DEFAULT_PAYMENT_TYPE);
  const [payNote, setPayNote] = useState("");

  const draft = status === "draft";
  const live = status !== "void";

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const preview = () => {
    // Opened synchronously in the handler — a popup after an await is blocked.
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { blob, view } = await renderInvoicePdf(supabase, id, today);
        showBlob(win, blob, invoiceFileName(numberText, view.invoice.issued_on));
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  const download = () =>
    run("download", async () => {
      const { blob, view } = await renderInvoicePdf(supabase, id, today);
      downloadBlob(blob, invoiceFileName(numberText, view.invoice.issued_on));
    });

  const voidInvoice = async () => {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Void invoice ${numberText}?\n\n` +
            "It stops asking for money, its pay link says it was cancelled, and its orders can go on another invoice. " +
            (paid !== 0
              ? `${money(paid)} already paid stays recorded on the orders — refund it from each order's Payments table if it is going back.`
              : "Nothing has been paid on it.")
        ),
        confirmLabel: "Void",
        tone: "danger",
      }))
    ) {
      return;
    }
    await run("void", async () => {
      const { data, error: e } = await supabase
        .from("customer_invoices")
        .update({ voided_at: today })
        .eq("id", id)
        .select("id");
      if (e) throw new Error(e.message);
      if (!data?.length) throw new Error("Nothing was voided — the database refused it and said nothing.");
      router.refresh();
    });
  };

  const remove = async () => {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Delete invoice ${numberText}?\n\nIt was never sent and nothing is paid on it, so nothing but the draft goes. Its orders are untouched.`
        ),
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    await run("delete", async () => {
      const { data, error: e } = await supabase
        .from("customer_invoices")
        .delete()
        .eq("id", id)
        .select("id");
      if (e) throw new Error(e.message);
      if (!data?.length) throw new Error("Nothing was deleted — the database refused it and said nothing.");
      router.refresh();
      router.push("/customer-invoices");
    });
  };

  const typed = Number(payAmount);
  const payOk = Number.isFinite(typed) && typed > 0 && typed <= balance + 0.005 && !!payOn;

  const recordPayment = () =>
    run("pay", async () => {
      const { error: e } = await supabase.rpc("record_customer_invoice_payment", {
        p_invoice: id,
        p_amount: Math.round(typed * 100) / 100,
        p_type: payType,
        p_paid_on: payOn,
        p_note: payNote.trim() || null,
        p_ref: null,
      });
      if (e) throw new Error(e.message);
      setPaying(false);
      setNote(`Recorded ${money(typed)}.`);
      router.refresh();
    });

  const group = (items: ActionMenuItem[]) =>
    items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));

  const menu = (sendItems: ActionMenuItem[]) => {
    const documents: ActionMenuItem[] = [
      { label: busy === "preview" ? "Rendering…" : "Preview", onSelect: preview, disabled: busy !== null },
      { label: busy === "download" ? "Rendering…" : "Download", onSelect: () => void download(), disabled: busy !== null },
      ...sendItems,
    ];
    const moneyRows: ActionMenuItem[] =
      canWrite && live && balance > 0.005
        ? [
            {
              label: "Record Payment…",
              disabled: busy !== null,
              onSelect: () => {
                setPayAmount(balance.toFixed(2));
                setPayOn(today);
                setPayType(DEFAULT_PAYMENT_TYPE);
                setPayNote("");
                setPaying(true);
              },
            },
          ]
        : [];
    const destructive: ActionMenuItem[] = [
      ...(canWrite && live
        ? [{ label: busy === "void" ? "Voiding…" : "Void…", onSelect: () => void voidInvoice(), danger: true, disabled: busy !== null }]
        : []),
      ...(canWrite && draft && paid === 0
        ? [{ label: "Delete…", onSelect: () => void remove(), danger: true, disabled: busy !== null }]
        : []),
    ];
    const groups = [documents, moneyRows, destructive].filter((g) => g.length > 0);
    return (
      <ActionMenu
        ariaLabel={`Actions for invoice ${numberText}`}
        items={groups.flatMap((g, i) => (i === 0 ? g : group(g)))}
      />
    );
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      {canWrite && live ? (
        <SendCustomerInvoice
          id={id}
          orgId={orgId}
          numberText={numberText}
          today={today}
          resend={!draft}
          disabled={busy !== null}
          autoOpen={autoSend}
        >
          {menu}
        </SendCustomerInvoice>
      ) : (
        menu([])
      )}
      {note ? <p className="max-w-sm text-right text-[13px] text-[var(--rf-green-600)]">{note}</p> : null}
      {error ? <p className="max-w-sm text-right text-[13px] text-accent">{error}</p> : null}

      {paying && (
        <Dialog
          title={`Record a payment on invoice ${numberText}`}
          onClose={() => {
            if (busy === null) setPaying(false);
          }}
          busy={busy === "pay"}
          width="max-w-md"
          onSubmit={() => {
            if (payOk && busy === null) void recordPayment();
          }}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setPaying(false)}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={() => void recordPayment()}
                disabled={!payOk || busy !== null}
              >
                {busy === "pay" ? "Recording…" : `Record ${payOk ? money(typed) : ""}`.trim()}
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Amount
                </span>
                <TextInput
                  value={payAmount}
                  onValueChange={setPayAmount}
                  aria-label="Amount received"
                  fullWidth
                  autoFocus
                />
              </label>
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Date
                </span>
                <DateField value={payOn} onChange={setPayOn} ariaLabel="Payment date" boxed />
              </label>
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  How
                </span>
                <PickList
                  value={payType}
                  onPick={setPayType}
                  variant="field"
                  allowNew
                  ariaLabel="How it was paid"
                  options={PAYMENT_TYPE_OPTIONS}
                  className="w-full"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Note
                </span>
                <TextInput value={payNote} onValueChange={setPayNote} aria-label="Note" fullWidth />
              </label>
            </div>
            <p className="text-[13px] text-muted">
              {typed > balance + 0.005
                ? `More than the ${money(balance)} still owed.`
                : `Split across the orders oldest first; an order whose share is met moves to Order. ${money(balance)} is owed.`}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
