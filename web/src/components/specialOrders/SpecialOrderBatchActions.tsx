"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { deleteBlock, type DeleteBlock } from "@/lib/specialOrderWrites";
import {
  COMPLETION_DATES,
  STATUS_LABEL,
  STATUS_ORDER,
  TODO_OPTIONS,
  countsAsOwed,
  money,
  type SpecialOrderStatus,
} from "@/lib/specialOrders";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import type { SpecialOrderRow } from "./SpecialOrdersList";

/**
 * What you can do to a handful of special orders at once.
 *
 * `BillBatchActions`' shape and its two rules, which are the whole design:
 *
 * **WHAT IT REFUSES TO DO SILENTLY.** A selection is a mixed bag — templates
 * among orders, some already cancelled, some made by a standing order, some
 * with the kitchen already holding them. Every command counts what it will act
 * on IN ITS OWN LABEL, says what it will skip before it runs, and reports what
 * actually happened rather than what was asked for.
 *
 * **IT HANDS ITS ROWS OUT** rather than drawing buttons, so the list's one
 * Actions menu owns WHERE they sit while this owns what they DO.
 *
 * ---------------------------------------------------------------------------
 * ONE STATEMENT PER COMMAND, NOT ONE PER ROW
 * ---------------------------------------------------------------------------
 * Each verb is a single `.in("id", ids)` write. Twenty round trips would be
 * twenty chances to half-finish, and a selection half-cancelled is a worse
 * state than one nobody touched. Each `.select()`s its own rows, because an
 * update matching no RLS policy changes nothing and PostgREST returns no error
 * — the count is the only way a refusal is heard, and here it also feeds the
 * sentence that reports it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS HERE, AND WHAT IS DELIBERATELY NOT
 * ---------------------------------------------------------------------------
 * Set Status ▸ (the ladder, Cancelled included), Set To-do ▸ (the vocabulary,
 * and Clear), Set Completion Date… (the record's own nine, any date, or
 * cleared), Mark Paid, Resolve Flags, Delete Selected. Every one of them
 * exists for a single order somewhere else,
 * and each is the SAME rule applied to more rows rather than a second reading
 * of it.
 *
 * **Duplicate** is not. It is on the row menu and the record, where it copies
 * ONE order and lands you on the copy; in bulk it would make a dozen leads and
 * leave you on the list looking at them, which reads as an accident rather than
 * a command — and the thing it is for, "same as last year", is one at a time.
 *
 * **Mark Paid does not touch the money.** The record's own flow offers to
 * record a settling payment when you stamp that date, as a tick you choose.
 * Doing it from a menu row would write a dozen financial records — money
 * received, from nobody, on a day nobody named — on one click. The confirm and
 * the report both say what is left owing and where to settle it.
 */
export function SpecialOrderBatchActions({
  selected,
  today,
  canWrite,
  onReport,
  children,
}: {
  selected: SpecialOrderRow[];
  /** The ORG's calendar day (`lib/today`) — what Mark Paid stamps. Never
   *  `new Date()`: a browser in another zone must not date the books. */
  today: string;
  /** purchaser+ — the same gate the row menu and the record's commands use. */
  canWrite: boolean;
  /**
   * Hand the outcome UP and clear the selection.
   *
   * IT CANNOT REPORT FOR ITSELF: clearing the selection is what the caller does
   * with this, and a message owned by a component the clearing re-renders past
   * is a message nobody reads. `BillBatchActions` paid for that lesson with a
   * bulk approve that worked and said nothing.
   */
  onReport: (message: string, tone: "done" | "error") => void;
  children: (items: ActionMenuItem[]) => ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<
    "status" | "cancel" | "flags" | "paid" | "todo" | "dates" | "delete" | null
  >(null);

  /**
   * THE COMPLETION-DATE DIALOG's state (Mark, 2026-09-20: "add the ability to
   * batch set the various completion dates for selected special orders").
   *
   * A DIALOG, WHERE EVERY OTHER COMMAND HERE IS A MENU ROW, because this one
   * takes two answers: WHICH of the nine dates, and WHAT it should say. A
   * submenu could ask the first and would have to assume the second is today —
   * which is right for the batch you have just printed and wrong for the batch
   * you printed yesterday, and backfilling is most of why somebody reaches for
   * this at all.
   */
  const [dating, setDating] = useState(false);
  const [dateColumn, setDateColumn] = useState("");
  const [dateValue, setDateValue] = useState<string | null>(today);

  /**
   * DECISION 3's BICONDITIONAL DECIDES WHO CAN BE CANCELLED. Migration 051's
   * `special_orders_status_iff_order` makes `status` null exactly when `kind`
   * is not `order`, so cancelling a template is asking the database for a row
   * it will refuse — and a check-constraint refusal is the one failure this
   * app cannot explain in words. They are skipped, and the confirm says so.
   */
  const cancellable = selected.filter((r) => r.kind === "order" && r.status !== "cancelled");
  const flagged = selected.filter((r) => r.flag_reason);

  /**
   * WHO WOULD ACTUALLY MOVE, for a given rung. The same biconditional, plus
   * the rows already there — a count that included them would promise a write
   * that does nothing, and the report would then disagree with the label.
   */
  const movable = (to: SpecialOrderStatus) =>
    selected.filter((r) => r.kind === "order" && r.status !== to);

  /**
   * MARK PAID IS THE `invoice_paid_at` STAMP, which is what the list's Paid
   * column, the ladder's "Invoice paid" rung and the record's green chip all
   * mean by the word. Already-stamped rows are skipped, and so is anything that
   * is not an order: a template has no invoice to have been paid.
   */
  const markable = selected.filter((r) => r.kind === "order" && !r.invoice_paid_at);

  /**
   * IT DOES NOT TOUCH THE MONEY, and that is a decision rather than an
   * omission. The record's own flow OFFERS to record a settling payment when
   * you stamp this date, as a tick you choose; doing it from a menu row would
   * write a dozen financial records — money received, from nobody, on a day
   * nobody named — on one click. These are counted so the confirm can say what
   * is left owing and where to settle it.
   */
  const stillOwing = markable.filter((r) => countsAsOwed(r) && r.totals.balance > 0);

  /**
   * WHO WOULD ACTUALLY MOVE, for a to-do. No kind test, unlike the status:
   * `todo` is a plain column with no constraint behind it, and a note to
   * whoever picks this up next reads the same on a template as on an order.
   * The only rows skipped are the ones already saying it.
   */
  const retodoable = (to: string | null) =>
    selected.filter((r) => (r.todo ?? null) !== to);

  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;

  /**
   * A RUNG, FOR EVERY TICKED ORDER THAT IS NOT ON IT.
   *
   * `cancelled` is NOT handled here — it routes to `cancelOrders`, which has
   * its own warning about the kitchen still holding a scheduled order. One
   * write, one confirm, reached from the one submenu: two doors with different
   * words for the same write is the drift this module keeps out.
   */
  async function setStatus(to: Exclude<SpecialOrderStatus, "cancelled">) {
    const rows = movable(to);
    const skipped = selected.length - rows.length;
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Move ${plural(rows.length, "order")} to ${STATUS_LABEL[to]}?\n\n` +
            (skipped
              ? `${plural(skipped, "of the selected rows is", "of the selected rows are")} ` +
                `already there, or ${skipped === 1 ? "is" : "are"} a template or standing order ` +
                `with no status to set, and will be left alone. `
              : "") +
            "The status is what somebody typed, not what the dates say — nothing else about " +
            "these orders changes, and the stage dates keep their own record."
        ),
        confirmLabel: `Move to ${STATUS_LABEL[to]}`,
      }))
    ) {
      return;
    }
    setBusy("status");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ status: to })
      .in("id", rows.map((r) => r.id))
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was moved — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      `Moved ${plural(data.length, "order")} to ${STATUS_LABEL[to]}.` +
        (skipped ? ` ${plural(skipped, "row")} left alone.` : ""),
      "done"
    );
  }

  async function markPaid() {
    const skipped = selected.length - markable.length;
    const owed = stillOwing.reduce((a, r) => a + r.totals.balance, 0);
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Mark ${plural(markable.length, "order")} paid?\n\n` +
            (skipped
              ? `${plural(skipped, "row")} already carr${skipped === 1 ? "ies" : "y"} a paid ` +
                `date, or ${skipped === 1 ? "is" : "are"} a template or standing order, and ` +
                `will be left alone. `
              : "") +
            `This stamps the invoice-paid date as ${today}. It does NOT record payments` +
            (stillOwing.length
              ? `, and ${plural(stillOwing.length, "of them", "of them")} still ${
                  stillOwing.length === 1 ? "carries" : "carry"
                } a balance — ${money(owed)} in all. Open each one to settle it; the record ` +
                `offers to record the payment for you.`
              : ".")
        ),
        confirmLabel: "Mark them paid",
      }))
    ) {
      return;
    }
    setBusy("paid");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ invoice_paid_at: today })
      .in("id", markable.map((r) => r.id))
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was marked — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      `Marked ${plural(data.length, "order")} paid.` +
        (stillOwing.length
          ? ` ${plural(stillOwing.length, "of them", "of them")} still ${
              stillOwing.length === 1 ? "owes" : "owe"
            } ${money(owed)} — no payments were recorded.`
          : ""),
      "done"
    );
  }

  /**
   * THE CHOSEN DATE, ON EVERY TICKED ROW.
   *
   * NO "ALREADY SAYS IT" SKIP, unlike the status and the to-do. Those two are
   * one value out of a short vocabulary, where a row already on the rung is
   * plainly not moving; a DATE that already reads 2026-09-14 and is being set
   * to 2026-09-20 IS moving, and a row whose date happens to match is a
   * coincidence rather than a state. The write covers the selection, and the
   * report counts what the database actually changed.
   *
   * AN EMPTY DATE CLEARS, and the commit button says so rather than the dialog
   * needing a second control — the record's own cells clear the same way, and
   * "unset the printed date on these six" is a real correction.
   */
  async function setCompletionDate() {
    const label = COMPLETION_DATES.find((d) => d.column === dateColumn)?.label ?? dateColumn;
    setBusy("dates");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ [dateColumn]: dateValue })
      .in("id", selected.map((r) => r.id))
      .select("id");
    setBusy(null);
    // THE DIALOG CLOSES WHATEVER HAPPENS, and that is not tidiness: `onReport`
    // clears the selection, so a dialog left open would be offering "Set on 0"
    // over a message it was covering up.
    setDating(false);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was changed — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      dateValue === null
        ? `Cleared ${label} on ${plural(data.length, "order")}.`
        : `Set ${label} to ${dateValue} on ${plural(data.length, "order")}.`,
      "done"
    );
  }

  /**
   * THE TO-DO, ON EVERY TICKED ROW THAT IS NOT ALREADY SAYING IT (Mark,
   * 2026-09-20: "add the ability to batch change the to do on selected special
   * orders").
   *
   * DECISION 4 SURVIVES THIS INTACT. The rule is that the app SUGGESTS a to-do
   * and never writes one — `WorkflowOffer`'s ticks, the catch-up's `→`. A human
   * picking a row off a menu is the human writing it, which is the same act as
   * typing it into the cell, done to twenty rows at once.
   *
   * `null` CLEARS IT, and that is a real choice rather than the absence of one:
   * the record's own cell is `clearable`, and "nothing to do here" is the most
   * common state in the data — 8,233 of 8,334 migrated orders.
   */
  async function setTodo(to: string | null) {
    const rows = retodoable(to);
    const already = selected.length - rows.length;
    const what = to === null ? "Clear the to-do on" : `Set the to-do to ${to} on`;
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `${what} ${plural(rows.length, "order")}?\n\n` +
            (already
              ? `${plural(already, "row")} already say${already === 1 ? "s" : ""} that, and will ` +
                `be left alone. `
              : "") +
            "A to-do is a note to whoever picks this up next. Nothing else about these orders " +
            "changes — the app never writes one by itself, which is why this is a menu and not " +
            "a rule."
        ),
        confirmLabel: to === null ? "Clear it" : "Set it",
      }))
    ) {
      return;
    }
    setBusy("todo");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ todo: to })
      .in("id", rows.map((r) => r.id))
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was changed — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      to === null
        ? `Cleared the to-do on ${plural(data.length, "order")}.`
        : `Set ${plural(data.length, "order")} to ${to}.`,
      "done"
    );
  }

  /** Reached from Set Status ▸ Cancelled — see that submenu's note. */
  async function cancelOrders() {
    const skipped = selected.length - cancellable.length;
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Cancel ${plural(cancellable.length, "order")}?\n\n` +
            (skipped
              ? `${plural(skipped, "of the selected rows is", "of the selected rows are")} ` +
                `already cancelled or ${skipped === 1 ? "is" : "are"} a template or standing ` +
                `order, and will be left alone. `
              : "") +
            "They stay on the list, greyed and struck through, and drop out of every working " +
            "view. Cancelling is reversible — set the status back on the Info tab. It does NOT " +
            "unschedule anything: where the kitchen already has an order, unschedule it too or " +
            "those donuts get made."
        ),
        confirmLabel: "Cancel them",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy("cancel");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ status: "cancelled" })
      .in("id", cancellable.map((r) => r.id))
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was cancelled — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      `Cancelled ${plural(data.length, "order")}.` +
        (skipped ? ` ${plural(skipped, "row")} left alone.` : ""),
      "done"
    );
  }

  async function resolveFlags() {
    setBusy("flags");
    const { data, error } = await supabase
      .from("special_orders")
      .update({ flag_reason: null })
      .in("id", flagged.map((r) => r.id))
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("No flags were resolved — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(`Resolved ${plural(data.length, "flag")}.`, "done");
  }

  /**
   * THE REFUSALS ARE READ WHEN IT IS PRESSED, not carried by every row.
   *
   * `production_schedule_id` is not in the list's query and should not be: one
   * indexed read over the ticked ids, when the command runs, against a column
   * on all 500 rows that one selection in fifty ever asks about. It is the row
   * menu's own argument, which is why the LABEL cannot state a count the way
   * Cancel's does — nothing on screen knows yet how many would be refused. The
   * confirm states it, before anything is written.
   */
  async function deleteSelected() {
    setBusy("delete");
    const { data: rows, error: readError } = await supabase
      .from("special_orders")
      .select("id, number, kind, production_schedule_id, standing_order_id")
      .in("id", selected.map((r) => r.id));
    if (readError || !rows) {
      setBusy(null);
      return onReport(readError?.message ?? "Could not read the selected orders.", "error");
    }

    const blocked = new Map<DeleteBlock, number>();
    const deletable: string[] = [];
    for (const row of rows) {
      const block = deleteBlock({
        // The ID, not the parent's number: `deleteBlock` only asks WHETHER this
        // day was made by a standing order. The row menu's sentence names the
        // parent, and pays a round trip for it.
        fromStanding: (row.standing_order_id as string | null) ?? null,
        scheduled: (row.production_schedule_id as string | null) !== null,
      });
      if (block === null) deletable.push(row.id as string);
      else blocked.set(block, (blocked.get(block) ?? 0) + 1);
    }

    const standing = blocked.get("standing_day") ?? 0;
    const scheduled = blocked.get("scheduled") ?? 0;

    if (deletable.length === 0) {
      setBusy(null);
      return onReport(
        `Nothing can be deleted. ${
          standing ? `${plural(standing, "row")} came from a standing order — cancel ${standing === 1 ? "it" : "them"} instead. ` : ""
        }${scheduled ? `${plural(scheduled, "row")} already scheduled in the kitchen.` : ""}`.trim(),
        "error"
      );
    }

    const skips = [
      standing ? `${plural(standing, "row")} made by a standing order (cancel instead, or it comes straight back)` : null,
      scheduled ? `${plural(scheduled, "row")} already scheduled in the kitchen` : null,
    ].filter(Boolean);

    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Delete ${plural(deletable.length, "order")}?\n\n` +
            (skips.length ? `Skipping ${skips.join(", and ")}. ` : "") +
            "This also removes their lines, their payments and everything in their history. " +
            "Deleting is for a typo — an order that is not happening should be CANCELLED, " +
            "which keeps the record."
        ),
        confirmLabel: `Delete ${deletable.length}`,
        tone: "danger",
      }))
    ) {
      setBusy(null);
      return;
    }

    const { data, error } = await supabase
      .from("special_orders")
      .delete()
      .in("id", deletable)
      .select("id");
    setBusy(null);
    if (error) return onReport(error.message, "error");
    if (!data?.length) {
      return onReport("Nothing was deleted — the database refused it and said nothing.", "error");
    }
    router.refresh();
    onReport(
      `Deleted ${plural(data.length, "order")}.` +
        (skips.length ? ` Skipped ${plural(standing + scheduled, "row")}.` : ""),
      "done"
    );
  }

  /**
   * ALWAYS RENDERED AND ALWAYS LIVE, greying only while something runs — the
   * PO list's rule. The COUNTS in the labels are what explain a row that would
   * do nothing, where a dead trigger could not.
   */
  const items: ActionMenuItem[] = canWrite
    ? [
        {
          /**
           * THE LADDER AS A SUBMENU (Mark, 2026-09-20: "I'd like to have the
           * ability to change the status of selected special orders").
           *
           * CANCELLED IS ON IT, and it is the same row it always was: it routes
           * to `cancelOrders`, which carries the warning that cancelling does
           * not unschedule anything. It stopped being a command of its own the
           * moment this submenu existed — somebody looking for "cancelled" will
           * look under the statuses, and two doors with different words for one
           * write is the drift this module keeps out. It keeps `danger`, so the
           * one rung you cannot simply undo still reads as the one rung you
           * cannot simply undo.
           *
           * Each rung counts the orders that would actually MOVE, so a rung
           * everything is already on reads "(0)" rather than promising a write
           * that does nothing.
           */
          label: busy === "status" || busy === "cancel" ? "Moving…" : "Set Status",
          disabled: busy !== null || selected.length === 0,
          separatorBefore: true,
          items: STATUS_ORDER.map((to) =>
            to === "cancelled"
              ? {
                  label: `${STATUS_LABEL[to]} (${cancellable.length})`,
                  onSelect: () => void cancelOrders(),
                  danger: true,
                  disabled: busy !== null || cancellable.length === 0,
                }
              : {
                  label: `${STATUS_LABEL[to]} (${movable(to).length})`,
                  onSelect: () => void setStatus(to as Exclude<SpecialOrderStatus, "cancelled">),
                  disabled: busy !== null || movable(to).length === 0,
                }
          ),
        },
        {
          /**
           * THE VOCABULARY AS A SUBMENU, with CLEAR at the foot under its own
           * rule (Mark, 2026-09-20, "including clearing them" — the record's
           * own cell is `clearable`, and an empty to-do is the commonest state
           * in the data).
           *
           * FileMaker's ten values, and only those. The record's cell is
           * `allowNew` because a quarter of the real data is free text ("ON
           * HOLD", "Adjust time to 9am or later"), and a menu cannot offer
           * typing — so the one-off wording stays where it has always been
           * written, on the record. What a SELECTION wants is the shared
           * vocabulary, which is CLAUDE.md's rule for a known one: chosen,
           * never typed.
           *
           * Counts per rung, as Set Status has them: a rung reading "(0)" is
           * what stops a command promising a write that does nothing.
           */
          label: busy === "todo" ? "Setting…" : "Set To-do",
          disabled: busy !== null || selected.length === 0,
          items: [
            ...TODO_OPTIONS.map((o) => ({
              label: `${o.label} (${retodoable(o.value).length})`,
              onSelect: () => void setTodo(o.value),
              disabled: busy !== null || retodoable(o.value).length === 0,
            })),
            {
              label: `Clear To-do (${retodoable(null).length})`,
              onSelect: () => void setTodo(null),
              disabled: busy !== null || retodoable(null).length === 0,
              separatorBefore: true,
            },
          ],
        },
        {
          /**
           * THE ELLIPSIS MEANS A DIALOG FOLLOWS, as it does everywhere else in
           * this app. It asks which date and what it should say — see the
           * dialog's own note.
           *
           * INVOICE PAID IS ON THE LIST HERE TOO, and `Mark Paid` below stays
           * where it is. That is two doors to one COLUMN and not two
           * implementations: this one writes a date somebody chose, that one is
           * the named verb with the balance warning attached, and Mark asked
           * for it by name. Deleting it to tidy the menu would take away the
           * thing he uses to take away the thing he might.
           */
          label: busy === "dates" ? "Setting…" : `Set Completion Date… (${selected.length})`,
          onSelect: () => {
            setDateColumn("");
            setDateValue(today);
            setDating(true);
          },
          disabled: busy !== null || selected.length === 0,
        },
        {
          label: busy === "paid" ? "Marking…" : `Mark Paid (${markable.length})`,
          onSelect: () => void markPaid(),
          disabled: busy !== null || markable.length === 0,
        },
        {
          label: busy === "flags" ? "Resolving…" : `Resolve Flags (${flagged.length})`,
          onSelect: () => void resolveFlags(),
          disabled: busy !== null || flagged.length === 0,
        },
        {
          label: busy === "delete" ? "Deleting…" : `Delete Selected… (${selected.length})`,
          onSelect: () => void deleteSelected(),
          danger: true,
          disabled: busy !== null || selected.length === 0,
        },
      ]
    : [];

  return (
    <>
      {children(items)}

      {dating && (
        <Dialog
          title="Set a completion date"
          onClose={() => {
            if (busy === null) setDating(false);
          }}
          busy={busy === "dates"}
          width="max-w-md"
          /* ENTER COMMITS, because this dialog is a form — the app's rule, and
             it is opt-in, so it is stated here. */
          onSubmit={() => {
            if (dateColumn && busy === null) void setCompletionDate();
          }}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setDating(false)}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={() => void setCompletionDate()}
                disabled={!dateColumn || busy !== null}
              >
                {/* THE BUTTON SAYS WHICH OF THE TWO THINGS IT IS ABOUT TO DO.
                    An empty date clears rather than writes, and a commit
                    labelled "Set" that unsets nine orders is the kind of
                    surprise a confirm exists to prevent — so the label carries
                    it instead of a second dialog. */}
                {busy === "dates"
                  ? "Saving…"
                  : dateValue === null
                    ? `Clear on ${selected.length}`
                    : `Set on ${selected.length}`}
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Which date
                <span className="text-accent"> *</span>
              </span>
              {/* The record's own nine, in the record's own order — one list,
                  shared, so the two doors cannot drift. */}
              <PickList
                value={dateColumn}
                onPick={setDateColumn}
                variant="field"
                placeholder="Choose one"
                ariaLabel="Which completion date"
                options={COMPLETION_DATES.map((d) => ({ value: d.column, label: d.label }))}
                className="w-full"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Date
              </span>
              {/* `ui/DateField`, never a bare date input: it carries the Safari
                  empty-date apparatus, and this box can legitimately be emptied,
                  which is exactly where that bug bites. */}
              <DateField
                value={dateValue}
                onChange={setDateValue}
                ariaLabel="The date to set"
                boxed
              />
            </label>

            <p className="text-[13px] text-muted">
              {dateValue === null
                ? "Empty — this clears the date."
                : "This writes the same date to every selected order, whatever each one says now."}
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
