"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
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
  actionsBefore,
  actionsAfter,
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
  /** The action groups either side of this card's own — Add item before,
   *  Reconcile/Close after. See OrderBar for why the groups are separated. */
  actionsBefore?: React.ReactNode;
  actionsAfter?: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    });

  const openVendorSite = () =>
    run("online", async () => {
      if (context.vendor_url) window.open(context.vendor_url, "_blank");
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

  // ONE button shape. `primaryBtn` — the black fill — is gone (Mark,
  // 2026-08-02: "all buttons should be white. Only set filters are black"),
  // which finishes what Open vendor site started a few hours earlier: against a
  // row of outlined cells a filled one reads as a different KIND of control
  // rather than as the important one, the same conclusion the ActionBar reached
  // in July.
  const btn =
    "h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

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
        actionGroups={[
          actionsBefore,
          <>
          {/* PREVIEW PDF ON EVERY ORDER TYPE, including in_person (Mark,
              2026-08-02: it "should always be available even when it's a
              shopping list"). It used to be per-branch and the in_person branch
              omitted it, on the reasoning that a shopping list is the document
              you want when you're the one buying. But the §4.9 vendor document
              is what says what was ORDERED, and wanting to read that has
              nothing to do with how the order gets placed. Unconditional here
              rather than repeated in each branch — it was already written out
              three times. */}
          <button disabled={busy !== null} onClick={previewPdf} className={btn}>
            {busy === "preview" ? "Rendering…" : "Preview PDF"}
          </button>

          {context.order_type === "email_po" && compose === null && (
            <button
              disabled={busy !== null}
              onClick={openCompose}
              className={btn}
              title="Compose here — the PDF attaches itself on send"
            >
              {busy === "compose" ? "Loading…" : "Email PO…"}
            </button>
          )}

          {context.order_type === "online" && (
            <button
              disabled={busy !== null || !context.vendor_url}
              onClick={openVendorSite}
              className={btn}
              title={context.vendor_url ?? "No URL on the vendor record"}
            >
              Open vendor site
            </button>
          )}

          {context.order_type === "in_person" && (
            <button disabled={busy !== null} onClick={shoppingList} className={btn}>
              {busy === "shopping" ? "Rendering…" : "Shopping list PDF"}
            </button>
          )}

          {order.status === "draft" && (
            <button
              disabled={busy !== null}
              onClick={markSent}
              className={btn}
              title={`Sets status to Sent, sent via ${sentVia}`}
            >
              {busy === "sent" ? "Saving…" : "Mark as sent"}
            </button>
          )}

          </>,
          actionsAfter,
        ]}
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
          // A DEFINITE height, not the default cap (Mark, 2026-08-03: "make
          // that panel bigger… at least 1.5x taller"). It used to shrink-wrap
          // its content, which meant the 26rem floor on the preview WAS the
          // panel: measured 512px tall in a 720px window, well under the 85vh
          // it was allowed. Giving the panel a real height and stretching the
          // grid row (below) lets the preview take everything that's left, so
          // the document you are about to send is the biggest thing on screen.
          top="pt-[4vh]"
          height="h-[88vh]"
          // md:grid-rows-1 is what makes `h-full` on the preview mean anything:
          // an implicit grid row is content-sized, so the pane was falling back
          // to its own min-height no matter how tall the panel got.
          bodyClassName="grid min-h-0 gap-4 p-6 md:grid-cols-2 md:grid-rows-1"
          footer={
            <>
              <span className="mr-auto text-xs text-subtle">
                Attached: {attachment?.filename} — the document shown here is
                what sends
              </span>
              <button
                disabled={busy !== null}
                onClick={closeCompose}
                className={DIALOG_CANCEL_CLASS}
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
              {/* BLACK, and this is the endorsed exception rather than a
                  departure (Mark, 2026-08-03). The 2026-08-02 sweep turned
                  every button white because a filled cell in a ROW OF PEERS
                  reads as a different kind of control — but a panel exists to
                  produce ONE outcome, so its footer is a two-weight decision: a
                  text Cancel beside the commit. The sweep caught this button
                  along with the card's, and the card's was right to change. */}
              <button
                disabled={busy !== null || !compose.to.trim()}
                onClick={send}
                className={DIALOG_COMMIT_CLASS}
                title={
                  compose.to.trim()
                    ? "Send now — the PO is marked sent automatically"
                    : "Add a recipient first"
                }
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
                  className="w-full"
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
