"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  buildEmailParts,
  buildMailto,
  canSharePdf,
  downloadBlob,
  fetchPoDocData,
  nextDeliveryDate,
  openWindowNow,
  sharePdf,
  showBlob,
  SENT_VIA_FOR_ORDER_TYPE,
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
 * - email_po — generate the §4.9 PDF (lands in Downloads) AND open a prefilled
 *   mail draft; the human attaches the file and edits the text before sending
 *   (mailto can't attach — this two-step is the deliberate v1, Mark 2026-07-23).
 * - online   — open the vendor's site; the PDF is available as a reference.
 * - in_person — the shopping list PDF, sorted by shop section.
 * Every path ends at "Mark as sent", which records sent_via.
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
  const [copied, setCopied] = useState(false);
  // Share support is a client fact that never changes within a page life —
  // useSyncExternalStore reads it hydration-safely (an effect would trip the
  // set-state-in-effect lint; server snapshot false keeps SSR consistent).
  const shareable = useSyncExternalStore(
    () => () => {},
    canSharePdf,
    () => false
  );

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

  const generateAndDraft = () =>
    run("email", async () => {
      const { pdf, docs, org, po } = await loadDocs();
      const blob = await pdf(<docs.PoPdf pos={[po]} org={org} />).toBlob();

      // Share sheet first: the one path where the PDF lands INSIDE the Mail
      // compose window (macOS and iOS). Recipient/subject may still need the
      // copy chips — no web API can address a Mail draft.
      const parts = buildEmailParts(po, org);
      const shared = await sharePdf(
        blob,
        `PO ${po.po_number}.pdf`,
        parts.subject,
        parts.body
      );
      if (shared === "shared") {
        setProcessed(true);
        return;
      }
      if (shared === "cancelled") return;

      // No file sharing here (or the gesture expired): the original two-step —
      // PDF to Downloads, prefilled draft opens, human drags the file in.
      downloadBlob(blob, `PO ${po.po_number}.pdf`);
      window.location.href = buildMailto(po, org);
      setProcessed(true);
    });

  async function copyRep() {
    if (!context.rep_email) return;
    await navigator.clipboard.writeText(context.rep_email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
              <button
                disabled={busy !== null}
                onClick={generateAndDraft}
                className={primaryBtn}
                title={
                  shareable
                    ? "Opens the share sheet with the PDF attached — choose Mail"
                    : context.rep_email
                      ? `Draft to ${context.rep_email} — attach the downloaded PDF before sending`
                      : "No rep email on file — the draft opens without a recipient"
                }
              >
                {busy === "email" ? "Rendering…" : "Email PDF…"}
              </button>
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

      {context.order_type === "email_po" && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          {shareable ? (
            <>
              Opens the share sheet with the PDF attached — choose Mail, address
              it, edit, send, then mark the order sent.
            </>
          ) : (
            <>
              The PDF downloads and a mail draft opens
              {context.rep_email ? "" : " (no rep email on file)"} — attach the
              PDF and edit before sending, then mark the order sent.
            </>
          )}
          {context.rep_email && (
            <button
              type="button"
              onClick={copyRep}
              title="Copy the rep's email address"
              className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-neutral-700 hover:bg-neutral-100"
            >
              {copied ? "Copied" : `To: ${context.rep_email} ⧉`}
            </button>
          )}
        </p>
      )}

      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
