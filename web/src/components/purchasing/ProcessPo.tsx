"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog } from "@/components/ui/Dialog";
import {
  buildEmailParts,
  downloadBlob,
  fetchPoDocData,
  mailtoFromParts,
  nextDeliveryDate,
  openWindowNow,
  sendPoEmail,
  sharePdf,
  showBlob,
  SENT_VIA_FOR_ORDER_TYPE,
  type EmailParts,
} from "@/lib/poProcessing";
import type { PurchaseOrder } from "@/lib/purchaseOrders";

/** What the card needs beyond the order itself — fetched by the detail page. */
export type ProcessingContext = {
  order_type: string;
  vendor_url: string | null;
  rep_email: string | null;
  delivery_days: number[] | null;
};

/**
 * Processing (spec §2 step 4), per vendor order_type:
 * - email_po — an IN-APP compose card (Mark, 2026-07-23: "roll our own"):
 *   to/cc/subject/body prefilled from the templates and editable in place,
 *   Send posts them with the client-rendered §4.9 PDF to the send-po-email
 *   edge function (Resend), which also stamps the PO sent. "Use Mail app"
 *   remains the escape hatch (share sheet, else download + mailto draft).
 * - online   — open the vendor's site; the PDF is available as a reference.
 * - in_person — the shopping list PDF, sorted by shop section.
 * Every path ends with the PO marked sent — automatically for in-app email,
 * via the "Mark as sent" button for the rest.
 *
 * The PDF renderer and document components load on first click, not with the
 * page — they're heavy and most visits never generate anything.
 */
export function ProcessPo({
  order,
  context,
}: {
  order: PurchaseOrder;
  context: ProcessingContext;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState(false);
  // The compose card's editable fields; null = closed.
  const [compose, setCompose] = useState<EmailParts | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  // The attachment, rendered ONCE when the dialog opens: the preview pane and
  // the send both use this exact blob, so what's shown is what goes out.
  const [attachment, setAttachment] = useState<{
    blob: Blob;
    url: string;
    filename: string;
  } | null>(null);

  function closeCompose() {
    if (attachment) URL.revokeObjectURL(attachment.url);
    setAttachment(null);
    setCompose(null);
  }

  const sentVia = SENT_VIA_FOR_ORDER_TYPE[context.order_type] ?? "print";
  const suggestion =
    order.delivery_date === null
      ? nextDeliveryDate(order.order_date, context.delivery_days)
      : null;

  async function loadDocs() {
    const [{ pdf }, docs, { org, pos }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./pdf/PoPdfDocs"),
      fetchPoDocData(supabase, [order.id]),
    ]);
    if (pos.length === 0) throw new Error("Order not found");
    return { pdf, docs, org, po: pos[0] };
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Open the compose dialog: prefill the fields AND render the attachment,
   *  so the preview pane shows the exact document Send will transmit. */
  const openCompose = () =>
    run("compose", async () => {
      const { pdf, docs, org, po } = await loadDocs();
      const blob = await pdf(<docs.PoPdf pos={[po]} org={org} />).toBlob();
      setSentNote(null);
      setAttachment({
        blob,
        url: URL.createObjectURL(blob),
        filename: `PO ${po.po_number}.pdf`,
      });
      setCompose(buildEmailParts(po, org));
    });

  /** The reviewed fields + the previewed PDF → edge function → sent. */
  const send = () =>
    run("send", async () => {
      if (!compose || !attachment) return;
      const { warning } = await sendPoEmail(supabase, {
        po_id: order.id,
        parts: compose,
        blob: attachment.blob,
        filename: attachment.filename,
      });
      const to = compose.to;
      closeCompose();
      setSentNote(`Sent to ${to}${warning ? ` — ${warning}` : ""}`);
      router.refresh();
    });

  /**
   * The escape hatch (e.g. Resend not configured yet): hand the EDITED fields
   * and the previewed PDF to the mail app — share sheet where files can be
   * shared, else download + prefilled draft. Marking sent stays manual here.
   */
  const useMailApp = () =>
    run("mailapp", async () => {
      if (!compose || !attachment) return;
      const shared = await sharePdf(
        attachment.blob,
        attachment.filename,
        compose.subject,
        compose.body
      );
      if (shared === "cancelled") return;
      if (shared === "unsupported") {
        downloadBlob(attachment.blob, attachment.filename);
        window.location.href = mailtoFromParts(compose);
      }
      setProcessed(true);
    });

  const previewPdf = () => {
    // Opened before any await, while the click gesture still counts — a popup
    // opened after async work is silently blocked.
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { pdf, docs, org, po } = await loadDocs();
        const blob = await pdf(<docs.PoPdf pos={[po]} org={org} />).toBlob();
        showBlob(win, blob, `PO ${po.po_number}.pdf`);
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  const shoppingList = () =>
    run("shopping", async () => {
      const { pdf, docs, org, po } = await loadDocs();
      const blob = await pdf(<docs.ShoppingListPdf pos={[po]} org={org} />).toBlob();
      downloadBlob(blob, `Shopping list ${po.po_number}.pdf`);
      setProcessed(true);
    });

  const openVendorSite = () =>
    run("online", async () => {
      if (context.vendor_url) window.open(context.vendor_url, "_blank");
      setProcessed(true);
    });

  const markSent = () =>
    run("sent", async () => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "sent", sent_via: sentVia })
        .eq("id", order.id);
      if (error) throw new Error(error.message);
      router.refresh();
    });

  const setDelivery = (date: string | null) =>
    run("delivery", async () => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ delivery_date: date })
        .eq("id", order.id);
      if (error) throw new Error(error.message);
      router.refresh();
    });

  const btn =
    "h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";
  const primaryBtn =
    "h-9 bg-ink px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:bg-neutral-300";

  return (
    <div className="space-y-3 border border-ink bg-white p-6 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Process · {context.order_type.replace("_", " ")}
        </span>

        {/* Delivery date first: it prints on the document. Generation fills it
            in from the vendor's delivery days (migration 016), so this is
            usually already correct — it's here for the exceptions (a holiday, a
            special run, a vendor with no delivery days recorded). The
            suggestion chip only appears when the date is still empty. */}
        <label className="flex items-center gap-2 text-muted">
          <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Delivery
          </span>
          <input
            type="date"
            value={order.delivery_date ?? ""}
            disabled={busy !== null}
            onChange={(e) => setDelivery(e.target.value || null)}
            className="h-9 border border-ink px-2"
          />
        </label>
        {suggestion && (
          <button
            disabled={busy !== null}
            onClick={() => setDelivery(suggestion)}
            title="The vendor's next delivery day after the order date"
            className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-xs text-ink hover:bg-[var(--rf-yellow-100)] disabled:opacity-35"
          >
            arrives {suggestion}
          </button>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {context.order_type === "email_po" && (
            <>
              <button disabled={busy !== null} onClick={previewPdf} className={btn}>
                {busy === "preview" ? "Rendering…" : "Preview PDF"}
              </button>
              {compose === null && (
                <button
                  disabled={busy !== null}
                  onClick={openCompose}
                  className={primaryBtn}
                  title="Compose here — the PDF attaches itself on send"
                >
                  {busy === "compose" ? "Loading…" : "Email PO…"}
                </button>
              )}
            </>
          )}

          {context.order_type === "online" && (
            <>
              <button disabled={busy !== null} onClick={previewPdf} className={btn}>
                {busy === "preview" ? "Rendering…" : "Preview PDF"}
              </button>
              <button
                disabled={busy !== null || !context.vendor_url}
                onClick={openVendorSite}
                className={primaryBtn}
                title={context.vendor_url ?? "No URL on the vendor record"}
              >
                Open vendor site
              </button>
            </>
          )}

          {context.order_type === "in_person" && (
            <button disabled={busy !== null} onClick={shoppingList} className={primaryBtn}>
              {busy === "shopping" ? "Rendering…" : "Shopping list PDF"}
            </button>
          )}

          {context.order_type === "none" && (
            <button disabled={busy !== null} onClick={previewPdf} className={btn}>
              {busy === "preview" ? "Rendering…" : "Preview PDF"}
            </button>
          )}

          {order.status === "draft" && (
            <button
              disabled={busy !== null}
              onClick={markSent}
              className={processed ? primaryBtn : btn}
              title={`Sets status to Sent, sent via ${sentVia}`}
            >
              {busy === "sent" ? "Saving…" : "Mark as sent"}
            </button>
          )}
        </span>
      </div>

      {sentNote && <p className="text-xs text-[var(--rf-green-600)]">{sentNote}</p>}

      {/* The compose dialog: what you see is exactly what sends. Floats over
          the PO like the Generate POs confirm — same overlay pattern. */}
      {compose && (
        <Dialog
          title={`Email ${order.po_number}`}
          ariaLabel={`Email purchase order ${order.po_number}`}
          onClose={closeCompose}
          busy={busy !== null}
          width="max-w-5xl"
          top="pt-[6vh]"
          bodyClassName="grid gap-4 p-6 md:grid-cols-2"
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
                <span className="text-xs uppercase tracking-[0.12em] text-subtle">
                  {label}
                </span>
                {/* Clearable: these arrive PREFILLED from the org's templates,
                    so replacing one wholesale — a different recipient, a
                    subject written by hand — is the normal edit here. */}
                <TextInput
                  value={compose[field]}
                  disabled={busy !== null}
                  onValueChange={(next) => setCompose({ ...compose, [field]: next })}
                  clearLabel={`Clear ${label}`}
                  className="w-full py-1"
                />
              </label>
            ))}
            <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">
              Body
            </span>
            <textarea
              value={compose.body}
              rows={7}
              disabled={busy !== null}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              className="border border-ink bg-white px-2 py-1 outline-none focus:border-2"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-subtle">
              Attached: {attachment?.filename} — the document shown here is what
              sends
            </span>
            <span className="ml-auto flex items-center gap-3">
              <button
                disabled={busy !== null}
                onClick={closeCompose}
                className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted hover:text-ink disabled:opacity-35"
              >
                Cancel
              </button>
              <button
                disabled={busy !== null}
                onClick={useMailApp}
                className={btn}
                title="Hand this email to your mail app instead (attachment via the share sheet where supported)"
              >
                {busy === "mailapp" ? "Rendering…" : "Use Mail app"}
              </button>
              <button
                disabled={busy !== null || !compose.to.trim()}
                onClick={send}
                className={primaryBtn}
                title={
                  compose.to.trim()
                    ? "Send now — the PO is marked sent automatically"
                    : "Add a recipient first"
                }
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </span>
          </div>

            {/* A send failure must surface INSIDE the dialog — the card's own
                error line would be hidden behind the overlay. */}
            {error && <p className="text-sm text-accent">{error}</p>}
            </div>

            {/* The attachment, as the vendor will see it. <object> (not an
                iframe) so a browser without an inline PDF viewer shows the
                fallback below instead of a blank pane. */}
            {attachment && (
              <object
                data={attachment.url}
                type="application/pdf"
                aria-label={`Preview of ${attachment.filename}`}
                className="h-[26rem] w-full border border-ink md:h-full md:min-h-[26rem]"
              >
                <div className="flex h-full items-center justify-center p-4 text-center text-xs text-subtle">
                  This browser can&apos;t preview PDFs inline — use the Preview
                  PDF button to open it in its own tab.
                </div>
              </object>
            )}
        </Dialog>
      )}

      {error && !compose && <p className="text-accent">{error}</p>}
    </div>
  );
}
