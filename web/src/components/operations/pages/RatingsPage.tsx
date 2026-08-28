"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { Checkbox } from "@/components/ui/Checkbox";
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
  editable,
}: {
  reportId: string;
  orgId: string;
  rows: RatingRow[];
  roster: PickOption[];
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
            <div className="w-44 space-y-2">
              <FieldLabel>Position</FieldLabel>
              <TextField
                value={row.position}
                onCommit={(next) => patch(row.id, { position: next })}
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
