"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  billPushRefusals,
  buildBillPayload,
  expenseAccountFor,
  pushedLabel,
  qboVendorId,
  splitAccountName,
  type AccountingRef,
  type BillInvoice,
} from "@/lib/quickbooks";

/**
 * Sending one approved invoice to QuickBooks.
 *
 * THE PAYLOAD IS BUILT HERE, by the pure `lib/quickbooks`, and `qbo-sync`
 * validates it against the invoice it names before posting. That split is
 * `freeze_pay_period`'s: the rule — a credit is a VendorCredit with a positive
 * amount, an update carries Id and SyncToken — lives once, in a module the
 * fixtures can reach, rather than in a Deno twin drifting from it.
 *
 * IT FETCHES ITS OWN CONTEXT rather than taking it as props. Both things it
 * needs are small reads that only matter when this block renders, and the
 * server view would otherwise carry two more queries on every invoice whether
 * or not QuickBooks is connected. `VendorAccounting` does the same.
 */

type Ctx = {
  connected: boolean;
  orgAccount: { ref: string | null; name: string | null } | null;
  vendorName: string;
  vendorRef: string | null;
  vendorAccount: { expense_account_ref: string | null; expense_account_name: string | null };
  invoiceRef: AccountingRef | null;
};

export function PushToQuickBooks({
  invoiceId,
  vendorId,
  orgId,
  status,
  total,
  isCredit,
  invoiceNumber,
  invoiceDate,
  dueDate,
  canPush,
  supabase,
  onDone,
}: {
  invoiceId: string;
  vendorId: string;
  orgId: string;
  status: "open" | "approved" | "void";
  total: number | null;
  isCredit: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  /** purchaser+, matching what `record_accounting_push` will accept. */
  canPush: boolean;
  supabase: SupabaseClient;
  onDone: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const readContext = useCallback(async (): Promise<Ctx> => {
    const [conn, vendor, invoice] = await Promise.all([
      supabase.rpc("accounting_connection_status", { p_org: orgId }),
      supabase
        .from("vendors")
        .select("name, external_ref, expense_account_ref, expense_account_name")
        .eq("id", vendorId)
        .maybeSingle(),
      supabase.from("vendor_invoices").select("external_ref").eq("id", invoiceId).maybeSingle(),
    ]);

    const row = Array.isArray(conn.data)
      ? (conn.data[0] as
          | { status?: string; bill_expense_account_ref?: string | null; bill_expense_account_name?: string | null }
          | undefined)
      : undefined;

    return {
      connected: row?.status === "connected",
      orgAccount: row
        ? { ref: row.bill_expense_account_ref ?? null, name: row.bill_expense_account_name ?? null }
        : null,
      vendorName: (vendor.data?.name as string) ?? "this vendor",
      vendorRef: qboVendorId((vendor.data?.external_ref ?? null) as AccountingRef | null),
      vendorAccount: {
        expense_account_ref: (vendor.data?.expense_account_ref as string | null) ?? null,
        expense_account_name: (vendor.data?.expense_account_name as string | null) ?? null,
      },
      invoiceRef: (invoice.data?.external_ref ?? null) as AccountingRef | null,
    };
  }, [supabase, orgId, vendorId, invoiceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await readContext();
      if (!cancelled) setCtx(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [readContext]);

  // Nothing at all until QuickBooks is connected: an invoice screen is not the
  // place to advertise a feature nobody has set up.
  if (!ctx || !ctx.connected) return null;

  const account = expenseAccountFor(ctx.vendorAccount, ctx.orgAccount);
  const billInvoice: BillInvoice = {
    id: invoiceId,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    total,
    is_credit: isCredit,
    status,
    external_ref: ctx.invoiceRef,
  };
  const refusals = billPushRefusals({
    invoice: billInvoice,
    vendorRef: ctx.vendorRef,
    vendorName: ctx.vendorName,
    accountRef: account?.ref ?? null,
  });
  const already = pushedLabel(ctx.invoiceRef);

  async function push() {
    const { entity, body: payload } = buildBillPayload({
      invoice: billInvoice,
      vendorRef: ctx!.vendorRef,
      vendorName: ctx!.vendorName,
      accountRef: account!.ref,
    });

    const where = splitAccountName(account!.name).leaf || account!.ref;
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `${already ? "Update" : "Send"} this ${isCredit ? "credit" : "bill"} in QuickBooks?\n\n` +
          `${ctx!.vendorName} · ${invoiceNumber ?? "no number"} · $${Number(total).toFixed(2)}\n` +
          `Posts to ${where}${account!.source === "org" ? " (the org default)" : ""}.`
      ),
      confirmLabel: already ? "Update" : "Send",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    const { data, message } = await invokeQbo(supabase, {
      mode: "push_bill",
      invoice_id: invoiceId,
      entity,
      payload,
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setSent(
      `${data?.updated ? "Updated" : "Sent"} as ${entity} ${
        (data?.doc_number as string) ?? (data?.qbo_id as string)
      }`
    );
    setCtx(await readContext());
    onDone();
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        {canPush && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy || refusals.length > 0}
            onClick={() => void push()}
          >
            {busy
              ? "Sending…"
              : already
                ? "Update in QuickBooks"
                : `Send to QuickBooks`}
          </button>
        )}
        {already && <span className="text-[13px] text-muted">{already}</span>}
      </div>

      {/* Why the button is off, in words. A disabled control explains itself
          only on hover, and the iPad has none. */}
      {canPush && refusals.length > 0 && (
        <p className="text-[13px] text-muted">{refusals[0]}</p>
      )}
      {!refusals.length && account && !already && (
        <p className="text-[13px] text-faint">
          Posts to {splitAccountName(account.name).leaf || account.ref}
          {account.source === "org" ? " (the org default)" : ""}.
        </p>
      )}
      {sent && <p className="text-[13px] text-muted">{sent}</p>}
      {error && <p className="text-[13px] text-accent">{error}</p>}
    </div>
  );
}
