"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { DateField } from "@/components/ui/DateField";
import { TextInput } from "@/components/ui/TextInput";
import { WorkflowOffer } from "./WorkflowOffer";
import { afterDateSet, type Consequence, type WorkflowOrder } from "@/lib/orderWorkflow";
import {
  scheduleDraft,
  scheduleTitle,
  type SchedulableLine,
} from "@/lib/specialOrderSchedule";

/**
 * A missing FUNCTION is PostgREST's `PGRST202`, and its own message names a
 * schema cache rather than the thing to do about it. Everywhere else in this
 * app an unapplied migration says so in words instead of leaving somebody to
 * decode an error code.
 */
function readable(message: string, code?: string): string {
  return code === "PGRST202" || /schema cache/i.test(message)
    ? "Scheduling is not available yet — migration 068 has not been applied."
    : message;
}

/**
 * Decision 9: the order's items become a night's production schedule.
 *
 * ---------------------------------------------------------------------------
 * PURCHASER+, AND THE COMMAND IS ABSENT BELOW THAT RATHER THAN DISABLED
 * ---------------------------------------------------------------------------
 * `production_schedules` is purchaser+ on insert and delete (040), while this
 * whole module is supervisor+ (051). So a supervisor can edit the order and
 * cannot commit a kitchen's night, and `schedule_special_order` is SECURITY
 * INVOKER precisely so that is the database's answer rather than a UI opinion.
 * Offering the button anyway would offer a write RLS refuses.
 *
 * Absent rather than greyed is the exception to `NewTimesheet`'s rule, and for
 * that rule's own reason: a disabled control explains itself only on hover and
 * the iPad has none, and here there is no sentence beside it to carry the
 * explanation. What a supervisor sees instead is the LOCK's sentence on the
 * Items tab once somebody else has scheduled it, which is the state that
 * actually affects their work.
 *
 * ---------------------------------------------------------------------------
 * SCHEDULED IS A LOCK, NOT A SYNC (Mark, 2026-08-27)
 * ---------------------------------------------------------------------------
 * There is no "reschedule". Once an order is scheduled its items, event date
 * and kitchen are read-only until somebody unschedules, which deletes the
 * schedule outright. Keeping a live schedule in step with a changing order is a
 * standing obligation; delete-and-rebuild is a rule you can state in a sentence
 * and a reader can predict.
 */
export function ScheduleProduction({
  orderId,
  number,
  title,
  eventDate,
  today,
  kitchenCode,
  sellsCode,
  kitchenAssumed,
  sellsAssumed,
  lines,
  scheduleId,
  scheduleLineCount,
  order,
}: {
  orderId: string;
  number: string;
  title: string | null;
  eventDate: string | null;
  /** The ORG's calendar day. Never `new Date()` — see `lib/today`. */
  today: string;
  /** Already coerced by the caller: kitchen ?? pickup shop. */
  kitchenCode: string | null;
  sellsCode: string | null;
  /** True when the order names no kitchen and the pickup shop stood in. */
  kitchenAssumed: boolean;
  /** True when the order names no pickup shop and the kitchen stood in. */
  sellsAssumed: boolean;
  lines: SchedulableLine[];
  scheduleId: string | null;
  scheduleLineCount: number;
  order: WorkflowOrder;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(eventDate);
  const [name, setName] = useState(scheduleTitle(number, title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  const draft = scheduleDraft(lines);

  /* ======================================================================
   * SCHEDULED — the only command is the way back out
   * ====================================================================== */
  if (scheduleId) {
    return (
      <>
        <div className="flex items-center gap-3">
          <Link
            href={`/schedules/${scheduleId}`}
            className="text-[13px] text-muted underline hover:text-ink"
          >
            {scheduleLineCount > 0
              ? `On the schedule · ${scheduleLineCount} lines`
              : "On the schedule"}
          </Link>
          <button
            type="button"
            className={DANGER_BUTTON_CLASS}
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Unschedule this order?",
                body:
                  `The production schedule for order ${number} is deleted, along with its ` +
                  `${scheduleLineCount} line${scheduleLineCount === 1 ? "" : "s"}, and the ` +
                  `Production scheduled date is cleared. The items unlock so you can edit them.`,
                tone: "danger",
              });
              if (!ok) return;
              setBusy(true);
              setError(null);
              const { error: e } = await supabase.rpc("unschedule_special_order", {
                p_order_id: orderId,
              });
              setBusy(false);
              // The function's own refusals are already worded for a person —
              // it names the print date, or how many lines were counted — so
              // they are shown as they arrive rather than rewritten here.
              if (e) {
                setError(readable(e.message, e.code));
                return;
              }
              router.refresh();
            }}
          >
            Unschedule
          </button>
        </div>
        {/* `basis-full`, because this renders INSIDE `OrderActions`' own flex
            row: these refusals are whole sentences naming a print date or a
            count, and as an ordinary flex item one pushes Duplicate, Flag,
            Cancel and Delete off the side of the screen. Its own line is also
            where a reader expects to find it. */}
        {error ? <p className="basis-full text-sm text-accent">{error}</p> : null}
      </>
    );
  }

  /* ======================================================================
   * NOT SCHEDULED
   * ====================================================================== */

  // Why this order cannot be scheduled, in words. The button STAYS ENABLED and
  // the dialog says it: a disabled control explains itself only on hover and the
  // iPad has none, and both of these need a sentence rather than a shrug.
  const blocker =
    kitchenCode === null
      ? "This order has no kitchen and no pickup shop, so there is nowhere to make it."
      : draft.lines.length === 0
        ? "Nothing on this order reaches the kitchen."
        : null;

  async function commit() {
    if (!date) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("schedule_special_order", {
      p_order_id: orderId,
      p_date: date,
      p_today: today,
      p_title: name.trim(),
      p_lines: draft.lines,
    });
    setBusy(false);
    if (e) {
      setError(readable(e.message, e.code));
      return;
    }
    setOpen(false);
    router.refresh();
    // The stamp landed inside the function, so the question that follows is
    // the same one typing that date by hand would raise — one code path.
    const cs = afterDateSet(order, "order_scheduled_at");
    if (cs.length > 0) setOffer(cs);
  }

  return (
    <>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => {
          setDate(eventDate);
          setName(scheduleTitle(number, title));
          setError(null);
          setOpen(true);
        }}
      >
        Schedule production…
      </button>

      {open ? (
        <Dialog
          title="Schedule production"
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-2xl"
          footer={
            <div className="flex items-center justify-end gap-4">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={busy || !date || Boolean(blocker)}
                onClick={commit}
              >
                Schedule {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"}
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            {blocker ? <p className="text-sm text-accent">{blocker}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Make it on
                </span>
                <DateField value={date} onChange={setDate} variant="field" ariaLabel="Production date" />
                {date && eventDate && date !== eventDate ? (
                  <span className="block text-[12px]">
                    <span className="bg-mark-fill px-1">
                      The event is {eventDate}
                    </span>
                  </span>
                ) : null}
              </label>

              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Called
                </span>
                <TextInput value={name} onValueChange={setName} aria-label="Schedule title" />
              </label>
            </div>

            {/* BOTH COERCIONS ARE NAMED, which is 040's own rule for the
                generator ("names every coercion in its receipt"). Each of these
                columns is NOT NULL on a schedule and nullable on an order — the
                kitchen is filled on 83% of rows and the pickup shop only on
                recent ones — so silence here would let somebody commit a night
                to a shop the order never mentioned. */}
            <p className="text-sm">
              Made at <span className="font-bold">{kitchenCode}</span>, picked up at{" "}
              <span className="font-bold">{sellsCode}</span>.
            </p>
            {kitchenAssumed || sellsAssumed ? (
              <p className="text-[13px]">
                <span className="bg-mark-fill px-1">
                  {kitchenAssumed
                    ? `This order names no kitchen, so ${kitchenCode} will make it.`
                    : `This order names no pickup shop, so the schedule records it as sold at ${sellsCode}.`}
                </span>
              </p>
            ) : null}

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  What the kitchen is asked for
                </span>
                <span className="text-[13px] text-muted">
                  {draft.total} to make
                </span>
              </div>
              <table className="w-full table-fixed">
                <tbody>
                  {draft.lines.map((l) => (
                    <tr key={`${l.item_id}-${l.subtype ?? ""}`} className="align-top">
                      <td className="py-1 pr-3 text-[13px]">
                        {l.item_name}
                        {l.subtype ? (
                          <span className="text-muted"> · {l.subtype}</span>
                        ) : null}
                        {l.note ? (
                          <span className="block text-[12px] text-muted">{l.note}</span>
                        ) : null}
                      </td>
                      <td className="w-16 py-1 text-right text-[13px] tabular-nums">{l.par}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Named, and you go through anyway — `closeReadiness`'s rule. A
                line with no menu item cannot become a schedule line at all
                (`production_schedule_items.item_id` is NOT NULL), so the honest
                thing is to say which and let the rest be made.
                Misc lines get no sentence: decision 5 says silently, because
                they were never production and mentioning them every time is
                how a warning stops being read. */}
            {draft.blocked.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[13px]">
                  <span className="bg-mark-fill px-1">
                    {draft.blocked.length} line{draft.blocked.length === 1 ? "" : "s"} cannot be
                    scheduled and will not reach the kitchen
                  </span>
                </p>
                <ul className="text-[13px] text-muted">
                  {draft.blocked.map((l, i) => (
                    <li key={i}>{l.name} — no production item</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[13px] text-muted">
              While this order is scheduled its items, event date and kitchen are
              read-only. Unschedule to change them.
            </p>

            {error ? <p className="text-sm text-accent">{error}</p> : null}
          </div>
        </Dialog>
      ) : null}

      {offer ? (
        <WorkflowOffer
          orderId={orderId}
          consequences={offer}
          onClose={() => {
            setOffer(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
