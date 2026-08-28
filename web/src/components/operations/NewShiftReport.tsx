"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { SHIFT_SLOT_LABEL, type ShiftSlot } from "@/lib/shiftReports";
import { daysBefore } from "@/lib/today";

const SHIFT_OPTIONS: PickOption[] = (
  ["opening", "mid", "closing", "off_site"] as ShiftSlot[]
).map((s) => ({ value: s, label: SHIFT_SLOT_LABEL[s] }));

/**
 * Starting a shift report.
 *
 * Asks the FMP page-1 fields and nothing else — the rest is the report itself.
 * `NewPlan`'s create-then-go shape: insert, take the id, and land the person on
 * the runner, because "New report" and "start filling it in" are one act.
 */
export function NewShiftReport({
  orgId,
  locationId,
  locationCode,
  today,
  takers,
  existing,
}: {
  orgId: string;
  locationId: string;
  locationCode: string;
  today: string;
  takers: PickOption[];
  existing: { date: string; shift: ShiftSlot }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(today);
  const [shift, setShift] = useState<ShiftSlot>("closing");
  const [supervisor, setSupervisor] = useState<string | null>(null);
  const [nextDay, setNextDay] = useState<string | null>(daysBefore(today, -1));
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = date !== null && !pending;

  // A handover legitimately produces two closing reports for one night, so this
  // WARNS and never blocks — `findPossibleRehires`' treatment, and the reason
  // there is no unique constraint behind it.
  const duplicate = date !== null && existing.some((e) => e.date === date && e.shift === shift);

  function create() {
    startTransition(async () => {
      const { data, error } = await supabase
        .from("shift_reports")
        .insert({
          // Explicitly — design rule 1. No table defaults it, and a WITH CHECK
          // is evaluated BEFORE the NOT NULL, so an omitted org_id arrives as
          // null and reports as an RLS violation rather than a missing column.
          org_id: orgId,
          location_id: locationId,
          kitchen_location_id: locationId,
          report_date: date,
          shift,
          supervisor_employee_id: supervisor,
          next_production_date: nextDay,
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .select("id")
        .single();

      if (error) {
        setFailed(error.message);
        return;
      }
      setOpen(false);
      // NO `router.refresh()` before this push, and that is not a tidy-up.
      // `NewPlan` does refresh-then-push and gets away with it because it
      // navigates WITHIN the (app) group; this crosses into (fullscreen),
      // which is a different layout, and the refresh's re-render of the list
      // can land after the push and put the old tree back — the screen simply
      // does not change when you press the button. There is nothing to refresh
      // anyway: we are leaving, and the list re-fetches on the way back.
      router.push(`/shift-reports/${data.id}/run`);
    });
  }

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
        New shift report
      </button>

      {open ? (
        <Dialog
          title="New shift report"
          onClose={() => setOpen(false)}
          busy={pending}
          width="max-w-lg"
          onSubmit={() => {
            if (ready) create();
          }}
          footer={
            <div className="flex items-center justify-between">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={!ready}
                onClick={create}
              >
                Start the report
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            {failed ? <p className="text-sm text-accent">{failed}</p> : null}

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em]">Date</span>
              <DateField
                value={date}
                onChange={setDate}
                variant="field"
                boxed
                ariaLabel="The date the shift started"
              />
              <span className="block text-xs text-muted italic">
                the day your shift started, not ended!
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em]">Location</span>
              <span className="block text-sm">{locationCode}</span>
            </label>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">
                Supervisor
              </span>
              <PickList
                value={supervisor}
                options={takers}
                onPick={setSupervisor}
                placeholder="Who ran the shift"
                variant="field"
                ariaLabel="The supervisor who ran this shift"
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">Shift</span>
              <PickList
                value={shift}
                options={SHIFT_OPTIONS}
                onPick={(next) => setShift(next as ShiftSlot)}
                variant="field"
                ariaLabel="Which shift"
              />
              {duplicate ? (
                <p className="text-sm">
                  <span className="bg-mark-fill px-1">
                    There is already a {SHIFT_SLOT_LABEL[shift].toLowerCase()} report for that day
                  </span>{" "}
                  <span className="text-muted">
                    — which is right for a handover, and worth a look otherwise.
                  </span>
                </p>
              ) : null}
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em]">
                Next production day
              </span>
              <DateField
                value={nextDay}
                onChange={setNextDay}
                variant="field"
                boxed
                ariaLabel="The next day production happens"
              />
              <span className="block text-xs text-muted italic">
                typically tomorrow, but could be any date in the future.
              </span>
            </label>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
