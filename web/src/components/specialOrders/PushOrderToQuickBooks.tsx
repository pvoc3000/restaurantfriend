"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  buildInvoicePayload,
  invoicePushRefusals,
  invoiceSplit,
  pushedLabel,
  qboVendorId,
  taxDisagreement,
  attachableMetadata,
  attachableFromResponse,
  recordedAttachments,
  withAttachments,
  INVOICE_SHEET_KEY,
  type AccountingRef,
  type InvoiceOrder,
} from "@/lib/quickbooks";
import { documentFileName } from "@/lib/specialOrderDocs";
import { renderOrderDocument, blobToBase64 } from "./renderOrderDocument";

/**
 * Sending one special order to QuickBooks as an Invoice.
 *
 * `PushToQuickBooks`' sibling, and the same split: the payload is built by the
 * pure `lib/quickbooks` and `qbo-sync` validates the claims that could point
 * money somewhere else — the customer, the stage, the statement rule.
 *
 * WHAT IT CANNOT VALIDATE IS THE AMOUNT, and that is decision 6 rather than an
 * oversight: `special_orders` has no stored total, every figure being derived
 * from the lines by `orderTotals`, so checking it server-side would mean a
 * second copy of that arithmetic. The trust boundary is unchanged — anyone who
 * can push can already edit the lines.
 */

type Totals = {
  subtotal: number;
  taxableSubtotal: number;
  discount: number;
  deliveryCharge: number;
  rushFee: number;
  tax: number;
  total: number;
};

export function PushOrderToQuickBooks({
  orderId,
  orgId,
  number,
  kind,
  status,
  ignoreBalance,
  invoiceDate,
  today,
  customerId,
  customerName,
  totals,
  canWrite,
}: {
  orderId: string;
  orgId: string;
  number: string | null;
  kind: string;
  status: string | null;
  ignoreBalance: boolean;
  /** `date_initiated` — when the order was written. Not the event date. */
  invoiceDate: string | null;
  /** The org's own calendar day, for the rendered sheet's file name. */
  today: string;
  customerId: string | null;
  customerName: string;
  totals: Totals;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const [ctx, setCtx] = useState<{
    connected: boolean;
    itemRef: string | null;
    taxCodeRef: string | null;
    customerRef: string | null;
    orderRef: AccountingRef | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const read = useCallback(async () => {
    const [conn, customer, order] = await Promise.all([
      supabase.rpc("accounting_connection_status", { p_org: orgId }),
      customerId
        ? supabase.from("customers").select("external_ref").eq("id", customerId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("special_orders").select("external_ref").eq("id", orderId).maybeSingle(),
    ]);
    const row = Array.isArray(conn.data)
      ? (conn.data[0] as
          | { status?: string; invoice_item_ref?: string | null; tax_code_ref?: string | null }
          | undefined)
      : undefined;
    return {
      connected: row?.status === "connected",
      itemRef: row?.invoice_item_ref ?? null,
      taxCodeRef: row?.tax_code_ref ?? null,
      customerRef: qboVendorId((customer?.data?.external_ref ?? null) as AccountingRef | null),
      orderRef: (order.data?.external_ref ?? null) as AccountingRef | null,
    };
  }, [supabase, orgId, customerId, orderId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await read();
      if (!cancelled) setCtx(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [read]);

  // Nothing at all until QuickBooks is connected — an order screen is not the
  // place to advertise a feature nobody has set up.
  if (!ctx || !ctx.connected) return null;

  const split = invoiceSplit(totals);
  const order: InvoiceOrder = {
    id: orderId,
    number,
    invoice_date: invoiceDate,
    due_date: null,
    kind,
    status,
    ignore_balance: ignoreBalance,
    external_ref: ctx.orderRef,
  };
  const inputs = {
    order,
    customerRef: ctx.customerRef,
    customerName,
    itemRef: ctx.itemRef,
    taxCodeRef: ctx.taxCodeRef,
    total: totals.total,
    tax: totals.tax,
    ...split,
  };
  const refusals = invoicePushRefusals(inputs);
  const already = pushedLabel(ctx.orderRef);
  /** The document id, when there is one — a placeholder for the metadata the
   *  server overwrites anyway, and on a first push there is nothing yet. */
  const qboRefId = ctx.orderRef?.qbo?.id ?? null;
  /** The sheet already on this invoice, which a re-push replaces rather than
   *  adds to: it was rendered from figures that have since moved. */
  const previousSheet = recordedAttachments(ctx.orderRef)[INVOICE_SHEET_KEY] ?? null;

  async function push() {
    const { body } = buildInvoicePayload(inputs);
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `${already ? "Update" : "Send"} this invoice in QuickBooks?\n\n` +
          `${customerName} · ${number ?? "no number"} · $${totals.total.toFixed(2)}\n` +
          `QuickBooks works out the sales tax itself, and says so if its figure ` +
          `differs from the $${totals.tax.toFixed(2)} on the customer's copy.`
      ),
      confirmLabel: already ? "Update" : "Send",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    setWarnings([]);

    // THE CUSTOMER'S OWN INVOICE SHEET, off the same renderer that produces the
    // copy they were emailed (Mark, 2026-09-02). Rendered NOW rather than
    // reusing a filed one, so the paper on the QuickBooks invoice states the
    // figures that invoice was just given — a previously emailed copy can
    // legitimately show different ones, and hanging that off this transaction
    // would be two documents disagreeing in the same place.
    //
    // A RENDER FAILURE MUST NOT STOP THE PUSH. Getting the money into the books
    // is the point; the paperwork is worth a sentence if it does not follow.
    const localWarnings: string[] = [];
    let sheet: { key: string; file_name: string; content_type: string; metadata: unknown; pdf_base64: string } | undefined;
    try {
      const { blob, order: rendered } = await renderOrderDocument(supabase, orderId, "invoice", today);
      // NAMED OFF THE RENDERED ORDER, exactly as `SendDocument` names the copy
      // it emails — `event_date ?? today`. Naming it from a prop here produced
      // the same document under two names, one dated the event and one dated
      // whenever it was sent to QuickBooks.
      const fileName = documentFileName("invoice", rendered.number, rendered.event_date ?? today);
      sheet = {
        key: INVOICE_SHEET_KEY,
        file_name: fileName,
        content_type: "application/pdf",
        // The entity ref is overwritten server-side with the invoice it really
        // created — this composes the shape and `IncludeOnSend: false`.
        metadata: attachableMetadata({
          entity: "Invoice",
          entityId: qboRefId ?? "0",
          fileName,
          contentType: "application/pdf",
        }),
        pdf_base64: await blobToBase64(blob),
      };
    } catch {
      localWarnings.push("The invoice sheet could not be rendered, so nothing was attached in QuickBooks.");
    }

    const { data, message } = await invokeQbo(supabase, {
      mode: "push_invoice",
      order_id: orderId,
      payload: body,
      our_tax: totals.tax,
      ...(sheet ? { attachments: [sheet] } : {}),
      ...(previousSheet ? { replace_attachable_id: previousSheet } : {}),
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }

    // What QuickBooks said about the file, read by the pure rule: a refusal
    // arrives as HTTP 200 with a Fault inside, so the status told us nothing.
    const added: Record<string, string> = {};
    for (const r of (data?.attachment_results as { key: string; response?: unknown; error?: string }[]) ?? []) {
      if (r.error) { localWarnings.push(r.error); continue; }
      const read = attachableFromResponse(r.response);
      if (read.ok) added[r.key] = read.id;
      else localWarnings.push(`The invoice sheet was not attached: ${read.message}`);
    }
    if (Object.keys(added).length > 0) {
      // THE REF THE SERVER RECORDED, added to — never rebuilt from parts, which
      // is how this dropped the sync token entirely for a day: `push_invoice`
      // did not return one, and a ref with no token is not an update, it is a
      // CREATE. Its token is the one AFTER the delete-and-replace, both of
      // which bump the invoice's own.
      const ref = withAttachments(data!.ref as AccountingRef, added);
      // Its own write, because the id only exists after the upload. A failure
      // here costs one duplicated attachment on the next push, never the money.
      const { error: refErr } = await supabase
        .from("special_orders")
        .update({ external_ref: ref })
        .eq("id", orderId)
        .select("id");
      if (refErr) localWarnings.push("The attachment went up but was not recorded, so pushing again would attach a second copy.");
    }
    // The tax sentence is composed HERE, from the figure QuickBooks returned,
    // by the same fixture-tested rule the fixtures cover — `qbo-sync` had its
    // own copy until 2026-09-02 and that copy was the one running. Its
    // `warnings` now carry only what the server alone can see, so the two are
    // concatenated rather than one replacing the other.
    const theirs = taxDisagreement(totals.tax, data?.tax as number | undefined);
    setWarnings([
      ...((data?.warnings as string[]) ?? []),
      ...(theirs ? [theirs] : []),
      ...localWarnings,
    ]);
    setSent(
      `${data?.updated ? "Updated" : "Sent"} as Invoice ${
        (data?.doc_number as string) ?? (data?.qbo_id as string)
      } · QuickBooks total $${Number(data?.total ?? 0).toFixed(2)}`
    );
    // Re-reads its own context rather than refreshing the page: the record is a
    // server component, and the only thing this changed — `external_ref` — is
    // read by nothing else on the screen.
    setCtx(await read());
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        {canWrite && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy || refusals.length > 0}
            onClick={() => void push()}
          >
            {busy ? "Sending…" : already ? "Update in QuickBooks" : "Send to QuickBooks"}
          </button>
        )}
        {already && <span className="text-[13px] text-muted">{already}</span>}
      </div>
      {/* Why the button is off, in words — a disabled control explains itself
          only on hover, and the iPad has none. */}
      {canWrite && refusals.length > 0 && (
        <p className="max-w-2xl text-[13px] text-muted">{refusals[0]}</p>
      )}
      {sent && <p className="text-[13px] text-muted">{sent}</p>}
      {/* The invoice IS in QuickBooks — this is its tax disagreeing with ours,
          which is the accepted cost of letting it compute. Yellow, not red. */}
      {warnings.map((w) => (
        <p key={w} className="max-w-2xl bg-mark-fill px-2 py-1 text-[13px] text-ink">
          {w}
        </p>
      ))}
      {error && <p className="max-w-2xl text-[13px] text-accent">{error}</p>}
    </div>
  );
}
