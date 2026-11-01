"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import { confirmDialog } from "@/lib/confirm";
import { fillTemplate, usDate } from "@/lib/specialOrderDocs";
import { money } from "@/lib/specialOrders";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";
import {
  DEFAULT_CREDIT_MEMO_EMAIL,
  memoSettlementSentence,
  settleCreditMemo,
  type CreditMemoSettlement,
} from "@/lib/creditMemos";
import { blobToBase64, renderCreditMemoPdf } from "./renderCreditMemo";

/**
 * THE CREDIT MEMO RECORD'S COMMANDS (218), one Actions menu at the title row:
 * the paper (Preview, Download, Email…), the step still owed after the issue
 * (Send to QuickBooks for a QuickBooks credit memo, Refund for a refunded one
 * whose refund did not happen), how it is settled while nothing of it is
 * applied, and Void…. Manager and up — the people who issue them.
 */
export function CreditMemoCommandMenu({
  id,
  orgId,
  label,
  processor,
  settlement,
  step,
  applied,
  voided,
  inQuickBooks,
  canWrite,
}: {
  id: string;
  orgId: string;
  label: string;
  processor: "square" | "quickbooks";
  settlement: CreditMemoSettlement;
  /** `outstandingStep`: what the issue left undone. */
  step: "push" | "refund" | null;
  applied: number;
  voided: boolean;
  inQuickBooks: boolean;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; cc: string; subject: string; body: string } | null>(null);
  const [pending, setPending] = useState<{ blob: Blob; url: string; filename: string } | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
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
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { blob, filename } = await renderCreditMemoPdf(supabase, id);
        showBlob(win, blob, filename);
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  const download = () =>
    run("download", async () => {
      const { blob, filename } = await renderCreditMemoPdf(supabase, id);
      downloadBlob(blob, filename);
    });

  const openEmail = () =>
    run("compose", async () => {
      const { blob, view, settings, doc, filename } = await renderCreditMemoPdf(supabase, id);
      const cm = (settings.customer_credit_memos ?? {}) as Record<string, unknown>;
      const { data: me } = await supabase.rpc("my_first_name", { p_org: orgId });
      const vars: Record<string, string> = {
        number: view.label,
        first_name: view.customer.first_name || view.customer.name,
        customer: view.customer.name,
        total: money(view.total),
        invoice: view.invoice?.label ?? "—",
        order: view.order?.number ?? "",
        reason: view.memo.reason_code,
        settlement_line: memoSettlementSentence(view, usDate),
        employee_name: (me as string | null) || doc.name,
      };
      const subject = typeof cm.email_subject === "string" && cm.email_subject.trim() ? cm.email_subject : DEFAULT_CREDIT_MEMO_EMAIL.subject;
      const body = typeof cm.email_body === "string" && cm.email_body.trim() ? cm.email_body : DEFAULT_CREDIT_MEMO_EMAIL.body;
      const cc = view.order?.contact_email && view.order.contact_email !== view.customer.email ? view.order.contact_email : "";
      setCompose({ to: view.customer.email ?? "", cc, subject: fillTemplate(subject, vars), body: fillTemplate(body, vars) });
      setPending({ blob, url: URL.createObjectURL(blob), filename });
    });

  const close = () => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setCompose(null);
    setError(null);
  };

  const send = () =>
    run("send", async () => {
      if (!compose || !pending) return;
      const { data, error: e } = await supabase.functions.invoke("send-special-order-email", {
        body: {
          credit_memo_id: id,
          to: compose.to,
          cc: compose.cc || undefined,
          subject: compose.subject,
          body: compose.body,
          pdf_base64: await blobToBase64(pending.blob),
          filename: pending.filename,
        },
      });
      if (e) {
        let message = e.message;
        try {
          const parsed = await (e as { context?: Response }).context?.json();
          if (parsed?.error) message = parsed.error;
        } catch {
          // keep the generic message
        }
        throw new Error(message);
      }
      const warning = (data as { warning?: string } | null)?.warning;
      const to = compose.to;
      close();
      setNote(`Credit memo ${label} sent to ${to}${warning ? ` — ${warning}` : ""}`);
      router.refresh();
    });

  const settle = () =>
    run("settle", async () => {
      const result = await settleCreditMemo(supabase, { id, processor, settlement });
      if (!result.ok) throw new Error(result.message ?? "That did not go through.");
      setNote(
        (step === "push" ? `Sent to QuickBooks as credit memo ${label}` : `Credit memo ${label} refunded`) +
          (result.warning ? ` — ${result.warning}` : "")
      );
      router.refresh();
    });

  const switchSettlement = (next: CreditMemoSettlement) =>
    run("switch", async () => {
      const { error: e } = await supabase.rpc("set_credit_memo_settlement", { p_memo: id, p_settlement: next });
      if (e) throw new Error(e.message);
      router.refresh();
    });

  const voidMemo = () =>
    run("void", async () => {
      if (
        !(await confirmDialog({
          title: `Void credit memo ${label}?`,
          body: inQuickBooks
            ? "It is voided in QuickBooks first, then here. The order’s short is open again for a new memo."
            : "The order’s short is open again for a new memo.",
          confirmLabel: "Void",
          tone: "danger",
        }))
      ) {
        return;
      }
      if (inQuickBooks) {
        const { message } = await invokeQbo(supabase, { mode: "void_credit_memo", credit_memo_id: id });
        if (message) throw new Error(`QuickBooks: ${message}`);
      } else {
        const { error: e } = await supabase.rpc("void_credit_memo", { p_memo: id });
        if (e) throw new Error(e.message);
      }
      router.refresh();
    });

  const sep = (items: ActionMenuItem[]) => items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));
  const off = busy !== null;
  const documents: ActionMenuItem[] = [
    { label: busy === "preview" ? "Opening…" : "Preview", onSelect: () => void preview(), disabled: off },
    { label: busy === "download" ? "Rendering…" : "Download", onSelect: () => void download(), disabled: off },
    ...(canWrite && !voided
      ? [{ label: busy === "compose" ? "Loading…" : "Email…", onSelect: () => void openEmail(), disabled: off }]
      : []),
  ];
  const money_: ActionMenuItem[] =
    canWrite && !voided
      ? [
          ...(step === "push"
            ? [{ label: busy === "settle" ? "Sending…" : "Send to QuickBooks", onSelect: () => void settle(), disabled: off }]
            : step === "refund"
            ? [{ label: busy === "settle" ? "Refunding…" : "Refund Again", onSelect: () => void settle(), disabled: off }]
            : []),
          ...(applied === 0
            ? [
                settlement === "refund"
                  ? { label: "Change to Credit", onSelect: () => void switchSettlement("credit"), disabled: off }
                  : { label: "Change to Refund", onSelect: () => void switchSettlement("refund"), disabled: off },
              ]
            : []),
        ]
      : [];
  const destructive: ActionMenuItem[] =
    canWrite && !voided && applied === 0
      ? [{ label: busy === "void" ? "Voiding…" : "Void…", onSelect: () => void voidMemo(), danger: true, disabled: off }]
      : [];
  const groups = [documents, money_, destructive].filter((g) => g.length > 0);

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <ActionMenu ariaLabel={`Actions for credit memo ${label}`} items={groups.flatMap((g, i) => (i === 0 ? g : sep(g)))} />
      {note && <p className="max-w-sm text-right text-[13px] text-[var(--rf-green-600)]">{note}</p>}
      {error && !compose && <p className="max-w-sm text-right text-[13px] text-accent">{error}</p>}

      {compose && pending && (
        <Dialog
          title={`Email credit memo #${label}`}
          onClose={close}
          busy={busy !== null}
          width="max-w-5xl"
          top="pt-[4vh]"
          height="h-[88vh]"
          bodyClassName="grid min-h-0 gap-4 p-6 md:grid-cols-2 md:grid-rows-1"
          footer={
            <>
              <span className="mr-auto text-xs text-subtle">
                Attached: {pending.filename} — the document shown here is what sends
              </span>
              <button type="button" disabled={busy !== null} onClick={close} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || !compose.to.trim()}
                onClick={() => void send()}
                className={DIALOG_COMMIT_CLASS}
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
              {(
                [
                  ["To", "to"],
                  ["Cc", "cc"],
                  ["Subject", "subject"],
                ] as const
              ).map(([fieldLabel, field]) => (
                <label key={field} className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">{fieldLabel}</span>
                  <TextInput
                    value={compose[field]}
                    disabled={busy !== null}
                    onValueChange={(next) => setCompose({ ...compose, [field]: next })}
                    clearLabel={`Clear ${fieldLabel}`}
                    className="w-full"
                  />
                </label>
              ))}
              <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">Body</span>
              <textarea
                value={compose.body}
                rows={14}
                disabled={busy !== null}
                onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                className={FORM_FIELD_DRESS}
              />
            </div>
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
          <object
            data={pending.url}
            type="application/pdf"
            aria-label={`Preview of ${pending.filename}`}
            className="h-[26rem] w-full border border-ink md:h-full md:min-h-[26rem]"
          >
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-subtle">
              This browser can’t preview PDFs inline — use Preview to open it in its own tab.
            </div>
          </object>
        </Dialog>
      )}
    </div>
  );
}
