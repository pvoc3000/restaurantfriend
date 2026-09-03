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
  editable,
}: {
  reportId: string;
  orgId: string;
  rows: RatingRow[];
  roster: PickOption[];
  /** The shop's own vocabulary — `employees.position`, "DF", "Sr. DF". */
  positions: PickOption[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rated = new Set(rows.map((r) => r.employeeId));
  const available = roster.filter((r) => !rated.has(r.value));

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

      {/* THE COMMAND SITS TOP RIGHT (Mark, 2026-09-01), where every list in
          this app puts its create — `New shift report`, `New timesheet`, the
          create beside a list's title. It was at the FOOT, under the rows, so
          on a shift with six people the way to add a seventh was below all six.

          The row is always here, so nothing moves as employees are added, and
          the picker opens IN PLACE of the button rather than beside it — the
          same swap it always did, now at the top. */}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">
          {rows.length === 0 ? "No Employees" : ""}
        </p>
        {editable ? (
          adding === null ? (
            <button
              type="button"
              className={BUTTON_CLASS}
              // Rendered and DISABLED rather than hidden once everybody is on
              // the list — `NewTimesheet`'s rule, and here it also keeps the
              // header from changing width as the last person is added.
              disabled={available.length === 0}
              title={
                available.length === 0
                  ? "Everybody on the roster is already on this report."
                  : undefined
              }
              onClick={() => setAdding("")}
            >
              Add Employee
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
              ariaLabel="Add an employee to this report"
            />
          )
        ) : null}
      </div>

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

          {/* The break question, and the ONE thing on this report that has to
              be finished before it can be sent (`submitBlockers`).

              IT NO LONGER PAYS ANYBODY. Migration 087 stopped the flush writing
              a `break_premiums` row: the premium is suggested in Timesheets
              from the PUNCHES and recorded by a human clicking, which is where
              that judgement belongs. What is captured here is the testimony —
              whether the meal happened, when, and if not why — because the
              supervisor standing here is the only person who will ever know.

              THE REASON BOX SHOWS WHENEVER THE BOX IS UNTICKED, including on a
              row nobody has touched. `got_break` is three-state and a checkbox
              is two, so an untouched row is null and looks identical to "no" —
              and since null is what the gate counts, a supervisor would
              otherwise be blocked by a row that looks answered. */}
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
                {/* REQUIRED SINCE 2026-09-02. It was optional on the reasoning
                    that a supervisor who did not note the clock must not have to
                    invent one — and Mark's answer is that FMP did not let the
                    report go without it, because California's rule is about
                    WHEN the meal began and a break with no time proves nothing
                    about it. */}
                {(row.breakStartedAt ?? "").trim() === "" ? (
                  <p className="text-sm text-accent">A time is needed</p>
                ) : null}
              </div>
            ) : null}

            {row.gotBreak !== true ? (
              <div className="min-w-64 flex-1 space-y-1">
                <TextField
                  value={row.breakReason}
                  onCommit={(next) => patch(row.id, { break_reason: next })}
                  disabled={!editable}
                  placeholder="Why was the break missed?"
                  ariaLabel={`Reason the break was missed, ${row.employeeName}`}
                />
                {(row.breakReason ?? "").trim() === "" ? (
                  // RED, not the mark colour: this is no longer "worth your
                  // eye", it is the thing that will stop the report being sent.
                  <p className="text-sm text-accent">
                    A reason is needed before this report can be sent
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}

    </div>
  );
}
