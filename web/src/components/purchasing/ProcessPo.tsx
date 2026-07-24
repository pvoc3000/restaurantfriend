"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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

  /** Open the compose card prefilled from the templates — no PDF work yet. */
  const openCompose = () =>
    run("compose", async () => {
      const { org, pos } = await fetchPoDocData(supabase, [order.id]);
      if (pos.length === 0) throw new Error("Order not found");
      setSentNote(null);
      setCompose(buildEmailParts(pos[0], org));
    });

  /** The reviewed fields + the freshly rendered PDF → edge function → sent. */
  const send = () =>
    run("send", async () => {
      if (!compose) return;
      const { pdf, docs, org, po } = await loadDocs();
      const blob = await pdf(<docs.PoPdf pos={[po]} org={org} />).toBlob();
      const { warning } = await sendPoEmail(supabase, {
        po_id: order.id,
        parts: compose,
        blob,
        filename: `PO ${po.po_number}.pdf`,
      });
      setCompose(null);
      setSentNote(
        `Sent to ${compose.to}${warning ? ` — ${warning}` : ""}`
      );
      router.refresh();
    });

  /**
   * The escape hatch (e.g. Resend not configured yet): hand the EDITED fields
   * to the mail app — share sheet where files can be shared, else the PDF
   * downloads and a prefilled draft opens. Marking sent stays manual here.
   */
  const useMailApp = () =>
    run("mailapp", async () => {
      if (!compose) return;
      const { pdf, docs, org, po } = await loadDocs();
      const blob = await pdf(<docs.PoPdf pos={[po]} org={org} />).toBlob();
      const shared = await sharePdf(
        blob,
        `PO ${po.po_number}.pdf`,
        compose.subject,
        compose.body
      );
      if (shared === "cancelled") return;
      if (shared === "unsupported") {
        downloadBlob(blob, `PO ${po.po_number}.pdf`);
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
    "rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100 disabled:opacity-50";
  const primaryBtn =
    "rounded bg-neutral-900 px-3 py-1 font-medium text-white hover:bg-neutral-700 disabled:bg-neutral-400";

  return (
    <div className="space-y-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Process · {context.order_type.replace("_", " ")}
        </span>

        {/* Delivery date first: it prints on the document, so set it before
            generating. The suggestion is the vendor's next delivery day. */}
        <label className="flex items-center gap-1 text-neutral-600">
          Delivery
          <input
            type="date"
            value={order.delivery_date ?? ""}
            disabled={busy !== null}
            onChange={(e) => setDelivery(e.target.value || null)}
            className="rounded border border-neutral-300 px-1.5 py-0.5"
          />
        </label>
        {suggestion && (
          <button
            disabled={busy !== null}
            onClick={() => setDelivery(suggestion)}
            title="The vendor's next delivery day after the order date"
            className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 hover:bg-blue-100 disabled:opacity-50"
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

      {sentNote && <p className="text-xs text-green-800">{sentNote}</p>}

      {/* The compose card: what you see is exactly what sends. */}
      {compose && (
        <div className="space-y-2 rounded border border-neutral-200 bg-neutral-50 p-3">
          <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
            {(
              [
                ["To", "to"],
                ["Cc", "cc"],
                ["Subject", "subject"],
              ] as const
            ).map(([label, field]) => (
              <label key={field} className="contents">
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  {label}
                </span>
                <input
                  value={compose[field]}
                  disabled={busy !== null}
                  onChange={(e) => setCompose({ ...compose, [field]: e.target.value })}
                  className="rounded border border-neutral-300 bg-white px-2 py-1"
                />
              </label>
            ))}
            <span className="self-start pt-1 text-xs uppercase tracking-wide text-neutral-500">
              Body
            </span>
            <textarea
              value={compose.body}
              rows={7}
              disabled={busy !== null}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              className="rounded border border-neutral-300 bg-white px-2 py-1"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-neutral-500">
              📎 PO {order.po_number}.pdf — rendered fresh on send
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                disabled={busy !== null}
                onClick={() => setCompose(null)}
                className="text-neutral-600 hover:text-neutral-900"
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
        </div>
      )}

      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
