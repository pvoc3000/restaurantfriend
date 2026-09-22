"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import {
  FLAG_TODO,
  KIND_COMMAND_NOUN,
  type SpecialOrderKind,
  type SpecialOrderStatus,
} from "@/lib/specialOrders";
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
 * SINCE 2026-09-11 THE RECORD DRAWS THEM AS ROWS OF ONE "ACTIONS" MENU
 * (`OrderCommandMenu`): pass `children` and this hands back its rows — `edit`
 * (Duplicate, Flag… or Resolve Flag) and `destructive` (Cancel Order, Delete),
 * in Title Case like every menu row — while still owning the writes, the
 * confirms, the flag dialog and
 * the error line. Without `children` it draws the old button row.
 *
 * Duplicate is decision 13's "one mechanism, three uses": templates, standing
 * orders and "same as last year" are all copy-this-order.
 */
export function OrderActions({
  orgId,
  id,
  number,
  kind,
  status,
  flagReason,
  flagSource,
  todo,
  canWrite,
  scheduled,
  lineCount,
  schedule,
  children,
}: {
  id: string;
  number: string;
  /** For 113's `copy_special_order`, which does the copy in one quiet
   *  transaction — see `duplicateSpecialOrder`. */
  orgId: string;
  kind: SpecialOrderKind;
  status: SpecialOrderStatus | null;
  flagReason: string | null;
  /** Migration 116. 'system' means the app raised it — a new inquiry, a
   *  customer approving a quote — so the command ACKNOWLEDGES rather than
   *  resolves. Null or 'person' is somebody's own flag and keeps the old
   *  wording, which is also what an unmigrated caller gets. */
  flagSource: string | null;
  /** The record's current to-do, read only by `resolve` — see the comment
   *  there for why clearing the flag does not always clear it. */
  todo: string | null;
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
  /** How many lines the order has — read by CLEAR ITEMS, which is not offered
   *  on an order with none, and counts them in its confirm. */
  lineCount: number;
  /**
   * `<ScheduleProduction>`, composed upstream — `ScheduleDetail` passes
   * `print={<PrintPacket/>}` into `ScheduleActions` the same way. Used only by
   * the button row; the Actions menu gets scheduling from `OrderCommandMenu`.
   */
  schedule?: ReactNode;
  /** Render the commands as `ActionMenu` rows instead of a button row. */
  children?: (groups: { edit: ActionMenuItem[]; destructive: ActionMenuItem[] }) => ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");

  if (!canWrite) return children ? <>{children({ edit: [], destructive: [] })}</> : null;

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
      // …and resolving clears the to-do IT SET, which since 116 is not always
      // both columns. Decision 4 pairs "Resolve Issue" with a flag somebody
      // raised, so clearing one clears the other. A SYSTEM flag's companion
      // to-do is a different sentence — a new inquiry carries "Respond to
      // Email/Call" (058) — and that is a real instruction about the customer,
      // not bookkeeping about the flag. Wiping it because somebody dismissed a
      // notice would throw away the one line saying what still has to happen.
      const clears =
        todo === FLAG_TODO
          ? { flag_reason: null, todo: null }
          : { flag_reason: null };
      const { data, error: e } = await supabase
        .from("special_orders")
        .update(clears)
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
     The ONE entry this file still writes is `Duplicated from order N`, and it
     writes it directly: a duplicate is a fact about a row that has no column
     anywhere, since nothing on the new order records where it came from. */

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
  /**
   * DUPLICATE AND THE TWO CONVERSIONS ARE ONE FUNCTION, because they are one
   * act with a different answer to "what is the copy?" — `lib/specialOrderWrites`
   * holds the rest (what does not travel, what the kind decides, the log line).
   *
   * IT LANDS YOU ON THE COPY either way. That is what makes a conversion read
   * as having happened: you asked for a template and there is a template on
   * screen, with the order you started from still where you left it.
   */
  function duplicate(as: SpecialOrderKind = "order") {
    setError(null);
    start(async () => {
      const result = await duplicateSpecialOrder(supabase, orgId, id, as);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  /**
   * CLEAR ITEMS (Mark, 2026-09-22: "removes all items in a special order") —
   * the row's own ✕, applied to every line in ONE delete, so a refusal leaves
   * the order as it was rather than half-cleared. Payments, documents and the
   * rest of the record stay; the totals recompute from nothing.
   *
   * NOT OFFERED ONCE THE ORDER IS SCHEDULED, which is decision 9's lock on the
   * items read from the other end: the Items tab stops editing them, so a menu
   * row that emptied them would be a way round it. The history needs no entry
   * from here — 054's trigger writes "Removed N × …" for each line.
   */
  async function clearItems() {
    const noun = lineCount === 1 ? "item" : "items";
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Remove all ${lineCount} ${noun} from ${KIND_COMMAND_NOUN[kind].toLowerCase()} ${number}?\n\nThe totals recompute without them. Payments, documents and the rest of the order are not touched, and nothing in the catalog is.`
        ),
        confirmLabel: "Clear Items",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .delete()
        .eq("order_id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("Nothing was removed — the database refused it and said nothing.");
      else router.refresh();
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

  const flagDialog = flagging && (
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
          aria-label="What is wrong"
          className="w-full"
          autoFocus
        />
      </div>
    </Dialog>
  );

  if (children) {
    const edit: ActionMenuItem[] = [
      {
        label: `Duplicate ${KIND_COMMAND_NOUN[kind]}`,
        onSelect: () => duplicate("order"),
        disabled: pending,
      },
      /**
       * THE TWO CONVERSIONS SIT UNDER DUPLICATE (Mark, 2026-09-20: "it would be
       * nice to be able to turn a regular order into a template… selecting
       * 'Convert into an Order Template' would copy it"). They are the same act
       * asked of a different kind, so they belong in the same group and in his
       * own words.
       *
       * NOT OFFERED ON A RECORD THAT IS ALREADY THAT KIND. Converting a
       * template into a template is Duplicate with a longer name, and the row
       * would be a second door to a thing the one above it already does.
       */
      ...(kind !== "template"
        ? [
            {
              label: `Convert ${KIND_COMMAND_NOUN[kind]} to Template`,
              onSelect: () => duplicate("template"),
              disabled: pending,
            },
          ]
        : []),
      ...(kind !== "standing_order"
        ? [
            {
              label: `Convert ${KIND_COMMAND_NOUN[kind]} to Standing`,
              onSelect: () => duplicate("standing_order"),
              disabled: pending,
            },
          ]
        : []),
      flagReason
        ? {
            label: flagSource === "system" ? "Dismiss Notice" : "Resolve Flag",
            onSelect: resolve,
            disabled: pending,
          }
        : { label: `Flag ${KIND_COMMAND_NOUN[kind]}…`, onSelect: () => setFlagging(true), disabled: pending },
    ];
    const destructive: ActionMenuItem[] = [
      // Least to most drastic: the lines, then the order's standing, then the
      // order itself.
      ...(!scheduled && lineCount > 0
        ? [{ label: "Clear Items", onSelect: () => void clearItems(), danger: true, disabled: pending }]
        : []),
      // LITERAL, unlike its neighbours: this row is gated to `kind === "order"`
      // two lines down, so its noun can only ever be "Order" and interpolating
      // it would suggest a variation that cannot happen.
      ...(kind === "order" && status !== "cancelled"
        ? [{ label: "Cancel Order", onSelect: () => void cancel(), danger: true, disabled: pending }]
        : []),
      { label: `Delete ${KIND_COMMAND_NOUN[kind]}`, onSelect: remove, danger: true, disabled: pending },
    ];
    return (
      <>
        {children({ edit, destructive })}
        {error ? <p className="max-w-sm text-right text-[13px] text-accent">{error}</p> : null}
        {flagDialog}
      </>
    );
  }

  return (
    /* NO HEADING AND NO SECTION: a "Commands" caption would label a bar that
       is self-evidently a bar. The error sits at the end of the same row so a
       refusal appears beside the button that caused it. */
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* LEADS THE ROW: scheduling is a thing you do WITH an order, where
            everything after it is done TO the record. */}
        {schedule}
        {/* WRAPPED, not passed straight in: `duplicate` takes a kind, and an
            `onClick` handed the function itself would pass it the MouseEvent.
            The compiler caught that the moment the parameter was added. */}
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => duplicate("order")}
          disabled={pending}
        >
          Duplicate
        </button>
        {flagReason ? (
          /* Only while the order is flagged (Mark, 2026-08-21). A flagged record
             is in an abnormal state with exactly one way out, so this is a
             commit standing beside no peers — `PRIMARY_BUTTON_CLASS` explains
             the exception in full. Unflagged, the same slot holds "Flag an
             issue", which is an ordinary command. */
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={resolve} disabled={pending}>
            {/* 116: THE VERB FOLLOWS WHO RAISED IT. "Resolve the issue" over
                "Quote approved online by Jane Doe" calls good news a problem,
                on the most prominent command the record has. */}
            {flagSource === "system" ? "Mark as seen" : "Resolve the issue"}
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

      {flagDialog}
    </div>
  );
}
