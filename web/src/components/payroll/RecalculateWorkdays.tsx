"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { zonedParts } from "@/lib/timeZone";
import { parseWorkdayStart, workdayFor, formatWorkdayStart } from "@/lib/workday";

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:border-hairline disabled:bg-white disabled:text-faint disabled:hover:bg-white disabled:hover:text-faint";

export type RecalcRow = {
  id: string;
  employee_name: string;
  /** Null on an `adjustment` — paid time that produced no punch. */
  clock_in: string | null;
  workday: string;
  /** This person's boundary, as stored. Null means midnight. */
  workday_starts_at: string | null;
};

type Move = { id: string; name: string; punch: string; from: string; to: string };

/**
 * Re-derive `workday` from the punches, without the file.
 *
 * WHY IT EXISTS (Mark, 2026-08-22: "Is there a way to re-calculate the
 * timesheets without re-importing them?"). `workday` is STORED, not derived on
 * read, which is deliberate — a shift keeps the day it was filed under, so
 * changing somebody's `workday_starts_at` cannot silently restate history
 * (061). The cost of that is real: after setting a boundary, the only way to
 * apply it to shifts already imported was to drop the same CSV through the
 * importer again, which needs the file, and the file is the one thing you do
 * not have three weeks later.
 *
 * Everything this needs is already on the row — the punch as an INSTANT, and
 * the person's current boundary — so nothing is re-parsed and nothing is
 * re-matched. It is the production module's Recost in payroll's terms: read
 * today's inputs, restate one derived column.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WRITES, AND EVERYTHING IT DOES NOT
 *
 * It writes `workday`. That is all. 028's trigger then re-derives
 * `workweek_start` from it and 062's re-derives `pay_period_id` from
 * `business_date`, which this never touches — so a row CANNOT leave the period
 * you are looking at, and the punches, the decided hours, `ot_decision` and
 * every note are untouched. It moves which 24 hours the overtime is counted
 * over, and nothing else.
 *
 * The money follows separately and on purpose: moving a workday changes what
 * `proposeOvertime` PROPOSES, and adopting that stays a per-row decision
 * (decision 2 — imported and verified, never computed as authority).
 *
 * A row with NO PUNCH is skipped. An `adjustment`'s workday was typed by hand
 * and there is nothing to derive it from; recalculating it would silently move
 * somebody's sick day to whatever the epoch renders as.
 *
 * IDEMPOTENT: run it twice and the second run finds nothing to do, which is
 * also why the dialog counts before it writes rather than reporting afterwards.
 */
export function RecalculateWorkdays({
  rows,
  timeZone,
  editable,
  canWrite,
  periodLabel,
}: {
  rows: RecalcRow[];
  timeZone: string;
  /** The period is open or in review — 028's write policies. */
  editable: boolean;
  canWrite: boolean;
  periodLabel: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { moves, skipped, boundaries } = useMemo(() => {
    const moves: Move[] = [];
    let skipped = 0;
    const boundaries = new Map<string, string>();
    for (const r of rows) {
      if (r.clock_in === null) {
        skipped += 1;
        continue;
      }
      const start = parseWorkdayStart(r.workday_starts_at);
      if (start !== null && r.workday_starts_at) {
        boundaries.set(r.employee_name, formatWorkdayStart(r.workday_starts_at) ?? "");
      }
      const at = zonedParts(timeZone, new Date(r.clock_in).getTime());
      const punchDate = `${at.year}-${String(at.month).padStart(2, "0")}-${String(at.day).padStart(2, "0")}`;
      const next = workdayFor(punchDate, at.hour * 60 + at.minute, start);
      if (next !== r.workday) {
        moves.push({
          id: r.id,
          name: r.employee_name,
          punch: `${punchDate} ${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`,
          from: r.workday,
          to: next,
        });
      }
    }
    moves.sort((a, b) => (a.punch < b.punch ? -1 : a.punch > b.punch ? 1 : 0));
    return { moves, skipped, boundaries };
  }, [rows, timeZone]);

  function run() {
    if (moves.length === 0 || pending) return;
    setFailed(null);
    startTransition(async () => {
      // Grouped by the day they are moving TO, so a fortnight is a handful of
      // statements rather than one per row.
      const byTarget = new Map<string, string[]>();
      for (const m of moves) {
        const list = byTarget.get(m.to);
        if (list) list.push(m.id);
        else byTarget.set(m.to, [m.id]);
      }

      let written = 0;
      for (const [workday, ids] of byTarget) {
        const { data, error } = await supabase
          .from("timesheets")
          .update({ workday })
          .in("id", ids)
          .select("id");
        if (error) {
          setFailed(error.message);
          return;
        }
        written += (data ?? []).length;
      }

      // A period that is closed matches no RLS policy, changes zero rows and
      // returns NO error — the cheerful false success this codebase keeps
      // relearning. The count is the only thing that can tell you.
      if (written === 0) {
        setFailed(
          "Nothing was written. That happens when the pay period is no longer open, or you do not have permission to change it."
        );
        return;
      }
      if (written < moves.length) {
        setFailed(`Only ${written} of ${moves.length} rows were updated.`);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  if (!canWrite) return null;

  const why = !editable
    ? "This pay period is no longer open, so nothing in it can be changed."
    : moves.length === 0
      ? "Every workday here already matches the punches and the current settings."
      : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        Recalculate…
      </button>

      {open && (
        <Dialog
          title="Recalculate workdays"
          onClose={() => !pending && setOpen(false)}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={pending || !editable || moves.length === 0}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending
                  ? "Updating…"
                  : `Update ${moves.length} shift${moves.length === 1 ? "" : "s"}`}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="max-w-[68ch] text-sm">
              Re-reads every punch in {periodLabel} and works out which day its hours
              belong to, using each person&rsquo;s workday start as it is set today.
              Nothing is re-imported and no file is needed.
            </p>

            <div className="max-w-[68ch] border border-hairline px-4 py-3 text-sm text-muted">
              It changes the <strong className="text-ink">workday</strong> and nothing
              else — not the punches, not the decided hours, not a note. A shift cannot
              move to another pay period, because which paycheck it lands on follows the
              date it was punched on and that never changes.
              {" "}Where a workday moves, the overtime recompute will disagree with the
              stored split and say so on the row; adopting it stays your decision.
            </div>

            {boundaries.size > 0 && (
              <p className="max-w-[68ch] text-sm text-muted">
                {boundaries.size === 1
                  ? `One person in this period has a workday that starts in the afternoon: `
                  : `${boundaries.size} people in this period have a workday that starts in the afternoon: `}
                {[...boundaries.entries()]
                  .map(([name, at]) => `${name} (${at})`)
                  .join(", ")}
                . Everyone else runs midnight to midnight.
              </p>
            )}

            {why ? (
              <p className="max-w-[68ch] border border-hairline bg-neutral-50 px-4 py-3 text-sm">
                {why}
              </p>
            ) : (
              <div className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                  {moves.length} shift{moves.length === 1 ? "" : "s"} would move
                </h3>
                <ul className="max-h-64 space-y-0.5 overflow-y-auto border border-hairline px-4 py-3 text-sm">
                  {moves.map((m) => (
                    <li key={m.id} className="tabular-nums">
                      <span className="text-muted">{m.punch}</span>{" "}
                      {m.name} — {m.from} <span className="text-faint">→</span>{" "}
                      <span className="bg-mark-fill px-1">{m.to}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {skipped > 0 && (
              <p className="max-w-[68ch] text-sm text-muted">
                {skipped} row{skipped === 1 ? "" : "s"} in this period{" "}
                {skipped === 1 ? "has" : "have"} no punch — paid time entered by hand —
                so {skipped === 1 ? "its" : "their"} day was typed rather than derived
                and {skipped === 1 ? "it is" : "they are"} left alone.
              </p>
            )}

            {failed && (
              <p className="max-w-[68ch] border border-accent px-4 py-3 text-sm text-accent">
                {failed}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
