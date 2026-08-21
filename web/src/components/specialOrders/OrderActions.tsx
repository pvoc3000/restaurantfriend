"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { FLAG_TODO, type SpecialOrderKind, type SpecialOrderStatus } from "@/lib/specialOrders";

/**
 * The commands that act on the whole order.
 *
 * WHITE BUTTONS, all of them, and no primary among them. They are a row of
 * peers on a SCREEN, which CLAUDE.md names as exactly the case that is not the
 * `DIALOG_COMMIT_CLASS` exception — what you came to this record to do is edit
 * the cells above.
 *
 * Duplicate is decision 13's "one mechanism, three uses": templates, standing
 * orders and "same as last year" are all copy-this-order.
 */
export function OrderActions({
  id,
  number,
  kind,
  status,
  flagReason,
  lineCount,
  paymentCount,
  canWrite,
}: {
  id: string;
  number: string;
  kind: SpecialOrderKind;
  status: SpecialOrderStatus | null;
  flagReason: string | null;
  lineCount: number;
  paymentCount: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");

  if (!canWrite) return null;

  function flag() {
    const text = reason.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      // Decision 4: flagging sets the reason AND the to-do, in one statement —
      // two writes could leave an order flagged with no to-do, which is a red
      // row nobody is asked to do anything about.
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ flag_reason: text, todo: FLAG_TODO })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The flag wasn't saved — the database refused it silently.");
      else {
        // NO `log()` HERE ANY MORE — migration 054's trigger watches
        // `flag_reason` and `todo` and writes "Flag set to …; To-do set to
        // Resolve Issue" from the update itself. Keeping this would print the
        // same act twice, once in the app's words and once in the database's.
        setFlagging(false);
        setReason("");
        router.refresh();
      }
    });
  }

  function resolve() {
    setError(null);
    start(async () => {
      // …and resolving clears BOTH, for the mirror reason.
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ flag_reason: null, todo: null })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else {
        // Likewise: the trigger says "Flag cleared (was …); To-do cleared".
        router.refresh();
      }
    });
  }

  /* THERE IS NO `log()` HELPER HERE ANY MORE. Migration 054's triggers write
     the order's history from the columns themselves, so flag, resolve and
     cancel each stopped writing an entry that said less than the trigger's
     does — "Order cancelled" against "Status changed from Order to Cancelled".
     The ONE entry this file still writes is `Duplicated from order N`, three
     hundred lines down, and it writes it directly: a duplicate is a fact about
     a row that has no column anywhere, since nothing on the new order records
     where it came from. */

  async function cancel() {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Cancel order ${number}?\n\nIt stays on the list, greyed and struck through, and drops out of every working view. Cancelling is reversible — set the status back on the Info tab.`
        ),
        confirmLabel: "Cancel the order",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ status: "cancelled" })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else {
        // The trigger's "Status changed from Order to Cancelled" is strictly
        // more than "Order cancelled" was.
        router.refresh();
      }
    });
  }

  /**
   * Decision 13's one mechanism. The copy arrives as a LEAD with no dates and
   * no payments — a duplicate of a paid order that claimed to be paid would be
   * a fiction, and the stage dates belong to the event that happened.
   */
  async function duplicate() {
    setError(null);
    start(async () => {
      const { data: source, error: readError } = await supabase
        .from("special_orders")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (readError || !source) {
        setError(readError?.message ?? "Could not read this order.");
        return;
      }

      const { data: nextNumber, error: numberError } = await supabase.rpc(
        "next_special_order_number",
        { p_org_id: source.org_id }
      );
      if (numberError || !nextNumber) {
        setError(numberError?.message ?? "Could not allocate an order number.");
        return;
      }

      const copy = { ...(source as Record<string, unknown>) };
      // Identity and history do not travel.
      for (const key of [
        "id", "number", "legacy_id", "legacy_seq", "created_at", "updated_at",
        "created_by", "updated_by", "date_initiated", "quote_sent_at",
        "quote_returned_at", "invoice_sent_at", "invoice_paid_at",
        "receipt_sent_at", "delivery_scheduled_at", "order_printed_at",
        "order_scheduled_at", "production_schedule_id", "standing_order_id",
        "inbound_subject", "inbound_message_id", "flag_reason",
        "source_payload", "external_ref",
      ]) {
        delete copy[key];
      }
      copy.number = nextNumber;
      // A copy is always a real ORDER starting as a lead, even when the source
      // was a template or a standing order — that is what "start from one"
      // means, and it is the only way a template is ever used.
      copy.kind = "order";
      copy.status = "lead";
      copy.standing_days = null;
      copy.starts_on = null;
      copy.ends_on = null;
      copy.paused = false;
      copy.source = "app";
      copy.todo = "Respond to Email/Call";

      const { data: created, error: insertError } = await supabase
        .from("special_orders")
        .insert(copy)
        .select("id")
        .single();
      if (insertError || !created) {
        setError(insertError?.message ?? "The copy could not be created.");
        return;
      }

      // The lines travel; the payments emphatically do not.
      const { data: lines } = await supabase
        .from("special_order_items")
        .select("*")
        .eq("order_id", id);
      if (lines?.length) {
        const copies = lines.map((l) => {
          const line = { ...(l as Record<string, unknown>) };
          for (const key of ["id", "created_at", "updated_at", "legacy_key"]) delete line[key];
          line.order_id = created.id;
          return line;
        });
        const { error: lineError } = await supabase.from("special_order_items").insert(copies);
        if (lineError) {
          setError(`The order was copied but its lines were not: ${lineError.message}`);
          return;
        }
      }

      await supabase.from("special_order_events").insert({
        org_id: source.org_id,
        order_id: created.id,
        message: `Duplicated from order ${number}`,
        source: "app",
      });

      router.refresh();
      router.push(`/special-orders/${created.id as string}`);
    });
  }

  async function remove() {
    const damage = [
      lineCount ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : null,
      paymentCount ? `${paymentCount} payment${paymentCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean);

    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Delete order ${number}?\n\n${
            damage.length
              ? `This also removes ${damage.join(" and ")}, and everything in its history. `
              : ""
          }Deleting is for a typo. An order that is not happening should be CANCELLED, which keeps the record.`
        ),
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      // `.select()` its own result: with no matching policy Postgres removes
      // zero rows and PostgREST returns NO error, and a cheerful success that
      // also NAVIGATES reads as the order having been deleted.
      const { data, error: e } = await supabase
        .from("special_orders")
        .delete()
        .eq("id", id)
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was deleted — the database refused it and said nothing.");
        return;
      }
      router.refresh();
      router.push("/special-orders");
    });
  }

  return (
    /* NO HEADING AND NO SECTION: this lives in the record's sticky footer now
       (FileMaker's own bottom row), where a "Commands" caption would label a
       bar that is self-evidently a bar. The error sits at the end of the same
       row so a refusal appears beside the button that caused it. */
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_CLASS} onClick={duplicate} disabled={pending}>
          Duplicate
        </button>
        {flagReason ? (
          /* BLACK, and only while the order is flagged (Mark, 2026-08-21). A
             flagged record is in an abnormal state with exactly one way out, so
             this is a commit standing beside no peers — `PRIMARY_BUTTON_CLASS`
             explains the exception in full. Unflagged, the same slot holds
             "Flag an issue", which is an ordinary command and stays white. */
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={resolve} disabled={pending}>
            Resolve the issue
          </button>
        ) : (
          <button type="button" className={BUTTON_CLASS} onClick={() => setFlagging(true)} disabled={pending}>
            Flag an issue
          </button>
        )}
        {kind === "order" && status !== "cancelled" ? (
          <button type="button" className={DANGER_BUTTON_CLASS} onClick={cancel} disabled={pending}>
            Cancel order
          </button>
        ) : null}
        <button type="button" className={DANGER_BUTTON_CLASS} onClick={remove} disabled={pending}>
          Delete
        </button>
      </div>

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}

      {flagging && (
        <Dialog
          title="Flag an issue"
          onClose={() => { setFlagging(false); setReason(""); }}
          busy={pending}
          onSubmit={() => { if (reason.trim() && !pending) flag(); }}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => { setFlagging(false); setReason(""); }}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={flag}
                disabled={pending || !reason.trim()}
                className={DIALOG_COMMIT_CLASS}
              >
                Flag it
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">
              The row turns red on the list and its to-do becomes “{FLAG_TODO}”.
              A flag outranks anything the app worked out about this order.
            </p>
            <TextInput
              value={reason}
              onValueChange={setReason}
              placeholder="Customer disputes the flavour"
              aria-label="What is wrong"
              className="w-full"
              autoFocus
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
