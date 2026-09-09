"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { FLAG_TODO, type SpecialOrderKind, type SpecialOrderStatus } from "@/lib/specialOrders";
import {
  deleteConfirmMessage,
  deleteRefusal,
  deleteSpecialOrder,
  duplicateSpecialOrder,
  readDeleteContext,
} from "@/lib/specialOrderWrites";

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
  canWrite,
  scheduled,
  schedule,
}: {
  id: string;
  number: string;
  kind: SpecialOrderKind;
  status: SpecialOrderStatus | null;
  flagReason: string | null;
  canWrite: boolean;
  /**
   * True once a production schedule exists for this order — read by CANCEL,
   * which warns that cancelling does not unschedule.
   *
   * The DELETE no longer takes it, nor the line and payment counts, nor the
   * standing order behind a materialized day: `readDeleteContext` gathers all
   * four itself so that this component and the list's row menu ask the same
   * question of the same data rather than of whatever each happened to hold.
   */
  scheduled: boolean;
  /**
   * `<ScheduleProduction>`, composed upstream — `ScheduleDetail` passes
   * `print={<PrintPacket/>}` into `ScheduleActions` the same way. It keeps this
   * component from growing eight props it does not otherwise need, and keeps
   * the order row a thing only `SpecialOrderDetail` reads.
   */
  schedule?: ReactNode;
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
          `Cancel order ${number}?\n\nIt stays on the list, greyed and struck through, and drops out of every working view. Cancelling is reversible — set the status back on the Info tab.${
            scheduled
              ? " The kitchen still has this order: cancelling does NOT unschedule it, so unschedule it as well or those donuts get made."
              : ""
          }`
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
   * Decision 13's one mechanism, and the LIST does it too since 2026-09-08 —
   * so the rule lives in `lib/specialOrderWrites` and this is one of its two
   * callers. What used to be ninety lines here is the same ninety lines there,
   * where the row menu can reach them.
   */
  function duplicate() {
    setError(null);
    start(async () => {
      const result = await duplicateSpecialOrder(supabase, id, number);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  /**
   * THE GUARDS AND THE CONFIRM ARE `lib/specialOrderWrites`', not this
   * component's, and that is the point of the module: the list's `⋯` deletes
   * the same rows, and a delete on this table has three refusals and a message
   * that counts what goes — exactly the things a second copy gets subtly wrong.
   *
   * `readDeleteContext` reads the counts itself rather than taking the props
   * this component holds, so both doors ask the same question of the same data.
   */
  function remove() {
    setError(null);
    start(async () => {
      const ctx = await readDeleteContext(supabase, id);
      if ("error" in ctx) {
        setError(ctx.error);
        return;
      }
      const refusal = deleteRefusal(ctx);
      if (refusal) {
        setError(refusal);
        return;
      }
      const ok = await confirmDialog({
        ...splitConfirmMessage(deleteConfirmMessage(ctx)),
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!ok) return;

      const result = await deleteSpecialOrder(supabase, id);
      if ("error" in result) {
        setError(result.error);
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
        {/* LEADS THE ROW: scheduling is a thing you do WITH an order, where
            everything after it is done TO the record. */}
        {schedule}
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
