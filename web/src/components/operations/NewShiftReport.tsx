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
 * Asks the FMP page-1 fields MINUS THE SUPERVISOR — the rest is the report
 * itself. `NewPlan`'s create-then-go shape: insert, take the id, and land the
 * person on the runner, because "New report" and "start filling it in" are one
 * act.
 *
 * IT NEVER ASKS WHO YOU ARE (Mark, 2026-09-01: "why are we setting the
 * supervisor who's filling out the report? Why not just use whoever is logged
 * in?"). Migration 080's `my_employee_id` resolves the signed-in member to
 * their employee row — `employees` READ is owner/admin, so a supervisor cannot
 * do that any other way — and the id is written with the row.
 *
 * Measured before the change: 3 of 3 app users are linked to an employee
 * record, so this really does fill itself for everybody rather than for one
 * person with the rest silently getting nothing; and 4 of the 5 real reports
 * already had supervisor = author.
 *
 * THE FIFTH IS WHY THE FIELD SURVIVES ON PAGE 1. Mark filed the 2026-08-28
 * closing report for somebody else, which is a handover — the same case 070
 * declined a unique constraint over. The default is the login; the correction
 * is one page away. A null `myEmployeeId` (a login with no HR record) simply
 * leaves the column null, which is what that picker is for.
 *
 * IT LANDS ON PAGE 2 (Mark, same day): page 1 restates this dialog, so
 * arriving on it means reading the same five facts twice in ten seconds. Back
 * still reaches it — this skips a page rather than hiding one.
 */
export function NewShiftReport({
  orgId,
  locationId,
  locationCode,
  today,
  myEmployeeId,
  existing,
}: {
  orgId: string;
  locationId: string;
  locationCode: string;
  today: string;
  /**
   * The signed-in member's own `employees.id`, from migration 080's
   * `my_employee_id`, or null when their login has no HR record.
   */
  myEmployeeId: string | null;
  existing: { date: string; shift: ShiftSlot }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(today);
  const [shift, setShift] = useState<ShiftSlot>("closing");
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
          // Whoever is logged in, resolved once on the server. Null is a real
          // answer and not a failure — see the note at the top.
          supervisor_employee_id: myEmployeeId,
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
      router.push(`/shift-reports/${data.id}/run?page=2`);
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
          // A FRAGMENT, not a wrapper — `ui/Dialog`'s own footer is already
          // `flex justify-end gap-4`, so a `justify-between` div inside it is
          // content-sized and the two buttons end up flush against each other
          // with no gap at all. Every other caller passes them bare.
          footer={
            <>
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
            </>
          }
        >
          {/* ONE SIZE FOR EVERY FIELD (Mark, 2026-08-28), the same call as
              page 1 of the report this opens. `DateField variant="field"` is
              48px natively while a `PickList` is 36, so a column of five
              controls came out at two heights and two widths.
              48 rather than the app's usual 36 because of where this leads: the
              next thing the person sees is the runner, which is tablet-first,
              and a dialog that steps down 12px on the way in reads as two
              different apps. `size="lg"` also brings 16px type, below which iOS
              Safari zooms the page on focus. */}
          <div className="space-y-5">
            {failed ? <p className="text-sm text-accent">{failed}</p> : null}

            {/* Location leads and is stated, not asked — page 1's order. */}
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">
                Location
              </span>
              <p className="text-[16px] font-semibold">{locationCode}</p>
            </div>

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

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">Shift</span>
              <PickList
                value={shift}
                options={SHIFT_OPTIONS}
                onPick={(next) => setShift(next as ShiftSlot)}
                variant="field"
                size="lg"
                boxed
                className="w-full"
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

            {/* ONE TRUE SENTENCE COVERING TWO CAUSES. `myEmployeeId` is null
                either because this login has no HR record or because migration
                080 has not been applied — and in both cases the consequence is
                the same and is the only thing worth saying: the report starts
                with no supervisor, and page 1 is where you set one. Silence
                here would read as the field having filled itself. */}
            {myEmployeeId === null ? (
              <p className="text-sm text-muted">
                This report will start with no supervisor named — your login
                isn&rsquo;t linked to an employee record. You can set one on the
                first page.
              </p>
            ) : null}

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
