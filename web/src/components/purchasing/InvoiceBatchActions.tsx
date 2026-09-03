"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { money } from "@/lib/purchaseOrders";
import type { InvoiceListRow } from "@/app/(app)/invoices/page";

/**
 * What you can do to a handful of invoices at once.
 *
 * Both commands already exist for ONE invoice on `InvoiceFooter`, and this is
 * deliberately the same logic rather than a second implementation — the row
 * count check on the approval RPC, and the document order on the delete, are
 * each a lesson this module paid for once.
 *
 * WHAT IT REFUSES TO DO SILENTLY is the whole design. A selection is a mixed
 * bag: some already approved, some voided, some carrying paperwork, some
 * already in QuickBooks. Every command says what it will SKIP before it runs,
 * and reports what actually happened rather than what was asked for.
 */
export function InvoiceBatchActions({
  selected,
  canEdit,
  canApprove,
  onReport,
}: {
  selected: InvoiceListRow[];
  /** purchaser+, matching what 025's delete policy allows. */
  canEdit: boolean;
  /** Manager and Owner only — the module's own decision, and what
   *  `set_vendor_invoice_approval` enforces regardless of what is on screen. */
  canApprove: boolean;
  /**
   * Hand the outcome UP and clear the selection.
   *
   * IT CANNOT REPORT FOR ITSELF. Clearing the selection unmounts the bar this
   * lives in, so a `done` message set here is destroyed the instant it is set —
   * which is exactly what happened on the first real bulk approve: two invoices
   * were approved, correctly, and the screen said nothing at all. The report
   * has to outlive the thing that produced it.
   */
  onReport: (message: string, tone: "done" | "error") => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "delete" | null>(null);

  // Only an OPEN invoice can be approved: an approved one is already there and
  // a voided one is refused by the function anyway. Naming the skipped ones in
  // the confirm is what stops "Approve 8" quietly meaning five.
  const approvable = selected.filter((i) => i.status === "open");
  const alreadyApproved = selected.filter((i) => i.status === "approved").length;
  const voided = selected.filter((i) => i.status === "void").length;
  const approvableTotal = approvable.reduce((sum, i) => sum + Number(i.total ?? 0), 0);

  async function approve() {
    const skipped = [
      alreadyApproved ? `${alreadyApproved} already approved` : null,
      voided ? `${voided} voided` : null,
    ].filter(Boolean);
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Approve ${approvable.length} invoice${approvable.length === 1 ? "" : "s"} for payment?\n\n` +
          `${money(approvableTotal)} in total.` +
          (skipped.length ? `\n\n${skipped.join(" and ")} — those are left alone.` : "")
      ),
      confirmLabel: "Approve",
    });
    if (!ok) return;

    setBusy("approve");
    let approved = 0;
    const refused: string[] = [];
    for (const invoice of approvable) {
      // THE RPC, NEVER AN UPDATE. RLS filters rows and "only a manager may set
      // approved_at" is a COLUMN rule, so 025 names those columns in a definer.
      const { data, error: rpcError } = await supabase.rpc("set_vendor_invoice_approval", {
        p_invoice: invoice.id,
        p_approved: true,
      });
      // ROW COUNT, not the absence of an error: the function returns NO ROWS
      // when it refuses — wrong role, wrong org, a voided invoice — and
      // PostgREST reports that as a perfectly successful call. A cheerful false
      // success about money is the employee-delete lesson with more at stake,
      // and in a loop it would be that lesson eight times over.
      if (rpcError || !Array.isArray(data) || data.length === 0) {
        refused.push(invoice.invoice_number ?? "no number");
      } else {
        approved++;
      }
    }
    setBusy(null);
    if (refused.length > 0) {
      onReport(
        `Approved ${approved} of ${approvable.length}. ${refused.length} refused ` +
          `(${refused.slice(0, 4).join(", ")}${refused.length > 4 ? ", …" : ""}) — ` +
          `approving for payment needs a manager.`,
        "error"
      );
    } else {
      onReport(`Approved ${approved} invoice${approved === 1 ? "" : "s"} for payment.`, "done");
    }
    if (approved > 0) router.refresh();
  }

  async function destroy() {
    const approvedCount = selected.filter((i) => i.status === "approved").length;
    const linked = selected.filter((i) => i.qbo_linked).length;
    const files = selected.reduce((n, i) => n + i.document_count, 0);

    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Delete ${selected.length} invoice${selected.length === 1 ? "" : "s"} and their lines?\n\n` +
          (approvedCount
            ? `WARNING: ${approvedCount} of them ${approvedCount === 1 ? "is" : "are"} ` +
              `approved for payment. To keep the record but stop it counting toward what ` +
              `you owe, use Void instead.\n\n`
            : "") +
          (linked
            ? `${linked} ${linked === 1 ? "is" : "are"} linked to QuickBooks. The bill STAYS ` +
              `in QuickBooks — only the record here goes.\n\n`
            : "") +
          (files
            ? `Any of the ${files} document${files === 1 ? "" : "s"} filed only here is removed; ` +
              `one that also belongs to a purchase order stays on that order.\n\n`
            : "") +
          `This cannot be undone.`
      ),
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    setBusy("delete");
    const ids = selected.map((i) => i.id);

    // Invoice-ONLY documents: rows first, then their objects. 018's rule read
    // backwards — an orphan object is invisible and harmless, where a row
    // pointing at a missing file renders broken. A document that also belongs
    // to a purchase order is `on delete set null` and simply stops naming this
    // invoice, which is right: the delivery's paperwork is not the bookkeeping.
    const { data: own } = await supabase
      .from("purchase_order_attachments")
      .select("id, storage_path")
      .in("invoice_id", ids)
      .is("po_id", null);
    if (own && own.length > 0) {
      await supabase
        .from("purchase_order_attachments")
        .delete()
        .in("id", own.map((a) => a.id));
      await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .remove(own.map((a) => a.storage_path as string));
    }

    // `.select()` ON A DELETE: with no matching policy Postgres removes zero
    // rows and PostgREST returns NO error, so a bare delete reports a cheerful
    // success and everything is still there after the refresh.
    const { data, error: deleteError } = await supabase
      .from("vendor_invoices")
      .delete()
      .in("id", ids)
      .select("id");
    setBusy(null);
    if (deleteError) {
      onReport(deleteError.message, "error");
      return;
    }
    const removed = data?.length ?? 0;
    if (removed === 0) {
      onReport("Nothing was deleted — you may not have permission to do that.", "error");
      return;
    }
    // SAYS HOW MANY, not "done". A partial delete is the interesting outcome
    // and the only one a count can reveal.
    onReport(
      removed === ids.length
        ? `Deleted ${removed} invoice${removed === 1 ? "" : "s"}.`
        : `Deleted ${removed} of ${ids.length} — the rest were refused.`,
      removed === ids.length ? "done" : "error"
    );
    router.refresh();
  }

  return (
    <>
      {canApprove && approvable.length > 0 && (
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={busy !== null}
          onClick={() => void approve()}
        >
          {busy === "approve" ? "Approving…" : `Approve ${approvable.length}`}
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className={DANGER_BUTTON_CLASS}
          disabled={busy !== null}
          onClick={() => void destroy()}
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      )}
    </>
  );
}
