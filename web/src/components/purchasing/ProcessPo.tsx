"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog } from "@/components/ui/Dialog";
import { OrderBar } from "./OrderBar";
import {
  buildEmailParts,
  downloadBlob,
  fetchPoDocData,
  mailtoFromParts,
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
  statement,
  status,
  lineActions,
}: {
  order: PurchaseOrder;
  context: ProcessingContext;
  /**
   * The order's own three slots, handed in by PurchaseOrderDetail so all of it
   * lands in ONE box (Mark, 2026-08-02). They can't be composed the other way
   * round: every button below lives off this component's `busy` / `compose`
   * state, so whoever draws the frame has to be inside it. See OrderBar, which
   * is the frame both callers share.
   */
  statement?: React.ReactNode;
  status?: React.ReactNode;
  lineActions?: React.ReactNode;
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

  const btn =
    "h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";
  const primaryBtn =
    "h-9 bg-ink px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:bg-neutral-300";

  return (
    <>
      {/* `trailing` is just Status: the delivery date went back under Ordered
          in the dl (Mark, 2026-08-02) — the two dates read as a pair — and with
          it went this card's second editor for the same column and the
          "arrives …" chip that used to sit beside it. */}
      <OrderBar
        statement={
          <>
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
              Process · {context.order_type.replace("_", " ")}
            </span>
            {statement}
          </>
        }
        trailing={status}
        footer={
          <>
            {sentNote && (
              <p className="text-xs text-[var(--rf-green-600)]">{sentNote}</p>
            )}
            {error && !compose && <p className="text-accent">{error}</p>}
          </>
        }
        actions={
          <>
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
              {/* White like the rest of the row (Mark, 2026-08-02). It was the
                  black `primaryBtn`, marking it as the thing to press on an
                  online order — but in one combined box that put a filled cell
                  in the middle of a row of outlined ones, which reads as a
                  different KIND of control rather than as the important one.
                  The same argument the ActionBar settled in July. */}
              <button
                disabled={busy !== null || !context.vendor_url}
                onClick={openVendorSite}
                className={btn}
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

          {/* The order's own commands close the row: prepare and send first,
              then work the order, ending at Close — the terminal action, and
              so the one nearest the right edge. */}
          {lineActions}
          </>
        }
      />

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
    </>
  );
}
