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
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * Moving a pay period along the ladder, and the one move that goes backwards.
 *
 * Every button here is WHITE. These are a row of peers on a SCREEN, which
 * CLAUDE.md names as exactly the case that is not the `DIALOG_COMMIT_CLASS`
 * exception — the black commit inside the reopen dialog IS that exception,
 * because a panel exists to produce one outcome.
 *
 * Producing the export file is deliberately absent: that is phase 6, and until
 * it exists `exported` is reachable only by someone who has actually produced a
 * file some other way. Marking it by hand would let the status claim something
 * no file backs.
 */
export function PayPeriodActions({
  id,
  status,
  canWrite,
}: {
  id: string;
  status: PayPeriodStatus;
  canWrite: boolean;
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

  const forward = nextStatuses(status);

  /** The stamps each transition owns. Cleared on the way back out. */
  function patchFor(next: PayPeriodStatus): Record<string, unknown> {
    if (next === "closed") return { closed_at: new Date().toISOString() };
    if (next === "exported") return { exported_at: new Date().toISOString() };
    // Stepping review → open isn't a reopen and discards nothing, so it stamps
    // nothing either.
    return {};
  }

  const LABEL: Partial<Record<PayPeriodStatus, string>> = {
    review: "Start review",
    open: "Back to open",
    exported: "Mark exported",
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

        {canReopen(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setReopening(true)}
            className={BUTTON}
          >
            Reopen
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
                onClick={() =>
                  move("open", {
                    reopened_at: new Date().toISOString(),
                    reopen_reason: reason.trim(),
                    // The file this period produced is being discarded, so the
                    // claim that one exists goes with it. Leaving the stamp
                    // would have the record assert an export that no longer
                    // describes these hours.
                    exported_at: null,
                  })
                }
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Reopening…" : "Reopen"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="max-w-[60ch] text-sm">
              This discards the payroll file this period produced. The hours
              become editable again, and anything already frozen onto them —
              tip allocations especially — no longer matches the file someone
              may have sent to Gusto.
            </p>
            <p className="max-w-[60ch] text-sm text-muted">
              If payroll has already RUN, don&rsquo;t reopen. Close the period
              instead and make the correction as an adjustment in the current
              open one, so the fortnight Gusto paid keeps saying what was paid.
            </p>
            <label className="block space-y-1.5">
              <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                Why <span className="text-accent">(required)</span>
              </span>
              <TextInput
                value={reason}
                onValueChange={setReason}
                placeholder="Homebase re-sent the fortnight with three corrected shifts"
                aria-label="Reason for reopening"
                clearLabel="Clear the reason"
                className="h-9 w-full text-sm"
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
