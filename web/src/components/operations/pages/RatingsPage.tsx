"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { Checkbox } from "@/components/ui/Checkbox";
import { TimeField } from "@/components/ui/TimeField";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { FieldLabel, TextField } from "./fields";

export type RatingRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  position: string | null;
  score: number | null;
  note: string | null;
  gotBreak: boolean | null;
  breakStartedAt: string | null;
  breakReason: string | null;
};

const SCORES: PickOption[] = [5, 4, 3, 2, 1, 0].map((n) => ({
  value: String(n),
  label: String(n),
  hint: n === 0 ? "no call / no show" : undefined,
}));

/**
 * Staff ratings — FMP's page 2, at 035's grain.
 *
 * ONE SCORE, not FileMaker's five categories (Mark, 2026-08-28). 035 collapsed
 * the history to one on the measurement that 89% of 40,793 scored ratings were
 * a 5, so the categories never discriminated and the NOTE was always the
 * payload. Zero stays pickable and stays real: 65 historical rows carrying one
 * read "NO CALL/NO SHOW".
 *
 * NAMES COME FROM `special_order_takers`, not from `employees` — 020 gates that
 * table to owner/admin, so a supervisor cannot read a colleague's row at all.
 * That is not a UI choice; a direct query returns zero rows and no error.
 *
 * THE ROSTER IS TYPED. `timesheets` would be the natural source and is
 * unusable: punches are not imported until after the pay period ends, so at
 * 9pm tonight's own shift is not in the table.
 */
export function RatingsPage({
  reportId,
  orgId,
  rows,
  roster,
  positions,
  ratingsDone,
  editable,
}: {
  reportId: string;
  orgId: string;
  rows: RatingRow[];
  roster: PickOption[];
  /** The shop's own vocabulary — `employees.position`, "DF", "Sr. DF". */
  positions: PickOption[];
  /**
   * `task_ratings_done` — "I have rated everybody I meant to".
   *
   * IT LIVES HERE NOW, not on the submit page (Mark, 2026-09-01, on removing
   * that page's checkboxes). It is the one of 070's three task flags that
   * nothing else can observe: the app knows how many ratings exist, and cannot
   * know how many people worked, so "done" is a claim only the supervisor can
   * make. Its two siblings are already ticked where their work happens — page 7
   * and the packet — and this was the odd one out, asked about on a page whose
   * job is to report rather than to collect.
   */
  ratingsDone: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rated = new Set(rows.map((r) => r.employeeId));
  const available = roster.filter((r) => !rated.has(r.value));

  function setDone(next: boolean) {
    startTransition(async () => {
      // `.select()` like every write here: an update matching no policy changes
      // nothing and returns NO error, so a bare one would tick a box that the
      // next refresh puts straight back.
      const { error } = await supabase
        .from("shift_reports")
        .update({ task_ratings_done: next })
        .eq("id", reportId)
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      router.refresh();
    });
  }

  function patch(id: string, values: Record<string, string | number | boolean | null>) {
    startTransition(async () => {
      const { error } = await supabase
        .from("shift_report_ratings")
        .update(values)
        .eq("id", id)
        .select("id");
      if (error) setFailed(error.message);
      router.refresh();
    });
  }

  function add(employeeId: string) {
    startTransition(async () => {
      const { error } = await supabase
        .from("shift_report_ratings")
        .insert({ org_id: orgId, report_id: reportId, employee_id: employeeId })
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      setAdding(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await supabase.from("shift_report_ratings").delete().eq("id", id).select("id");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nobody has been rated yet.</p>
      ) : null}

      {rows.map((row) => (
        <div key={row.id} className="space-y-3 border border-hairline p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-48 flex-1 space-y-2">
              <FieldLabel>Employee</FieldLabel>
              <p className="text-[16px] font-semibold">{row.employeeName}</p>
            </div>
            {/* BOTH PICKERS, BOTH `size="lg"`, both boxed (Mark, 2026-08-28).
                Position was free text and is a vocabulary — `employees.position`
                already holds the shop's own abbreviations. `allowNew`, because
                that list legitimately grows and a role nobody has yet must not
                be unenterable.
                `size="lg"` is what makes them the same height as the fields
                around them; `boxed` is what stops an unset one showing an em
                dash, which the boxed-field convention forbids — inside a box a
                stand-in character reads as a value somebody typed. */}
            <div className="w-48 space-y-2">
              <FieldLabel>Position</FieldLabel>
              <PickList
                value={row.position}
                options={positions}
                onPick={(next) => patch(row.id, { position: next })}
                variant="field"
                size="lg"
                boxed
                allowNew
                className="w-full"
                disabled={!editable}
                ariaLabel={`Position, ${row.employeeName}`}
              />
            </div>
            <div className="w-28 space-y-2">
              <FieldLabel>Score</FieldLabel>
              <PickList
                value={row.score === null ? null : String(row.score)}
                options={SCORES}
                onPick={(next) => patch(row.id, { score: Number(next) })}
                variant="field"
                size="lg"
                boxed
                className="w-full"
                disabled={!editable}
                ariaLabel={`Score, ${row.employeeName}`}
              />
            </div>
            {editable ? (
              <button
                type="button"
                className={DANGER_BUTTON_CLASS}
                onClick={() => remove(row.id)}
                aria-label={`Remove ${row.employeeName} from this report`}
              >
                Remove
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            <FieldLabel>Note</FieldLabel>
            <TextField
              value={row.note}
              onCommit={(next) => patch(row.id, { note: next })}
              disabled={!editable}
              placeholder="How did they do?"
              ariaLabel={`Note, ${row.employeeName}`}
            />
          </div>

          {/* The break question. Unticked plus a reason becomes a
              `break_premiums` decision at Send — the supervisor's answer at the
              shop, rather than somebody retyping it into payroll a fortnight
              later. A reason is REQUIRED when it is unticked, which mirrors
              032's own constraint so the database never has to refuse. */}
          <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-3">
            <Checkbox
              checked={row.gotBreak === true}
              disabled={!editable}
              onChange={(next) => patch(row.id, { got_break: next })}
            >
              Received a 30 minute break
            </Checkbox>
            {/* WHAT TIME (Mark, 2026-08-28: "in fmp we had supervisors enter
                the time of the break"). California's rule is about TIMING — the
                meal has to begin within five hours — so "yes they got one" and
                "at 4:45pm off a 10am start" are different facts and only the
                second one shows a late meal. Stays optional: a supervisor who
                did not note the clock must not have to invent a time. */}
            {row.gotBreak === true ? (
              <div className="w-40 space-y-1">
                <FieldLabel>Started at</FieldLabel>
                <TimeField
                  value={row.breakStartedAt}
                  onChange={(next) => patch(row.id, { break_started_at: next })}
                  variant="field"
                  boxed
                  disabled={!editable}
                  ariaLabel={`Time the break started, ${row.employeeName}`}
                />
              </div>
            ) : null}

            {row.gotBreak === false ? (
              <div className="min-w-64 flex-1 space-y-1">
                <TextField
                  value={row.breakReason}
                  onCommit={(next) => patch(row.id, { break_reason: next })}
                  disabled={!editable}
                  placeholder="Why was the break missed?"
                  ariaLabel={`Reason the break was missed, ${row.employeeName}`}
                />
                {(row.breakReason ?? "").trim() === "" ? (
                  <p className="text-xs">
                    <span className="bg-mark-fill px-1">
                      A reason is needed, or no premium can be recorded
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {editable ? (
        /* THE ONE THING THIS PAGE CANNOT DERIVE. Everything else on the submit
           page's outstanding list is counted from rows; this is a person saying
           they are finished, and it is asked where the work is. */
        <label className="flex items-center gap-3 border-t border-hairline pt-5">
          <Checkbox
            checked={ratingsDone}
            onChange={(next) => setDone(next)}
            label="Staff reviews are done"
          />
          <span className="text-[16px]">
            I&rsquo;ve rated everybody who worked this shift
          </span>
        </label>
      ) : null}

      {editable && available.length > 0 ? (
        adding === null ? (
          <button type="button" className={BUTTON_CLASS} onClick={() => setAdding("")}>
            Rate somebody
          </button>
        ) : (
          <PickList
            value={null}
            options={available}
            onPick={add}
            onClose={() => setAdding(null)}
            defaultOpen
            placeholder="Who worked this shift?"
            variant="field"
            panelMinWidth={300}
            ariaLabel="Add an employee to rate"
          />
        )
      ) : null}
    </div>
  );
}
