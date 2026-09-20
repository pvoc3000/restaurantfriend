"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { money } from "@/lib/purchaseOrders";
import type { BillListRow } from "@/app/(app)/bills/page";
import { invokeQbo } from "@/lib/qboClient";
import { normalizeInvoiceNumber, pushIsStale } from "@/lib/bills";
import {
  billPushRefusals,
  expenseAccountFor,
  proposeBillLink,
  pushedLabel,
  qboTrackingFor,
  qboVendorId,
  type PushableBill,
  type QboCandidate,
} from "@/lib/quickbooks";
import { readBillPushContext, sendBillToQuickBooks } from "./qboBillPush";

/**
 * What you can do to a handful of bills at once.
 *
 * Both commands already exist for ONE bill on `InvoiceFooter`, and this is
 * deliberately the same logic rather than a second implementation — the row
 * count check on the approval RPC, and the document order on the delete, are
 * each a lesson this module paid for once.
 *
 * WHAT IT REFUSES TO DO SILENTLY is the whole design. A selection is a mixed
 * bag: some already approved, some voided, some carrying paperwork, some
 * already in QuickBooks. Every command says what it will SKIP before it runs,
 * and reports what actually happened rather than what was asked for.
 */
export function BillBatchActions({
  selected,
  orgId,
  canEdit,
  canApprove,
  onReport,
  children,
}: {
  selected: BillListRow[];
  orgId: string;
  /** purchaser+, matching what 025's delete policy allows. */
  canEdit: boolean;
  /** Manager and Owner only — the module's own decision, and what
   *  `set_vendor_bill_approval` enforces regardless of what is on screen. */
  canApprove: boolean;
  /**
   * Hand the outcome UP and clear the selection.
   *
   * IT CANNOT REPORT FOR ITSELF. Clearing the selection unmounts the bar this
   * lives in, so a `done` message set here is destroyed the instant it is set —
   * which is exactly what happened on the first real bulk approve: two bills
   * were approved, correctly, and the screen said nothing at all. The report
   * has to outlive the thing that produced it.
   */
  onReport: (message: string, tone: "done" | "error") => void;
  /**
   * HANDS ITS ROWS OUT rather than drawing buttons (2026-09-11), so the list's
   * one Actions menu owns WHERE these sit while this keeps owning what they
   * DO — the confirms that name what will be skipped, the approval RPC's row
   * count, the document order on the delete. `OrderCommandMenu`'s shape, and
   * the reason is the same: those are each a lesson paid for once and not
   * worth a second copy.
   */
  children: (items: ActionMenuItem[]) => ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "delete" | "push" | null>(null);
  /** Whether QuickBooks is connected at all — the record's rule: a screen is
   *  not the place to advertise a feature nobody has set up, so the row is
   *  absent until this says yes. One cheap RPC per list load. */
  const [qboConnected, setQboConnected] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("accounting_connection_status", { p_org: orgId });
      const row = Array.isArray(data) ? (data[0] as { status?: string } | undefined) : undefined;
      if (!cancelled) setQboConnected(row?.status === "connected");
    })();
    return () => {
      cancelled = true;
    };
    // `supabase` is a fresh client each render; the org and the role are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canEdit]);

  // Only an APPROVED bill goes to QuickBooks — `billPushRefusals` says so for
  // one bill, and the count in the label says it for the selection.
  const pushable = selected.filter((i) => i.status === "approved");

  // Only an OPEN bill can be approved: an approved one is already there and
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
        `Approve ${approvable.length} bill${approvable.length === 1 ? "" : "s"} for payment?\n\n` +
          `${money(approvableTotal)} in total.` +
          (skipped.length ? `\n\n${skipped.join(" and ")} — those are left alone.` : "")
      ),
      confirmLabel: "Approve",
    });
    if (!ok) return;

    setBusy("approve");
    let approved = 0;
    const refused: string[] = [];
    for (const bill of approvable) {
      // THE RPC, NEVER AN UPDATE. RLS filters rows and "only a manager may set
      // approved_at" is a COLUMN rule, so 025 names those columns in a definer.
      const { data, error: rpcError } = await supabase.rpc("set_vendor_bill_approval", {
        p_bill: bill.id,
        p_approved: true,
      });
      // ROW COUNT, not the absence of an error: the function returns NO ROWS
      // when it refuses — wrong role, wrong org, a voided bill — and
      // PostgREST reports that as a perfectly successful call. A cheerful false
      // success about money is the employee-delete lesson with more at stake,
      // and in a loop it would be that lesson eight times over.
      if (rpcError || !Array.isArray(data) || data.length === 0) {
        refused.push(bill.invoice_number ?? "no number");
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
      onReport(`Approved ${approved} bill${approved === 1 ? "" : "s"} for payment.`, "done");
    }
    if (approved > 0) router.refresh();
  }

  async function destroy() {
    const approvedCount = selected.filter((i) => i.status === "approved").length;
    const linked = selected.filter((i) => i.qbo_linked).length;
    const files = selected.reduce((n, i) => n + i.document_count, 0);

    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Delete ${selected.length} bill${selected.length === 1 ? "" : "s"} and their lines?\n\n` +
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

    // Bill-ONLY documents: rows first, then their objects. 018's rule read
    // backwards — an orphan object is invisible and harmless, where a row
    // pointing at a missing file renders broken. A document that also belongs
    // to a purchase order is `on delete set null` and simply stops naming this
    // bill, which is right: the delivery's paperwork is not the bookkeeping.
    const { data: own } = await supabase
      .from("purchase_order_attachments")
      .select("id, storage_path")
      .in("bill_id", ids)
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
      .from("vendor_bills")
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
        ? `Deleted ${removed} bill${removed === 1 ? "" : "s"}.`
        : `Deleted ${removed} of ${ids.length} — the rest were refused.`,
      removed === ids.length ? "done" : "error"
    );
    router.refresh();
  }


  /**
   * PUSH THE TICKED, APPROVED BILLS TO QUICKBOOKS (Mark, 2026-09-16).
   *
   * THE RECORD'S PUSH, BILL BY BILL — `qboBillPush` is the send, and every
   * guard the record applies is applied here, each one a SKIP that is NAMED in
   * the report rather than a quiet omission:
   *   · already in QuickBooks and not edited since → left alone (nothing to send);
   *   · not yet linked, but QuickBooks already HAS it under this number →
   *     skipped, never sent: the record's "found means stop" rule, since a
   *     second copy in the books is the one outcome this module exists to
   *     avoid. Linking is a per-bill decision and stays on the record;
   *   · anything `billPushRefusals` refuses (no vendor mapping, no account…).
   * Sequential, because each push is its own request and its own recorded ref;
   * a failure part way keeps what went and says so.
   */
  async function push() {
    const skipped = selected.length - pushable.length;
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        `Push ${pushable.length} approved bill${pushable.length === 1 ? "" : "s"} to QuickBooks?\n\n` +
          `Bills already in QuickBooks are updated only if they were edited since they were sent. ` +
          `A bill QuickBooks already has under the same number is skipped — link it on its record.` +
          (skipped ? `\n\n${skipped} not approved — those are left alone.` : "")
      ),
      confirmLabel: "Push",
    });
    if (!ok) return;

    setBusy("push");
    const ids = pushable.map((i) => i.id);
    const { data: rows, error: rowsError } = await supabase
      .from("vendor_bills")
      .select(
        "id, vendor_id, location_id, invoice_number, invoice_date, due_date, total, is_credit, status, financials_touched_at, synced_at"
      )
      .in("id", ids);
    if (rowsError || !rows) {
      setBusy(null);
      onReport(rowsError?.message ?? "The bills could not be read.", "error");
      return;
    }

    // ONE duplicate lookup for the whole selection — `find_bills` takes ids and
    // returns a flat candidate list that `proposeBillLink` narrows per bill.
    const unlinked = pushable.filter((i) => !i.qbo_linked).map((i) => i.id);
    let candidates: QboCandidate[] = [];
    if (unlinked.length > 0) {
      const { data, message } = await invokeQbo(supabase, {
        mode: "find_bills",
        bill_ids: unlinked,
      });
      if (message) {
        // The record falls through on a failed lookup; a BATCH must not, or a
        // bad connection would put every Bill.com-synced bill in twice.
        setBusy(null);
        onReport(`QuickBooks could not be checked for duplicates, so nothing was sent: ${message}`, "error");
        return;
      }
      candidates = (data?.candidates as QboCandidate[]) ?? [];
    }

    let sent = 0;
    let updated = 0;
    const notes: string[] = [];
    const failed: string[] = [];
    for (const listRow of pushable) {
      const inv = rows.find((r) => r.id === listRow.id);
      const name = listRow.invoice_number ?? "no number";
      if (!inv) {
        failed.push(`${name}: could not be read`);
        continue;
      }
      const ctx = await readBillPushContext(supabase, {
        orgId,
        vendorId: inv.vendor_id as string,
        locationId: inv.location_id as string,
        billId: inv.id as string,
      });
      if (!ctx.connected) {
        failed.push(`${name}: QuickBooks is not connected`);
        break;
      }
      const already = pushedLabel(ctx.billRef);
      if (
        already &&
        !pushIsStale({
          financials_touched_at: inv.financials_touched_at as string | null,
          synced_at: inv.synced_at as string | null,
        })
      ) {
        notes.push(`${name} already in QuickBooks, unchanged`);
        continue;
      }
      const account = expenseAccountFor(ctx.atShop, ctx.orgAccount);
      const vendorRef = qboVendorId(ctx.atShop?.external_ref ?? null);
      const bill: PushableBill = {
        id: inv.id as string,
        po_numbers: listRow.purchase_orders.map((p) => p.po_number),
        invoice_number: inv.invoice_number as string | null,
        invoice_date: inv.invoice_date as string | null,
        due_date: inv.due_date as string | null,
        total: inv.total as number | null,
        is_credit: inv.is_credit as boolean,
        status: inv.status as PushableBill["status"],
        external_ref: ctx.billRef,
      };
      if (!already) {
        const found = proposeBillLink(
          {
            invoice_number: bill.invoice_number,
            total: bill.total,
            is_credit: bill.is_credit,
            external_ref: ctx.billRef,
          },
          candidates,
          vendorRef,
          normalizeInvoiceNumber
        );
        if (found.ok) {
          notes.push(`${name} is already in QuickBooks — link it on its record`);
          continue;
        }
      }
      const refusals = billPushRefusals({
        bill: bill,
        vendorRef,
        vendorName: ctx.vendorName,
        accountRef: account?.ref ?? null,
      });
      if (refusals.length > 0 || !account) {
        notes.push(`${name}: ${refusals[0] ?? "no expense account"}`);
        continue;
      }
      const result = await sendBillToQuickBooks(supabase, {
        billId: inv.id as string,
        ctx,
        bill,
        account,
        vendorRef,
        tracking: qboTrackingFor(ctx.atShop),
      });
      if (!result.ok) {
        failed.push(`${name}: ${result.message}`);
        continue;
      }
      if (result.updated) updated++;
      else sent++;
      for (const w of result.warnings) notes.push(`${name}: ${w}`);
    }
    setBusy(null);

    const done = [sent ? `Sent ${sent}` : null, updated ? `updated ${updated}` : null]
      .filter(Boolean)
      .join(", ");
    const parts = [
      done ? `${done[0].toUpperCase()}${done.slice(1)} in QuickBooks.` : "Nothing was sent to QuickBooks.",
      failed.length ? `Failed: ${failed.join("; ")}.` : null,
      notes.length ? `Skipped or noted: ${notes.join("; ")}.` : null,
    ].filter(Boolean);
    onReport(parts.join(" "), failed.length ? "error" : "done");
    if (sent + updated > 0) router.refresh();
  }

  /**
   * APPROVE IS RENDERED WHENEVER THE ROLE HAS IT AND GREYED WHEN THE SELECTION
   * HOLDS NOTHING OPEN, where the button used to disappear. The count in the
   * label is the reason on the row it is about — "Approve (0)" says the
   * selection is already approved or voided — which a vanished control cannot
   * say and a greyed one cannot say on an iPad, having no hover.
   */
  const items: ActionMenuItem[] = [
    ...(canApprove
      ? [
          {
            label: busy === "approve" ? "Approving…" : `Approve (${approvable.length})`,
            disabled: busy !== null || approvable.length === 0,
            onSelect: () => void approve(),
          },
        ]
      : []),
    // Same gate as the record's push (`canPush` is the Bills edit cell),
    // and absent until QuickBooks is known to be connected.
    ...(canEdit && qboConnected
      ? [
          {
            label: busy === "push" ? "Pushing…" : `Push to QuickBooks (${pushable.length})`,
            disabled: busy !== null || pushable.length === 0,
            onSelect: () => void push(),
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            label: busy === "delete" ? "Deleting…" : "Delete Selected…",
            danger: true,
            separatorBefore: true,
            disabled: busy !== null || selected.length === 0,
            onSelect: () => void destroy(),
          },
        ]
      : []),
  ];

  return <>{children(items)}</>;
}
