"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { deleteBlock, type DeleteBlock } from "@/lib/specialOrderWrites";
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
 * DUPLICATE IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 * It is on the row menu and on the record, where it copies ONE order and lands
 * you on the copy. In bulk it would make a dozen leads and leave you on the
 * list looking at them, which reads as an accident rather than a command — and
 * the thing it is actually for, "same as last year", is one order at a time.
 */
export function SpecialOrderBatchActions({
  selected,
  canWrite,
  onReport,
  children,
}: {
  selected: SpecialOrderRow[];
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
  const [busy, setBusy] = useState<"cancel" | "flags" | "delete" | null>(null);

  /**
   * DECISION 3's BICONDITIONAL DECIDES WHO CAN BE CANCELLED. Migration 051's
   * `special_orders_status_iff_order` makes `status` null exactly when `kind`
   * is not `order`, so cancelling a template is asking the database for a row
   * it will refuse — and a check-constraint refusal is the one failure this
   * app cannot explain in words. They are skipped, and the confirm says so.
   */
  const cancellable = selected.filter((r) => r.kind === "order" && r.status !== "cancelled");
  const flagged = selected.filter((r) => r.flag_reason);

  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;

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
          label: busy === "cancel" ? "Cancelling…" : `Cancel Orders (${cancellable.length})`,
          onSelect: () => void cancelOrders(),
          danger: true,
          disabled: busy !== null || cancellable.length === 0,
          separatorBefore: true,
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

  return <>{children(items)}</>;
}
