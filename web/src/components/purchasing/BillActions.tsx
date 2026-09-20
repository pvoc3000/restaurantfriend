"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillStatus } from "@/lib/bills";
import type { ReactNode } from "react";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * The bill's own commands — approve, void, delete — and, since 2026-09-12,
 * ROWS OF AN `ActionMenu` RATHER THAN BUTTONS (Mark: "move all the action
 * buttons into our new ActionMenu"). Pass `children` and this hands its rows
 * back in two named groups, keeping the writes, the row-count checks and every
 * confirm; without `children` it still draws the old button row, which is the
 * arrangement `OrderActions` uses and for the same reason.
 *
 * IT WAS `InvoiceFooter` AND THE NAME HAD BEEN WRONG SINCE 2026-09-02, when
 * these commands left the foot of the page for the title row. Renamed here
 * rather than left to mislead a third reader (015's "Receiving" relabel, and
 * 059's `resolution_note`).
 *
 * WHY IT WAS NEVER AN ACTIONBAR: Mark had the black band removed from the
 * receiving screen on 2026-08-04 ("get rid of the black band at the bottom…
 * just two buttons"). Reintroducing one on a brand-new detail screen would be
 * reintroducing the thing he just took out.
 *
 * WHY APPROVE WAS NEVER BLACK, in the arrangement this replaces:
 * `DIALOG_COMMIT_CLASS` is "a commit inside a panel", extended to the receiving
 * screen because that screen produces ONE outcome and its footer is a
 * text-weight escape beside a commit. This screen isn't that — what you came to
 * do is edit the inline cells. Moot in a menu, where every row is a peer.
 *
 * WHY IT DOESN'T NAVIGATE ON SUCCESS: receiving's Finalize leaves because
 * finalizing ENDS the task and everything left on screen is for a delivery you
 * have declared done. Approving leaves you looking at a record you may still
 * want to read, so the state is the feedback — the command is replaced by who
 * approved it and when.
 */
export function BillActions({
  billId,
  status,
  approvedAt,
  caveats,
  canApprove,
  canEdit,
  closeHref,
  supabase,
  onDone,
  children,
}: {
  billId: string;
  status: BillStatus;
  approvedAt: string | null;
  /** What `approvalReadiness` found — named in the confirm, never blocking. */
  caveats: string[];
  canApprove: boolean;
  canEdit: boolean;
  closeHref: string;
  supabase: SupabaseClient;
  onDone: () => void;
  /** Hand the rows to an `ActionMenu` instead of drawing buttons. TWO GROUPS,
   *  because the menu puts QuickBooks BETWEEN them and the app's rule is that
   *  the destructive rows come last — `OrderActions`' own `{ edit, destructive }`
   *  shape. */
  children?: (groups: {
    decide: ActionMenuItem[];
    destructive: ActionMenuItem[];
  }) => ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setApproval(approved: boolean) {
    if (approved && caveats.length > 0) {
      const ok = (await confirmDialog({ ...splitConfirmMessage(`Approve this bill for payment?\n\n` +
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
      "set_vendor_bill_approval",
      { p_bill: billId, p_approved: approved }
    );
    setBusy(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    // ROW COUNT, not the absence of an error. The function returns no rows when
    // it refuses — wrong role, wrong org, a voided bill — and PostgREST
    // reports that as a perfectly successful call. A cheerful false success
    // about money is the employee-delete lesson with more at stake.
    if (!Array.isArray(data) || data.length === 0) {
      setError(
        approved
          ? "That wasn't approved — a voided bill can't be, and approving needs a manager."
          : "That wasn't changed — approval can only be withdrawn by a manager."
      );
      return;
    }
    onDone();
  }

  async function setStatus(next: "void" | "open") {
    if (
      next === "void" &&
      !(await confirmDialog({ ...splitConfirmMessage("Void this bill?\n\nIt stays on file and stops counting toward what " +
          "you owe. A voided bill can't be approved until it's reopened."), confirmLabel: "Void", tone: "danger" }))
    ) {
      return;
    }
    setBusy(next);
    setError(null);
    const { data, error: updateError } = await supabase
      .from("vendor_bills")
      .update({ status: next })
      .eq("id", billId)
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
   * Delete the bill — for the one you filed by mistake, not for the one you
   * decided not to pay. That's Void, and the confirm says so.
   *
   * The order matters and it's 018's rule read backwards. `bill_id` is
   * `on delete set null`, so a document that ALSO belongs to a purchase order
   * survives and simply stops naming this bill — which is right; the
   * delivery's paperwork isn't the bookkeeping. A document that belongs ONLY to
   * this bill would be orphaned instead, so it goes first: row, then object,
   * exactly the direction `useAttachmentActions.remove` uses and for the same
   * reason (an orphan object is invisible and harmless; a row pointing at a
   * missing file renders broken).
   */
  async function destroy() {
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Delete this bill?\n\n` +
          `Its lines go with it. Any document filed only here is removed; a ` +
          `document that also belongs to a purchase order stays on that order.\n\n` +
          `This is for an bill filed by mistake. To keep the record but stop ` +
          `it counting toward what you owe, use Void instead.\n\nThis cannot be undone.`), confirmLabel: "Delete", tone: "danger" }))
    ) {
      return;
    }
    setBusy("delete");
    setError(null);

    // Bill-only documents: the rows first, then their objects.
    const { data: own } = await supabase
      .from("purchase_order_attachments")
      .select("id, storage_path")
      .eq("bill_id", billId)
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
      .from("vendor_bills")
      .delete()
      .eq("id", billId)
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
    "h-9 mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

  /* -- the prose, which is the same either way ----------------------------- */
  const notes = (
    <>
      {error && <p className="max-w-sm text-right text-sm text-accent">{error}</p>}
      {/* THE LOCK EXPLAINS ITSELF (Mark, 2026-09-03, on seeing it live: "the
          text 'Its figures are locked — withdraw approval to edit them.' is
          unnecessary") — the fields are already sitting there read-only, which
          is the whole message. Back to exactly what this said before 089. */}
      {status === "approved" && (
        <p className="max-w-sm text-right text-sm text-muted">
          Approved for payment
          {approvedAt ? ` on ${approvedAt.slice(0, 10)}` : ""}.
        </p>
      )}
    </>
  );

  if (children) {
    // TITLE CASE, the app's rule for a menu row, and the labels say what they
    // act on where a button beside a heading did not have to.
    const decide: ActionMenuItem[] = [
      ...(canApprove && status === "open"
        ? [
            {
              label: busy === "approve" ? "Approving…" : "Approve for Payment",
              disabled: busy !== null,
              onSelect: () => void setApproval(true),
            },
          ]
        : []),
      ...(canApprove && status === "approved"
        ? [
            {
              label: busy === "unapprove" ? "Withdrawing…" : "Withdraw Approval",
              disabled: busy !== null,
              onSelect: () => void setApproval(false),
            },
          ]
        : []),
      ...(canEdit && status === "void"
        ? [
            {
              // NOT destructive and NOT red — it is the UNDO of Void, and the
              // only thing a voided bill can do. It sits with the approval
              // decisions because it is one: what state this record is in.
              label: busy === "open" ? "Reopening…" : "Reopen Bill",
              disabled: busy !== null,
              onSelect: () => void setStatus("open"),
            },
          ]
        : []),
    ];
    const destructive: ActionMenuItem[] = [
      ...(canEdit && status !== "void"
        ? [
            {
              label: busy === "void" ? "Voiding…" : "Void Bill",
              danger: true,
              disabled: busy !== null,
              onSelect: () => void setStatus("void"),
            },
          ]
        : []),
      ...(canEdit
        ? [
            {
              label: busy === "delete" ? "Deleting…" : "Delete Bill…",
              danger: true,
              disabled: busy !== null,
              onSelect: () => void destroy(),
            },
          ]
        : []),
    ];
    return (
      <>
        {children({ decide, destructive })}
        {notes}
      </>
    );
  }

  // ITS OWN BOX NOW, matching `PushToQuickBooks`'s shape (Mark, 2026-09-03) —
  // a button row, then its own prose stacked beneath, in the fourth grid
  // column `BillDetail` gives it. Sharing one row with QuickBooks' buttons
  // was the "put the send to quickbooks button in the same div" ask from
  // 2026-09-02; putting each in its OWN box is the further step Mark asked
  // for the next day, once four clearly separated areas turned out to matter
  // more than one shared row of buttons.
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {/* NO CLOSE (Mark, 2026-09-02). It was the escape from a footer
            pinned to the foot of the page; with these commands level with the
            title the breadcrumb is directly above them and says where it
            goes. */}
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
      </div>

      {/* The same prose the menu path renders, so the two cannot drift. */}
      <div className="w-full space-y-1">{notes}</div>
    </div>
  );
}
