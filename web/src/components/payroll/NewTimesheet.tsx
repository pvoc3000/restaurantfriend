"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { resolveLocal } from "@/lib/timeZone";
import { formatPeriodRange, type PayPeriodStatus } from "@/lib/payPeriods";

/**
 * A shift, or paid time nobody worked, entered by hand.
 *
 * WHY THIS EXISTS. Every row in `timesheets` arrived from an import, so there
 * was no way to record anything the clock never saw — a sick day, a shift
 * somebody forgot to punch, a correction agreed after the fact (Mark,
 * 2026-08-05: "a way to add a timesheet manually… what about sick days?").
 * `sick_hours` was an editable column on a shift that could only exist if the
 * person had also worked that day, which is exactly backwards: a sick day is a
 * day they didn't.
 *
 * TWO KINDS, and 028 already had the column. `shift` is worked time and takes
 * punches; `adjustment` is paid time that produced none — sick hours, or a
 * correction into a period the original belongs behind. The kind decides which
 * fields are even shown, because an adjustment with a clock-in would claim
 * somebody was on the floor.
 *
 * WHAT IT DELIBERATELY DOESN'T DO. It writes no overtime split. `hours_regular`
 * is filled from what's entered and `ot_decision` stays `manual` with a reason,
 * so the row states plainly that a human put it there — and the recompute on
 * the list will disagree with it out loud if the hours earn overtime, which is
 * the behaviour decision 2 asks for. It does not touch `source_*` either: there
 * was no source, and writing our own figures into those columns would forge a
 * claim that Homebase said something.
 */
export function NewTimesheet({
  employees,
  locations,
  orgId,
  timeZone,
  period,
}: {
  employees: { id: string; name: string }[];
  locations: { id: string; code: string }[];
  orgId: string;
  timeZone: string;
  /** The period being viewed — the dates are held inside it. */
  period: { id: string; start_date: string; end_date: string; status: PayPeriodStatus } | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [kind, setKind] = useState<"shift" | "adjustment">("shift");
  const [employeeId, setEmployeeId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [workday, setWorkday] = useState<string | null>(period?.start_date ?? null);
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [breakHours, setBreakHours] = useState("");
  const [payKind, setPayKind] = useState<"sick" | "regular">("sick");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  function close() {
    if (pending) return;
    setOpen(false);
    setFailed(null);
    setEmployeeId("");
    setWorkday(period?.start_date ?? null);
    setInTime("");
    setOutTime("");
    setBreakHours("");
    setHours("");
    setNote("");
  }

  /** `9:30am`, `09:30`, `21:05` → minutes since midnight. */
  function parseTime(v: string): number | null {
    const t = v.trim();
    if (t === "") return null;
    let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(t);
    if (m) {
      let h = Number(m[1]) % 12;
      if (/pm/i.test(m[3])) h += 12;
      return h * 60 + Number(m[2] ?? 0);
    }
    m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      return h < 24 && min < 60 ? h * 60 + min : null;
    }
    return null;
  }

  const inMin = parseTime(inTime);
  const outMin = parseTime(outTime);
  const breakNum = breakHours.trim() === "" ? 0 : Number(breakHours);
  const hoursNum = hours.trim() === "" ? null : Number(hours);

  const outsidePeriod =
    period !== null && workday !== null && (workday < period.start_date || workday > period.end_date);

  /** What the punches come to, so the dialog can show it before you commit. */
  const workedPreview = useMemo(() => {
    if (kind !== "shift" || inMin === null || outMin === null) return null;
    // A clock-out earlier than the clock-in is an overnight shift, not an error
    // — the same rule the importer applies (`minOut < minIn`), and the reason
    // the punches decide rather than a second date field.
    const span = (outMin < inMin ? outMin + 1440 : outMin) - inMin;
    if (!Number.isFinite(breakNum) || breakNum < 0) return null;
    return Math.round((span / 60 - breakNum) * 100) / 100;
  }, [kind, inMin, outMin, breakNum]);

  const ready =
    !pending &&
    employeeId !== "" &&
    workday !== null &&
    !outsidePeriod &&
    note.trim() !== "" &&
    (kind === "shift"
      ? locationId !== "" && inMin !== null && outMin !== null && workedPreview !== null && workedPreview > 0
      : hoursNum !== null && Number.isFinite(hoursNum) && hoursNum > 0);

  function add() {
    if (!ready || !workday) return;
    setFailed(null);
    startTransition(async () => {
      const base = {
        org_id: orgId,
        employee_id: employeeId,
        location_id: kind === "shift" ? locationId : locationId || null,
        workday,
        business_date: workday,
        kind,
        source: "manual",
        // No `source_row_key`: that key exists so a re-import can find its own
        // row again, and nothing will ever re-import this one. Leaving it null
        // also keeps a hand-entered row from ever colliding with an import.
        manager_note: note.trim(),
        ot_decision: "manual" as const,
        ot_reason: note.trim(),
      };

      // ONE shape with every key present, nulls and all, rather than a union of
      // two. PostgREST's generated insert type rejects a union whose branches
      // carry different keys, and a uniform row is easier to read besides.
      let clockIn: string | null = null;
      let clockOut: string | null = null;
      let breakMinutes: number | null = null;
      // Sick hours are NOT worked hours: they earn no overtime, they never enter
      // the tip pool, and decision 7 keeps them out of the Gusto file entirely.
      let sick: number | null = null;
      let regular = 0;

      if (kind === "shift") {
        const [y, mo, d] = workday.split("-").map(Number);
        const wall = (minutes: number, dayOffset: number) => {
          const at = new Date(Date.UTC(y, mo - 1, d + dayOffset));
          return {
            year: at.getUTCFullYear(),
            month: at.getUTCMonth() + 1,
            day: at.getUTCDate(),
            hour: Math.floor(minutes / 60),
            minute: minutes % 60,
          };
        };
        const overnight = (outMin as number) < (inMin as number);
        const start = resolveLocal(timeZone, wall(inMin as number, 0));
        const end = resolveLocal(timeZone, wall(outMin as number, overnight ? 1 : 0));
        clockIn = new Date(start.instant).toISOString();
        clockOut = new Date(end.instant).toISOString();
        breakMinutes = Math.round(breakNum * 60);
        // The whole of it as regular. The list's recompute will say so out loud
        // if that's wrong — which is the point of showing a proposal beside a
        // decision rather than computing silently.
        regular = workedPreview ?? 0;
      } else if (payKind === "sick") {
        sick = hoursNum;
      } else {
        regular = hoursNum ?? 0;
      }

      const { data, error } = await supabase
        .from("timesheets")
        .insert({
          ...base,
          clock_in: clockIn,
          clock_out: clockOut,
          unpaid_break_minutes: breakMinutes,
          sick_hours: sick,
          hours_regular: regular,
          hours_overtime: 0,
          hours_double_ot: 0,
        })
        .select("id");

      if (error) {
        setFailed(error.message);
        return;
      }
      // An insert refused by RLS returns no error and no rows. The employee
      // delete taught this: a cheerful false success is worse than a failure.
      if (!data || data.length === 0) {
        setFailed(
          "Nothing was written — the database refused it. This pay period may no longer be open."
        );
        return;
      }
      close();
      router.refresh();
    });
  }

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.name })),
    [employees]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        New timesheet
      </button>

      {open && (
        <Dialog
          title="New timesheet"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              {/* THE OTHER WAY TO GET TIMESHEETS IN (Mark, 2026-08-05: "It adds
                  a click, but is a clear work flow New Timesheet → Import").
                  It replaced the Import button that had been on both the
                  timesheets list and the pay-period list, so there is now one
                  door to importing rather than three to keep in step — and it
                  is the right door, because "I need a timesheet that isn't
                  here" is the question both answers.

                  `mr-auto` puts it at the far left of a `justify-end` footer,
                  away from the commit: it navigates AWAY rather than completing
                  this form, so it must not sit where a second commit would.
                  White, like every button that isn't a panel's own commit. */}
              <Link
                href="/timesheets/import"
                className="mr-auto inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
              >
                Import timesheets
              </Link>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button type="button" onClick={add} disabled={!ready} className={DIALOG_COMMIT_CLASS}>
                {pending ? "Adding…" : kind === "shift" ? "Add timesheet" : "Add adjustment"}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <div className="space-y-1.5">
              <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                What is this
              </span>
              <TabPicker
                ariaLabel="Kind"
                value={kind}
                onChange={(k) => setKind(k as "shift" | "adjustment")}
                options={[
                  { key: "shift", label: "Worked shift" },
                  { key: "adjustment", label: "Paid, not worked" },
                ]}
              />
              <p className="max-w-[60ch] text-[13px] text-muted">
                {kind === "shift"
                  ? "Time on the floor that never got punched. It takes clock times, so the hours come out the same way an imported shift's do."
                  : "Sick hours, or paid time that produced no punch. It carries no clock times, earns no overtime and is excluded from the tip pool."}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-6">
              <label className="space-y-1.5">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                  Employee
                </span>
                <PickList
                  variant="field"
                  ariaLabel="Employee"
                  value={employeeId}
                  onPick={setEmployeeId}
                  options={employeeOptions}
                  placeholder="Choose"
                  className="w-64"
                />
              </label>

              <label className="space-y-1.5">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                  Day
                </span>
                <DateField value={workday} onChange={setWorkday} ariaLabel="Workday" />
              </label>

              <label className="space-y-1.5">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                  Shop
                </span>
                <PickList
                  variant="field"
                  ariaLabel="Shop"
                  value={locationId}
                  onPick={setLocationId}
                  options={locations.map((l) => ({ value: l.id, label: l.code }))}
                  className="w-32"
                />
              </label>
            </div>

            {kind === "shift" ? (
              <div className="flex flex-wrap items-end gap-6">
                <label className="space-y-1.5">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                    Clock in
                  </span>
                  <TextInput
                    value={inTime}
                    onValueChange={setInTime}
                    placeholder="6:00am"
                    aria-label="Clock in"
                    clearLabel="Clear"
                    className="h-9 w-32 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                    Clock out
                  </span>
                  <TextInput
                    value={outTime}
                    onValueChange={setOutTime}
                    placeholder="2:30pm"
                    aria-label="Clock out"
                    clearLabel="Clear"
                    className="h-9 w-32 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                    Break (hours)
                  </span>
                  <TextInput
                    value={breakHours}
                    onValueChange={setBreakHours}
                    placeholder="0.50"
                    aria-label="Unpaid break in hours"
                    clearLabel="Clear"
                    className="h-9 w-28 text-sm"
                  />
                </label>
                <p className="pb-1.5 text-sm text-muted">
                  {workedPreview === null ? (
                    inTime.trim() !== "" || outTime.trim() !== "" ? (
                      <span className="text-accent">Times read like 6:00am or 18:30.</span>
                    ) : (
                      ""
                    )
                  ) : (
                    <>
                      <strong className="tabular-nums">{workedPreview.toFixed(2)}</strong> hours
                      {outMin !== null && inMin !== null && outMin < inMin && " (overnight)"}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-6">
                <div className="space-y-1.5">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                    Paid as
                  </span>
                  <TabPicker
                    ariaLabel="Paid as"
                    value={payKind}
                    onChange={(k) => setPayKind(k as "sick" | "regular")}
                    options={[
                      { key: "sick", label: "Sick" },
                      { key: "regular", label: "Regular" },
                    ]}
                  />
                </div>
                <label className="space-y-1.5">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                    Hours
                  </span>
                  <TextInput
                    value={hours}
                    onValueChange={setHours}
                    placeholder="8.00"
                    aria-label="Hours"
                    clearLabel="Clear"
                    className="h-9 w-28 text-sm"
                  />
                </label>
                {payKind === "sick" && (
                  <p className="max-w-[40ch] pb-1.5 text-[13px] text-muted">
                    Recorded and reconciled here, and deliberately absent from
                    the Gusto file — Gusto already pays sick time, and exporting
                    it would pay it twice.
                  </p>
                )}
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                Why (required)
              </span>
              <TextInput
                value={note}
                onValueChange={setNote}
                placeholder="Forgot to clock in; confirmed with the closing manager"
                aria-label="Reason"
                clearLabel="Clear the reason"
                className="h-9 w-full text-sm"
              />
              {/* Required, like every other decision in this module. A row that
                  someone typed into payroll with no account of why is the one
                  thing an audit cannot answer. */}
            </label>

            {outsidePeriod && period && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">
                That day is outside {formatPeriodRange(period)}, so this row
                would belong to a different pay period than the one you are
                looking at.
              </p>
            )}

            {failed && <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
