"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import { TextInput } from "@/components/ui/TextInput";
import { buildDeliveryQuoteEmail, type DeliveryQuoteFacts } from "@/lib/specialOrderDocs";
import { createClient } from "@/lib/supabase/client";

/**
 * REQUEST QUOTE — ask the delivery company for a pickup time and a cost (Mark,
 * 2026-10-01, after FileMaker's script).
 *
 * The same shape as every other email this module sends: the message is
 * filled from the org's template (Settings → Messages → Delivery quote
 * request), shown in an editable compose card, and only goes when somebody
 * presses Send. `send-special-order-email` sends it from the special orders
 * mailbox and writes the log line.
 *
 * Filled when the card OPENS, not when the tab renders, so it reads the order
 * as it is at that moment — a box count typed a second ago is in it.
 */
export function RequestDeliveryQuote({
  orderId,
  to,
  facts,
  orgSettings,
  orgName,
}: {
  orderId: string;
  /** The delivery company's email on the order. */
  to: string | null;
  facts: DeliveryQuoteFacts;
  orgSettings: Record<string, unknown>;
  orgName: string;
}) {
  const router = useRouter();
  const [compose, setCompose] = useState<{ to: string; cc: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function open() {
    const { subject, body } = buildDeliveryQuoteEmail(facts, orgSettings, orgName);
    setCompose({ to: (to ?? "").trim(), cc: "", subject, body });
    setError(null);
    setSent(null);
  }

  async function send() {
    if (!compose || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await createClient().functions.invoke("send-special-order-email", {
      body: { kind: "delivery_quote", order_id: orderId, ...compose },
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
    setSent(warning ? `Sent, ${warning.replace(/^sent, /, "")}` : `Quote requested from ${compose.to}.`);
    setCompose(null);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-1">
        <button type="button" className={BUTTON_CLASS} onClick={open}>
          Request Quote
        </button>
        {sent ? <p className="text-[12px] text-muted" role="status">{sent}</p> : null}
      </div>

      {compose && (
        <Dialog
          title="Request a delivery quote"
          ariaLabel="Request a delivery quote"
          onClose={() => !busy && setCompose(null)}
          busy={busy}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCompose(null)}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !compose.to.trim()}
                onClick={send}
                className={DIALOG_COMMIT_CLASS}
                title={compose.to.trim() ? undefined : "Add a recipient first"}
              >
                {busy ? "Sending…" : "Send"}
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
              ).map(([label, field]) => (
                <label key={field} className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">{label}</span>
                  <TextInput
                    value={compose[field]}
                    disabled={busy}
                    onValueChange={(next) => setCompose({ ...compose, [field]: next })}
                    clearLabel={`Clear ${label}`}
                    className="w-full"
                  />
                </label>
              ))}
              <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">
                Body
              </span>
              <textarea
                value={compose.body}
                rows={18}
                disabled={busy}
                onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                className={FORM_FIELD_DRESS}
              />
            </div>
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
