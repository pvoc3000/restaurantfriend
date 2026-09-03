"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceStatus } from "@/lib/invoices";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * The invoice's own footer — Close · Void · Approve, right-aligned, in the
 * page's own flow.
 *
 * WHY IT IS NOT AN ACTIONBAR: Mark had the black band removed from the
 * receiving screen on 2026-08-04 ("get rid of the black band at the bottom…
 * just two buttons"). Reintroducing one on a brand-new detail screen would be
 * reintroducing the thing he just took out.
 *
 * WHY APPROVE IS NOT BLACK: `DIALOG_COMMIT_CLASS` is "a commit inside a panel",
 * extended to the receiving screen because that screen produces ONE outcome and
 * its footer is a text-weight escape beside a commit. This screen isn't that —
 * what you came to do is edit the inline cells, and Void, Approve and Close are
 * a row of peers. CLAUDE.md names exactly this case as NOT the exception:
 * "every discrete button on it is peripheral by construction".
 *
 * WHY IT DOESN'T NAVIGATE ON SUCCESS: receiving's Finalize leaves because
 * finalizing ENDS the task and everything left on screen is for a delivery you
 * have declared done. Approving leaves you looking at a record you may still
 * want to read, so the state is the feedback — the button is replaced by who
 * approved it and when.
 */
export function InvoiceFooter({
  invoiceId,
  status,
  approvedAt,
  caveats,
  canApprove,
  canEdit,
  closeHref,
  supabase,
  onDone,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  approvedAt: string | null;
  /** What `approvalReadiness` found — named in the confirm, never blocking. */
  caveats: string[];
  canApprove: boolean;
  canEdit: boolean;
  closeHref: string;
  supabase: SupabaseClient;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setApproval(approved: boolean) {
    if (approved && caveats.length > 0) {
      const ok = (await confirmDialog({ ...splitConfirmMessage(`Approve this invoice for payment?\n\n` +
          caveats.map((c) => `• ${c}`).join("\n") +
          `\n\nApproving anyway is fine — it just records that you've said this ` +
          `bill is payable.`), confirmLabel: "Approve" }));
      if (!ok) return;
    }

    setBusy(approved ? "approve" : "unapprove");
    setError(null);

    // The RPC, not an update: RLS filters rows and "only a manager may set
    // approved_at" is a COLUMN rule, so migration 025 names those columns in a
    // security definer function instead.
    const { data, error: rpcError } = await supabase.rpc(
      "set_vendor_invoice_approval",
      { p_invoice: invoiceId, p_approved: approved }
    );
    setBusy(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    // ROW COUNT, not the absence of an error. The function returns no rows when
    // it refuses — wrong role, wrong org, a voided invoice — and PostgREST
    // reports that as a perfectly successful call. A cheerful false success
    // about money is the employee-delete lesson with more at stake.
    if (!Array.isArray(data) || data.length === 0) {
      setError(
        approved
          ? "That wasn't approved — a voided invoice can't be, and approving needs a manager."
          : "That wasn't changed — approval can only be withdrawn by a manager."
      );
      return;
    }
    onDone();
  }

  async function setStatus(next: "void" | "open") {
    if (
      next === "void" &&
      !(await confirmDialog({ ...splitConfirmMessage("Void this invoice?\n\nIt stays on file and stops counting toward what " +
          "you owe. A voided invoice can't be approved until it's reopened."), confirmLabel: "Void", tone: "danger" }))
    ) {
      return;
    }
    setBusy(next);
    setError(null);
    const { data, error: updateError } = await supabase
      .from("vendor_invoices")
      .update({ status: next })
      .eq("id", invoiceId)
      .select("id");
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("Nothing changed — you may not have permission to do that.");
      return;
    }
    onDone();
  }

  /**
   * Delete the invoice — for the one you filed by mistake, not for the one you
   * decided not to pay. That's Void, and the confirm says so.
   *
   * The order matters and it's 018's rule read backwards. `invoice_id` is
   * `on delete set null`, so a document that ALSO belongs to a purchase order
   * survives and simply stops naming this invoice — which is right; the
   * delivery's paperwork isn't the bookkeeping. A document that belongs ONLY to
   * this invoice would be orphaned instead, so it goes first: row, then object,
   * exactly the direction `useAttachmentActions.remove` uses and for the same
   * reason (an orphan object is invisible and harmless; a row pointing at a
   * missing file renders broken).
   */
  async function destroy() {
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Delete this invoice?\n\n` +
          `Its lines go with it. Any document filed only here is removed; a ` +
          `document that also belongs to a purchase order stays on that order.\n\n` +
          `This is for an invoice filed by mistake. To keep the record but stop ` +
          `it counting toward what you owe, use Void instead.\n\nThis cannot be undone.`), confirmLabel: "Delete", tone: "danger" }))
    ) {
      return;
    }
    setBusy("delete");
    setError(null);

    // Invoice-only documents: the rows first, then their objects.
    const { data: own } = await supabase
      .from("purchase_order_attachments")
      .select("id, storage_path")
      .eq("invoice_id", invoiceId)
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

    // `.select()` so a delete matching no policy can't report a cheerful
    // success and then navigate — the employee-delete lesson.
    const { data, error: deleteError } = await supabase
      .from("vendor_invoices")
      .delete()
      .eq("id", invoiceId)
      .select("id");
    setBusy(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("Nothing was deleted — you may not have permission to do that.");
      return;
    }
    router.push(closeHref);
  }

  const button =
    "h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

  // A FRAGMENT, NOT A WRAPPER (Mark, 2026-09-02: "put the send to quickbooks
  // button in the same div as the other action buttons so they are aligned").
  // Two components each owning a box could only ever sit BESIDE each other;
  // returning loose children lets the caller's one flex row hold every button,
  // and `basis-full` drops the prose to its own line spanning them — the same
  // trick `OrderActions` uses for its refusal sentence.
  return (
    <>
      {error && <p className="order-last basis-full text-right text-sm text-accent">{error}</p>}
        {status === "approved" && (
          <span className="order-last basis-full text-right text-sm text-muted">
            Approved for payment
            {approvedAt ? ` on ${approvedAt.slice(0, 10)}` : ""}.
          </span>
        )}

        {/* NO CLOSE (Mark, 2026-09-02). It was the escape from a footer pinned
            to the foot of the page; with these commands level with the title
            the breadcrumb is directly above them and says where it goes. */}
        {canEdit && status !== "void" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setStatus("void")}
            className={DANGER_BUTTON_CLASS}
          >
            {busy === "void" ? "Voiding…" : "Void"}
          </button>
        )}
        {canEdit && status === "void" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setStatus("open")}
            className={button}
          >
            {busy === "open" ? "Reopening…" : "Reopen"}
          </button>
        )}

        {/* Approving is Manager and Owner only. Below that the control is
            absent rather than offering a write the function would refuse. */}
        {canEdit && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void destroy()}
            className={DANGER_BUTTON_CLASS}
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        )}

        {canApprove && status === "open" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setApproval(true)}
            className={button}
          >
            {busy === "approve" ? "Approving…" : "Approve for payment"}
          </button>
        )}
        {canApprove && status === "approved" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void setApproval(false)}
            className={button}
          >
            {busy === "unapprove" ? "Withdrawing…" : "Withdraw approval"}
          </button>
        )}
    </>
  );
}
