"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import {
  PAY_PERIOD_STATUS_LABEL,
  PAY_PERIOD_STATUS_HINT,
  canReopen,
  isValidReopenReason,
  nextStatuses,
  type PayPeriodStatus,
} from "@/lib/payPeriods";

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * Moving a pay period along the ladder, and the one move that goes backwards.
 *
 * Every button here is WHITE. These are a row of peers on a SCREEN, which
 * CLAUDE.md names as exactly the case that is not the `DIALOG_COMMIT_CLASS`
 * exception — the black commit inside the reopen dialog IS that exception,
 * because a panel exists to produce one outcome.
 *
 * NEITHER END STEP IS OFFERED HERE. Export Timesheets marks a period exported
 * and Close Pay Period closes it, both in the footer of the panel around these
 * buttons (2026-09-29) — and Close is the only thing that may reach `closed`,
 * because it is the only thing that also takes the snapshot (migration 202
 * refuses a plain status write into or out of `closed`).
 *
 * REOPEN IS FROM `closed`, THE OWNER'S ALONE, AND MEANT TO BE VERY RARE (Mark,
 * 2026-10-13). Nothing before closed is locked any more, so there is nothing
 * else to reopen. It goes through `reopen_pay_period`, which clears the
 * snapshot so a correction made afterwards reaches the next export.
 */
export function PayPeriodActions({
  id,
  status,
  legacyId,
  canWrite,
  canReopen: mayReopen,
}: {
  id: string;
  status: PayPeriodStatus;
  /** A period loaded from FileMaker never reopens — see `canReopen`. */
  legacyId: string | null;
  canWrite: boolean;
  /** `canReopenPayPeriod` — the owner. */
  canReopen: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  if (!canWrite) {
    return (
      <p className="text-sm text-muted">
        {PAY_PERIOD_STATUS_HINT[status]} Only a manager or the owner can move it.
      </p>
    );
  }

  function move(next: PayPeriodStatus, patch: Record<string, unknown> = {}) {
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .update({ status: next, ...patch })
        .eq("id", id)
        // .select() IS the check. With no matching RLS policy Postgres updates
        // zero rows and PostgREST returns NO error, so a bare update reports a
        // cheerful success and the screen re-renders looking unchanged. On a
        // table that gates a fortnight of paid hours that is not acceptable —
        // the order_guide_entries lesson, and the one Finalize learned when a
        // false success also navigated.
        .select("id");

      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed(
          "Nothing was changed — the database refused the write. You may not have permission to run payroll."
        );
        return;
      }
      setReopening(false);
      setReason("");
      router.refresh();
    });
  }

  /** Through the function, never a status write: it is what checks the owner,
   *  clears the snapshot and stamps who and why, in one transaction. */
  function reopen() {
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.rpc("reopen_pay_period", {
        p_period_id: id,
        p_reason: reason.trim(),
      });
      if (error) {
        setFailed(error.message);
        return;
      }
      setReopening(false);
      setReason("");
      router.refresh();
    });
  }

  // Everything the ladder allows EXCEPT `exported`, which only Finalize may
  // reach — see the note at the top of this file.
  // Neither end step is offered here: Export Timesheets marks a period
  // exported and Close Pay Period closes it, both in the panel's footer
  // (2026-09-29) — a second Close here is how a period got left at Exported.
  const forward = nextStatuses(status).filter((next) => next !== "exported" && next !== "closed");

  /** The stamps each transition owns. Cleared on the way back out. `exported`
   *  isn't here because it isn't offered — Finalize stamps it. */
  function patchFor(next: PayPeriodStatus): Record<string, unknown> {
    if (next === "closed") return { closed_at: new Date().toISOString() };
    // Stepping review → open isn't a reopen and discards nothing, so it stamps
    // nothing either.
    return {};
  }

  const LABEL: Partial<Record<PayPeriodStatus, string>> = {
    review: "Start review",
    open: "Back to open",
    closed: "Close period",
  };

  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-sm text-muted">{PAY_PERIOD_STATUS_HINT[status]}</p>

      <div className="flex flex-wrap items-center gap-3">
        {forward.map((next) => (
          <button
            key={next}
            type="button"
            disabled={pending}
            onClick={() => move(next, patchFor(next))}
            className={BUTTON}
          >
            {LABEL[next] ?? PAY_PERIOD_STATUS_LABEL[next]}
          </button>
        ))}

        {mayReopen && canReopen(status, legacyId) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setReopening(true)}
            className={BUTTON}
          >
            Reopen…
          </button>
        )}

        {status === "closed" && (
          // Continues the hint above rather than restating it — the hint
          // already said "Payroll ran. This period is final."
          <p className="text-sm text-muted">
            A correction becomes an adjustment in the current open period rather
            than a change here.
          </p>
        )}
      </div>

      {failed && <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>}

      {reopening && (
        <Dialog
          title="Reopen this pay period"
          onClose={() => !pending && setReopening(false)}
          busy={pending}
          width="max-w-xl"
          footer={
            <>
              <button
                type="button"
                onClick={() => setReopening(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !isValidReopenReason(reason)}
                onClick={reopen}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Reopening…" : "Reopen"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="max-w-[60ch] text-sm">
              Payroll ran on this pay period. Reopening unlocks its tip
              allocations and benefit accruals and puts it back In Review, so
              its timesheets can be edited and its figures are worked out again
              from today&rsquo;s tips and entitlements — they may no longer match
              what Gusto paid.
            </p>
            <p className="max-w-[60ch] text-sm text-muted">
              The usual correction is an adjustment in the current pay period,
              which leaves this one saying what was paid.
            </p>
            <label className="block space-y-1.5">
              <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                Why <span className="text-accent">(required)</span>
              </span>
              <TextInput
                value={reason}
                onValueChange={setReason}
                aria-label="Reason for reopening"
                clearLabel="Clear the reason"
                className="w-full"
              />
            </label>
            <p className="text-[13px] text-muted">
              A stamp with no reason is one nobody can review a year later, which
              is the only question anyone ever asks about a reopened period.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
