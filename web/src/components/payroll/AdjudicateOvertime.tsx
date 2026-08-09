"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { REASON_LABEL, splitTotal, type ShiftProposal, type Split } from "@/lib/overtime";

const BUTTON =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * Decision 2 made operable: the machine proposes, a human decides, and the
 * decision is stored with a reason.
 *
 * NOTHING PREFILLS. The proposal sits beside what is currently decided with a
 * `→` between them, the receiving screen's idiom — an arrow is an unmistakable
 * action where an underlined number is only a hint, and a figure that filled
 * itself in would make merely OPENING a fortnight look like someone had checked
 * it.
 *
 * Two ways out, and both are a decision:
 *   Adopt   our recompute wins. ot_decision = 'recomputed'.
 *   Keep    the source's figures win, deliberately and on the record.
 *           ot_decision = 'manual', because a human chose it — leaving it
 *           'source' would say nobody had looked.
 *
 * The reason is REQUIRED on Keep and optional on Adopt, which is not
 * inconsistency: adopting the rule needs no defence, and overriding it does.
 */
export function AdjudicateOvertime({
  timesheetId,
  decided,
  proposal,
  editable,
  currentDecision,
}: {
  timesheetId: string;
  /** What the row says right now — hours_regular / _overtime / _double_ot. */
  decided: Split;
  proposal: ShiftProposal;
  editable: boolean;
  currentDecision: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const proposed: Split = {
    regular: proposal.regular,
    overtime: proposal.overtime,
    double_ot: proposal.double_ot,
  };

  function decide(next: Split, decision: "recomputed" | "manual", why: string) {
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("timesheets")
        .update({
          hours_regular: next.regular,
          hours_overtime: next.overtime,
          hours_double_ot: next.double_ot,
          ot_decision: decision,
          ot_reason: why.trim() === "" ? null : why.trim(),
          ot_decided_at: new Date().toISOString(),
        })
        .eq("id", timesheetId)
        // .select() IS the check. A write against a closed period matches zero
        // rows and PostgREST returns NO error — verified in the harness as a
        // real authenticated admin. Without this the screen would report a
        // cheerful success on a fortnight it cannot touch.
        .select("id");

      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed(
          "Nothing was changed — the database refused the write. This pay period is probably no longer open."
        );
        return;
      }
      setReason("");
      router.refresh();
    });
  }

  const cell = (s: Split) =>
    `${s.regular.toFixed(2)} · ${s.overtime.toFixed(2)} · ${s.double_ot.toFixed(2)}`;

  /**
   * Two very different things arrive here and the reader must be able to tell
   * them apart in a glance.
   *
   * A bucket MOVED — hours reclassified between regular, overtime and double —
   * is the adjudication this module exists for, and it changes what the person
   * is owed per hour. A drift in the TOTAL with the split untouched is almost
   * always our exact-from-instants arithmetic against the source's rounded
   * decimal (a minute either way), and it deserves a glance, not a decision.
   */
  const splitMoved =
    Math.abs(proposed.overtime - decided.overtime) >= 0.005 ||
    Math.abs(proposed.double_ot - decided.double_ot) >= 0.005;

  return (
    <div className="space-y-2 border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
      <p className="font-semibold">
        {splitMoved
          ? "Our recompute classifies these hours differently."
          : "Our recompute makes the total slightly different."}
      </p>
      {!splitMoved && (
        <p className="text-[13px]">
          The overtime split is unchanged — only the number of hours moved, by{" "}
          {Math.abs(splitTotal(proposed) - splitTotal(decided)).toFixed(2)}. That is
          usually our arithmetic from the punches against the source&rsquo;s own
          rounding, not a disagreement about the shift.
        </p>
      )}

      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-subtle">Now</dt>
        <dd className="tabular-nums">{cell(decided)}</dd>
        <dt className="text-subtle">Proposed</dt>
        <dd className="tabular-nums">
          {cell(proposed)}
          {splitTotal(proposed) === splitTotal(decided) && (
            // The common case, and worth saying: the person is owed the same
            // number of HOURS either way, and only their classification moved.
            <span className="ml-2 text-[12px] text-muted">same total, different split</span>
          )}
        </dd>
        <dt className="text-subtle">Because</dt>
        <dd>
          {proposal.reasons.length
            ? proposal.reasons.map((r) => REASON_LABEL[r]).join(", ")
            : "the daily and weekly rules, applied to the punches"}
        </dd>
      </dl>

      {!editable ? (
        <p className="text-[13px] text-muted">
          This pay period isn&rsquo;t open, so nothing here can be changed.
        </p>
      ) : (
        <div className="space-y-2">
          <TextInput
            size="sm"
            value={reason}
            onValueChange={setReason}
            placeholder="Why (required to keep the imported figures)"
            aria-label="Reason for this overtime decision"
            clearLabel="Clear the reason"
            className="w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(proposed, "recomputed", reason)}
              className={BUTTON}
            >
              {pending ? "Saving…" : "Adopt the recompute"}
            </button>
            <button
              type="button"
              disabled={pending || reason.trim() === ""}
              onClick={() => decide(decided, "manual", reason)}
              className={BUTTON}
            >
              Keep what&rsquo;s there
            </button>
            <span className="text-[12px] text-muted">
              Currently: {currentDecision}
            </span>
          </div>
        </div>
      )}

      {failed && <p className="border border-accent bg-white px-3 py-2 text-[13px] text-accent">{failed}</p>}
    </div>
  );
}
