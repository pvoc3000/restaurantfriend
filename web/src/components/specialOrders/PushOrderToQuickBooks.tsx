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
  type AccountingRef,
  type InvoiceOrder,
} from "@/lib/quickbooks";

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
    const { data, message } = await invokeQbo(supabase, {
      mode: "push_invoice",
      order_id: orderId,
      payload: body,
      our_tax: totals.tax,
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    // The tax sentence is composed HERE, from the figure QuickBooks returned,
    // by the same fixture-tested rule the fixtures cover — `qbo-sync` had its
    // own copy until 2026-09-02 and that copy was the one running. Its
    // `warnings` now carry only what the server alone can see, so the two are
    // concatenated rather than one replacing the other.
    const theirs = taxDisagreement(totals.tax, data?.tax as number | undefined);
    setWarnings([...((data?.warnings as string[]) ?? []), ...(theirs ? [theirs] : [])]);
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
