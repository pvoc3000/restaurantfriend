"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { money } from "@/lib/purchaseOrders";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  billPushRefusals,
  buildBillPayload,
  expenseAccountFor,
  pushedLabel,
  qboTrackingFor,
  qboVendorId,
  splitAccountName,
  attachableMetadata,
  attachableFromResponse,
  attachmentRefusal,
  attachmentsToSend,
  withAttachments,
  type AccountingRef,
  type BillInvoice,
  type VendorLocationAccounting,
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
  /** 083's row for THIS invoice's shop. Null when nobody has configured the
   *  vendor there — or when the migration is not applied yet. */
  atShop: VendorLocationAccounting | null;
  schemaError: string | null;
  invoiceRef: AccountingRef | null;
  /** What is filed on this bill. The `invoice` ones go up with it (Mark,
   *  2026-09-02) — a two-page scan is two rows and QuickBooks should get both. */
  documents: { id: string; kind: string | null; file_name: string | null; content_type: string | null; storage_path: string }[];
};

export function PushToQuickBooks({
  invoiceId,
  vendorId,
  locationId,
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
  /** The invoice's own shop — `vendor_invoices.location_id`, NOT NULL. */
  locationId: string;
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
  const [warnings, setWarnings] = useState<string[]>([]);
  /** What QuickBooks says is still owed. HELD IN STATE AND NEVER STORED — see
   *  `refresh_status`. It disappears on reload, which is honest: a balance kept
   *  in our row would be stale the moment it landed and shown as if current. */
  const [balance, setBalance] = useState<{ text: string; at: string } | null>(null);

  const readContext = useCallback(async (): Promise<Ctx> => {
    const [conn, vendor, invoice, atShop, docs] = await Promise.all([
      supabase.rpc("accounting_connection_status", { p_org: orgId }),
      supabase.from("vendors").select("name").eq("id", vendorId).maybeSingle(),
      supabase.from("vendor_invoices").select("external_ref").eq("id", invoiceId).maybeSingle(),
      // Separate and allowed to fail: these columns arrive with 083, and
      // folding them into a query the rest of the block depends on would take
      // the whole thing down until it is applied.
      supabase
        .from("vendor_locations")
        .select(
          "external_ref, expense_account_ref, expense_account_name, qbo_location_ref, qbo_location_name, qbo_class_ref, qbo_class_name"
        )
        .eq("vendor_id", vendorId)
        .eq("location_id", locationId)
        .maybeSingle(),
      supabase
        .from("purchase_order_attachments")
        .select("id, kind, file_name, content_type, storage_path")
        .eq("invoice_id", invoiceId),
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
      atShop: (atShop.data ?? null) as VendorLocationAccounting | null,
      schemaError: atShop.error?.message ?? null,
      invoiceRef: (invoice.data?.external_ref ?? null) as AccountingRef | null,
      documents: (docs.data ?? []) as Ctx["documents"],
    };
  }, [supabase, orgId, vendorId, locationId, invoiceId]);

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

  const account = expenseAccountFor(ctx.atShop, ctx.orgAccount);
  // The mapping is the SHOP's now, not the vendor's — 026's column, finally read.
  const vendorRef = qboVendorId(ctx.atShop?.external_ref ?? null);
  const tracking = qboTrackingFor(ctx.atShop);
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
    vendorRef,
    vendorName: ctx.vendorName,
    accountRef: account?.ref ?? null,
  });
  const already = pushedLabel(ctx.invoiceRef);
  /** A placeholder for the metadata's entity ref, which the server overwrites
   *  with the document it actually wrote — on a first push there is none. */
  const qboRefId = ctx.invoiceRef?.qbo?.id ?? null;

  async function checkBalance() {
    setBusy(true);
    setError(null);
    const { data, message } = await invokeQbo(supabase, {
      mode: "refresh_status",
      invoice_ids: [invoiceId],
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    const st = ((data?.statuses as Record<string, unknown>[]) ?? [])[0];
    if (!st) return;
    const at = new Date(data!.checked_at as string).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    // Missing is its own answer: a document deleted or voided in QuickBooks
    // must not read as paid in full.
    if (st.missing) {
      setBalance({ text: "no longer in QuickBooks", at });
      return;
    }
    const owed = Number(st.balance);
    setBalance({
      text: st.settled
        ? st.entity === "VendorCredit"
          ? "fully applied in QuickBooks"
          : "paid in QuickBooks"
        : `${money(owed)} still owed`,
      at,
    });
  }

  async function push() {
    const { entity, body: payload } = buildBillPayload({
      invoice: billInvoice,
      vendorRef,
      vendorName: ctx!.vendorName,
      accountRef: account!.ref,
      department: tracking.location,
      klass: tracking.klass,
    });

    const where = splitAccountName(account!.name).leaf || account!.ref;
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `${already ? "Update" : "Send"} this ${isCredit ? "credit" : "bill"} in QuickBooks?\n\n` +
          `${ctx!.vendorName} · ${invoiceNumber ?? "no number"} · $${Number(total).toFixed(2)}\n` +
          `Posts to ${where}${account!.source === "org" ? " (the org default)" : ""}` +
          `${tracking.location ? `\nLocation: ${tracking.location.name ?? tracking.location.ref}` : ""}` +
          `${tracking.klass ? `\nClass: ${tracking.klass.name ?? tracking.klass.ref}` : ""}`
      ),
      confirmLabel: already ? "Update" : "Send",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    setWarnings([]);

    // THE SCAN GOES WITH THE BILL (Mark, 2026-09-02). Only what is filed as an
    // `invoice`, and only what is not already up there: a second upload of the
    // same file makes a SECOND attachment — QuickBooks has no upsert, measured.
    const localWarnings: string[] = [];
    const files = attachmentsToSend(ctx!.documents, ctx!.invoiceRef)
      .filter((d) => {
        const no = attachmentRefusal(d.content_type, d.file_name);
        if (no) localWarnings.push(no);
        return !no;
      })
      .map((d) => ({
        key: d.id,
        file_name: d.file_name ?? "invoice.pdf",
        content_type: d.content_type ?? "application/pdf",
        storage_path: d.storage_path,
        // The server overwrites the entity ref with the bill it really wrote;
        // this composes the shape and `IncludeOnSend: false`.
        metadata: attachableMetadata({
          entity,
          entityId: qboRefId ?? "0",
          fileName: d.file_name ?? "invoice.pdf",
          contentType: d.content_type ?? "application/pdf",
        }),
      }));

    const { data, message } = await invokeQbo(supabase, {
      mode: "push_bill",
      invoice_id: invoiceId,
      entity,
      payload,
      ...(files.length ? { attachments: files } : {}),
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }

    // A refusal arrives as HTTP 200 with a Fault inside the item, so the status
    // said nothing — the pure rule reads it.
    const added: Record<string, string> = {};
    for (const r of (data?.attachment_results as { key: string; response?: unknown; error?: string }[]) ?? []) {
      if (r.error) { localWarnings.push(r.error); continue; }
      const read = attachableFromResponse(r.response);
      if (read.ok) added[r.key] = read.id;
      else localWarnings.push(`The invoice scan was not attached: ${read.message}`);
    }
    if (Object.keys(added).length > 0) {
      // Recorded through 081's definer, like the push itself — `external_ref`
      // is writable straight through PostgREST otherwise, which is the whole
      // reason that function exists. Its merge replaces the `qbo` branch whole,
      // so the full branch goes back.
      // THE REF THE SERVER RECORDED, added to — never rebuilt from parts. Its
      // `sync_token` is the one AFTER the attachment, because attaching a file
      // bumps the bill's own token and the push response predates that.
      const ref = withAttachments(data!.ref as AccountingRef, added);
      const { data: rec, error: refErr } = await supabase.rpc("record_accounting_push", {
        p_invoice: invoiceId,
        p_ref: ref,
      });
      if (refErr || !Array.isArray(rec) || rec.length === 0) {
        localWarnings.push("The scan went up but was not recorded, so pushing again would attach a second copy.");
      }
    }

    setWarnings([...((data?.warnings as string[]) ?? []), ...localWarnings]);
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
        {already && (
          <button
            type="button"
            className="text-[13px] text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 disabled:opacity-35"
            disabled={busy}
            onClick={() => void checkBalance()}
          >
            {busy ? "Checking…" : "Check QuickBooks"}
          </button>
        )}
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
      {balance && (
        <p className="text-[13px] text-muted">
          {balance.text} <span className="text-faint">· as of {balance.at}</span>
        </p>
      )}
      {sent && <p className="text-[13px] text-muted">{sent}</p>}
      {/* The bill IS in QuickBooks — this is not an error. It is the coding
          QuickBooks accepted and then dropped, which it does with a 200 and no
          fault when the matching preference is off. Yellow: worth your eye,
          not something that went wrong. */}
      {warnings.map((w) => (
        <p key={w} className="max-w-2xl bg-mark-fill px-2 py-1 text-[13px] text-ink">
          {w}
        </p>
      ))}
      {error && <p className="text-[13px] text-accent">{error}</p>}
    </div>
  );
}
