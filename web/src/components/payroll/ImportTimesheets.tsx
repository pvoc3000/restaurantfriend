"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList } from "@/components/ui/PickList";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { planImport, type ImportPlan, type ParsedShift } from "@/lib/homebaseImport";
import { resolveLocal } from "@/lib/timeZone";
import { parseWorkdayStart, workdayFor } from "@/lib/workday";
import {
  formatPeriodRange,
  nextPeriodAfter,
  overlapsAny,
  payrollSettings as readPayrollSettings,
  periodContaining,
  type PayPeriodStatus,
  type PeriodRange,
} from "@/lib/payPeriods";

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

const ACCEPT = ["text/csv", "application/vnd.ms-excel", "text/plain"] as const;

export type ImportEmployee = {
  id: string;
  name: string;
  legacy_id: string | null;
  homebase_id: string | null;
  /** Migration 061. Null means midnight, which is everyone but the kitchen. */
  workday_starts_at: string | null;
};

export type ImportPeriod = {
  id: string;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
};

type Matched = {
  shift: ParsedShift;
  employeeId: string | null;
  /** Which id got the match — for the report, and for the screen. */
  via: "homebase_id" | "legacy_id" | null;
  /**
   * The California workday these hours belong to.
   *
   * DECIDED HERE, not in `planImport`, and that placement is the whole design:
   * the workday depends on the EMPLOYEE (migration 061), and the parser has no
   * employees — it reads a CSV. Deciding it alongside the match also means the
   * manual links below recompute it for free; a resolver passed into the parser
   * would leave the workday fixed at plan time, so linking an unmatched person
   * afterwards would import their shifts with the phantom-overtime day this
   * whole change exists to remove.
   */
  workday: string;
  /** The boundary that produced it, in minutes; null = midnight. For the screen. */
  workdayStart: number | null;
};

/**
 * Drop → plan → commit, with NOTHING WRITTEN BEFORE COMMIT.
 *
 * The file is parsed in the browser, matched against employees the server
 * already sent, and shown as a plan. Only pressing Commit uploads the file and
 * writes any rows. That is not merely tidy: an importer that writes as it reads
 * leaves half a fortnight behind when it hits a row it can't read, and the
 * fortnight it half-wrote is payroll.
 */
export function ImportTimesheets({
  employees,
  periods,
  locations,
  orgId,
  timeZone,
  payrollSettings: rawPayrollSettings,
}: {
  employees: ImportEmployee[];
  periods: ImportPeriod[];
  locations: { id: string; code: string }[];
  orgId: string;
  timeZone: string;
  /** `orgs.settings.payroll` — the cadence, for proposing a missing period. */
  payrollSettings?: unknown;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Manual links the reader has made, keyed by the file's Payroll ID or name. */
  const [links, setLinks] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  async function take(f: File) {
    setError(null);
    setDone(null);
    setFile(f);
    setPlan(planImport(await f.text()));
  }

  /* -- matching ---------------------------------------------------------- */

  /** For reading a matched person's workday boundary back out. */
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const byLegacy = useMemo(
    () => new Map(employees.filter((e) => e.legacy_id).map((e) => [String(e.legacy_id).trim(), e])),
    [employees]
  );
  const byHomebase = useMemo(
    () => new Map(employees.filter((e) => e.homebase_id).map((e) => [String(e.homebase_id).trim(), e])),
    [employees]
  );

  /**
   * `homebase_id` first, then `legacy_id`.
   *
   * Measured on both real files, `Payroll ID` IS `legacy_id` — 18 of 18 at DF01
   * and 11 of 11 at DF02 — so the fallback carries every match today. The
   * explicit column wins where it is set, because it exists precisely to record
   * a pairing the legacy id can't express: someone hired since the FileMaker
   * era, or a Payroll ID that was retyped.
   *
   * Never a NAME. A name match pays the wrong Sanchez.
   */
  function matchOne(s: ParsedShift): Matched {
    const key = s.payrollId ?? "";
    const settle = (employeeId: string | null, via: Matched["via"]): Matched => {
      const start = parseWorkdayStart(
        employeeId ? (byId.get(employeeId)?.workday_starts_at ?? null) : null
      );
      return {
        shift: s,
        employeeId,
        via,
        workday: workdayFor(s.punchDate, s.clockInMinutes, start),
        workdayStart: start,
      };
    };

    const manual = links[key || s.name];
    if (manual) return settle(manual, "homebase_id");
    if (key) {
      const hb = byHomebase.get(key);
      if (hb) return settle(hb.id, "homebase_id");
      const lg = byLegacy.get(key);
      if (lg) return settle(lg.id, "legacy_id");
    }
    // An unmatched shift keeps the punch date; it cannot be committed anyway.
    return settle(null, null);
  }

  const matched = useMemo(
    () => (plan ? plan.shifts.map(matchOne) : []),
    // matchOne closes over the id maps and the manual links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, byLegacy, byHomebase, links]
  );

  const unmatchedPeople = useMemo(() => {
    if (!plan) return [];
    const out = new Map<string, { key: string; name: string; payrollId: string | null; shifts: number }>();
    for (const m of matched) {
      if (m.employeeId) continue;
      const key = m.shift.payrollId ?? m.shift.name;
      const e = out.get(key);
      if (e) e.shifts += 1;
      else out.set(key, { key, name: m.shift.name, payrollId: m.shift.payrollId, shifts: 1 });
    }
    return [...out.values()];
  }, [plan, matched]);

  /* -- where it lands ----------------------------------------------------- */

  const location = plan?.locationCode
    ? (locations.find((l) => l.code === plan.locationCode) ?? null)
    : null;

  // Which fortnight owns these shifts. Looked up from the file's own dates, so
  // the screen can say "that period is closed" before anything is written
  // rather than letting 028's policy silently refuse every row.
  const targetPeriods = useMemo(() => {
    if (!plan) return [];
    // The EFFECTIVE workday, not the punch date: a boundary can move a shift
    // into the next fortnight, and that is the fortnight whose status matters.
    const days = new Set(matched.map((m) => m.workday));
    return periods.filter((p) => [...days].some((d) => d >= p.start_date && d <= p.end_date));
  }, [plan, matched, periods]);

  const blockedPeriods = targetPeriods.filter(
    (p) => p.status !== "open" && p.status !== "review"
  );

  /**
   * The period this file needs, when none exists yet.
   *
   * Blocking with "no pay period covers these dates" and no way forward was a
   * dead end (Mark, 2026-08-05, asking whether creating one manually is even
   * necessary). It stays a pay_periods row rather than something the import
   * conjures implicitly — the boundary is org configuration (design rule 2) and
   * `nextPeriodAfter` owns the arithmetic — but the screen can now propose it
   * and open it for you, which is the whole of what was missing.
   *
   * The proposal CONTINUES THE CADENCE rather than wrapping the file's dates: it
   * steps forward from the last period that exists until one covers the file's
   * earliest workday, so importing an out-of-sequence export can't quietly
   * invent a period that leaves a gap behind it.
   */
  const settings = useMemo(() => readPayrollSettings(rawPayrollSettings), [rawPayrollSettings]);

  /**
   * Workdays no pay period covers — INCLUDING days a workday boundary moved a
   * shift into.
   *
   * This exists because of a hole 061 opened and nothing else would have
   * caught. Homebase exports BY payroll period, so the file's last day is the
   * fortnight's last day; a kitchen shift starting after 14:00 on it belongs to
   * the NEXT fortnight, which may not have been opened yet. The old test was
   * `targetPeriods.length > 0`, which is true as soon as ANY shift lands
   * somewhere — so the screen offered nothing, the row wrote with a null
   * `pay_period_id` (028's `timesheet_period_editable(null)` is deliberately
   * TRUE), no trigger ever fills it in, and `/timesheets` fetches by
   * `pay_period_id`. The shift would be invisible and never paid.
   *
   * Measured on the real 2026-08-03 → 08-16 export: two shifts, Erick Mejia at
   * 18:00 and Eddy Salazar at 21:01 on the closing Sunday.
   */
  const uncoveredDays = useMemo(() => {
    const days = new Set(matched.filter((m) => m.employeeId).map((m) => m.workday));
    return [...days]
      .filter((d) => !periods.some((p) => d >= p.start_date && d <= p.end_date))
      .sort();
  }, [matched, periods]);

  const proposedPeriod: PeriodRange | null = useMemo(() => {
    if (!plan || plan.shifts.length === 0 || uncoveredDays.length === 0) return null;
    const earliest = uncoveredDays[0];
    if (!earliest) return null;

    const last = periods.reduce<ImportPeriod | null>(
      (best, p) => (best === null || p.end_date > best.end_date ? p : best),
      null
    );
    if (!last) return periodContaining(earliest, settings);
    // Bounded: a file more than ~4 years past the last period is not something
    // to walk a loop over, and proposing nothing is the honest answer there.
    let range = nextPeriodAfter(last.end_date, settings);
    for (let i = 0; i < 120 && range.end_date < earliest; i++) {
      range = nextPeriodAfter(range.end_date, settings);
    }
    if (earliest < range.start_date || earliest > range.end_date) return null;
    return overlapsAny(range, periods) ? null : range;
  }, [plan, uncoveredDays, periods, settings]);

  const [openingPeriod, setOpeningPeriod] = useState(false);

  function openProposedPeriod() {
    if (!proposedPeriod || openingPeriod) return;
    setOpeningPeriod(true);
    setError(null);
    startTransition(async () => {
      const { data, error: e } = await supabase
        .from("pay_periods")
        // `org_id` is not optional here: 027's insert policy is
        // `with check (user_has_role(org_id, …))`, and a WITH CHECK runs BEFORE
        // the NOT NULL constraint — so omitting it fails as an RLS violation
        // naming the policy rather than the column. See NewPayPeriod.
        .insert({ ...proposedPeriod, org_id: orgId, status: "open" })
        .select("id");
      setOpeningPeriod(false);
      if (e || !data || data.length === 0) {
        setError(
          e?.message ??
            "The pay period was not created — opening one is a manager's write."
        );
        return;
      }
      // The plan is held in state and the periods come from the server, so the
      // refresh is what lets the blocked section resolve itself.
      router.refresh();
    });
  }

  /** Shifts a workday boundary moved off their punch date, for the screen. */
  const shiftedWorkdays = useMemo(
    () => matched.filter((m) => m.employeeId && m.workday !== m.shift.punchDate),
    [matched]
  );

  const canCommit =
    plan !== null &&
    file !== null &&
    plan.shifts.length > 0 &&
    location !== null &&
    blockedPeriods.length === 0 &&
    targetPeriods.length > 0 &&
    // Every workday must land in a period that EXISTS. Without this a shift a
    // boundary pushed past the fortnight's end writes with a null
    // `pay_period_id` and is never seen again — see `uncoveredDays`.
    uncoveredDays.length === 0 &&
    !pending;

  /* -- commit -------------------------------------------------------------- */

  function commit() {
    if (!canCommit || !plan || !file || !location) return;
    setError(null);
    startTransition(async () => {
      // 1. The import row first, so the file has somewhere to belong and a
      //    failure halfway leaves a record of the attempt rather than an
      //    orphaned object nobody can explain.
      const { data: run, error: runErr } = await supabase
        .from("timesheet_imports")
        .insert({
          org_id: orgId,
          location_id: location.id,
          file_name: file.name,
          content_type: file.type || "text/csv",
          byte_size: file.size,
          period_start: plan.periodStart,
          period_end: plan.periodEnd,
          status: "parsed",
          rows_read: plan.shifts.length + plan.refused.length,
        })
        .select("id")
        .single();

      if (runErr || !run) {
        setError(runErr?.message ?? "Could not start the import.");
        return;
      }

      // 2. The file itself. {org_id}/{import_id}/… — the first folder segment
      //    is what 018's storage_folder_org authorises on.
      const path = `${orgId}/${run.id}/${crypto.randomUUID()}.csv`;
      const { error: upErr } = await supabase.storage
        .from("timesheet-imports")
        .upload(path, file, { contentType: file.type || "text/csv" });
      if (upErr) {
        setError(`The file could not be stored: ${upErr.message}`);
        return;
      }

      // 3. The shifts. Upsert on (org_id, source, source_row_key) so re-reading
      //    the same export updates rather than duplicating — which matters,
      //    because Homebase emits no shift id and a fortnight gets re-exported
      //    every time somebody fixes a punch.
      const rows = matched
        .filter((m) => m.employeeId)
        .map((m) => {
          const s = m.shift;
          const inAt = resolveLocal(timeZone, wall(s.punchDate, s.clockInMinutes));
          const outAt =
            s.clockOutDate === null || s.clockOutMinutes === null
              ? null
              : resolveLocal(timeZone, wall(s.clockOutDate, s.clockOutMinutes));

          // THE PUNCH DATE, never the workday. This is the upsert's conflict
          // target, and a workday can MOVE when somebody's boundary changes —
          // which would mint a new key for a row that already exists and
          // duplicate it instead of updating it. Verified against the live
          // database before 061: field [1] equals `workday` on 321 of 321
          // Homebase rows and 1000 of 1000 FileMaker rows, so keying on the
          // punch date leaves every existing key byte-identical.
          const natural = [
            s.payrollId ?? s.name,
            s.punchDate,
            s.source.clockInTime ?? "-",
            s.source.clockOutTime ?? "-",
            location.code,
          ].join("|");

          return {
            org_id: orgId,
            employee_id: m.employeeId as string,
            location_id: location.id,
            // The two diverge for the first time here. `workday` owns the
            // California overtime day and follows the person's boundary;
            // `business_date` stays the date the punch fell on, so tip pools
            // and shift reports are untouched. 028 split them for exactly this.
            workday: m.workday,
            business_date: s.punchDate,
            clock_in: new Date(inAt.instant).toISOString(),
            clock_out: outAt ? new Date(outAt.instant).toISOString() : null,
            source_hours_regular: s.source.regularHours,
            source_hours_overtime: s.source.overtimeHours,
            source_hours_double_ot: s.source.doubleOtHours,
            source_hours_paid: s.source.totalPaidHours,
            // What the source SAID it deducted — the total, which is the figure
            // that reconciles with Homebase's own Actual hours.
            source_break_minutes: s.unpaidBreakMinutes,
            // The historical posture: take the source's word for it, and record
            // that nobody has re-checked. The overtime queue on /timesheets is
            // where that gets argued with.
            hours_regular: s.source.regularHours,
            hours_overtime: s.source.overtimeHours,
            hours_double_ot: s.source.doubleOtHours,
            ot_decision: "source",
            // THE TOTAL UNPAID BREAK, not the length of the one recorded meal.
            // `workedHours` subtracts this from the clock span, so reading the
            // punch pair's 30 min on a shift Homebase deducted a full hour for
            // made us 0.50h long — and the recompute then proposed half an hour
            // of extra DOUBLE time (Mark, 2026-08-05, on Gaspar López 07-23).
            unpaid_break_minutes: s.unpaidBreakMinutes,
            scheduled_hours: s.source.scheduledHours,
            // "01 Overnight Baker" → "Overnight Baker". The FMP export no longer
            // carries FileMaker's numbering; the Homebase Role column still does.
            position: s.role ? s.role.replace(/^\d+\s+/, "") : null,
            employee_note: s.source.employeeNote,
            manager_note: s.source.managerNote,
            source: "homebase",
            source_row_key: natural,
            source_payload: {
              ...s.source,
              // THE CANONICAL SPELLING, beside the raw row.
              //
              // `payrollWorksheet.toBreakShift` reads the meal punches out of
              // this object, and the FileMaker loader writes them as
              // `break_start` / `break_end` / `time_in`. Spreading `s.source`
              // alone gave them Homebase's camelCase names, so the break rules
              // saw no punches on any imported shift: `late_meal` could never
              // fire, and a missed meal was inferred from the deduction alone
              // (Mark, 2026-08-05). The reader tolerates both spellings so the
              // fortnight already imported works, but writing the canonical
              // names is what stops the two sources drifting again.
              time_in: s.source.clockInTime,
              time_out: s.source.clockOutTime,
              break_start: s.source.breakStart,
              break_end: s.source.breakEnd,
              date_start: s.source.clockInDate,
              date_end: s.source.clockOutDate,
              import_source: "homebase",
              matched_via: m.via,
              // Which boundary produced this row's workday, so a shift can
              // explain itself later. Absent means midnight.
              ...(m.workdayStart !== null ? { workday_start: m.workdayStart } : {}),
              ...(inAt.ambiguity !== "none" ? { local_time_ambiguity: inAt.ambiguity } : {}),
            },
            stitched: s.stitched,
          };
        });

      const { data: written, error: rowErr } = await supabase
        .from("timesheets")
        .upsert(rows, { onConflict: "org_id,source,source_row_key" })
        .select("id");

      if (rowErr) {
        setError(`The shifts could not be written: ${rowErr.message}`);
        await supabase
          .from("timesheet_imports")
          .update({ status: "discarded", report: { error: rowErr.message } })
          .eq("id", run.id);
        return;
      }

      await supabase
        .from("timesheet_imports")
        .update({
          status: "committed",
          storage_path: path,
          rows_matched: rows.length,
          rows_created: written?.length ?? 0,
          rows_refused: plan.refused.length,
          report: {
            refused: plan.refused,
            skipped: plan.skipped,
            unmatched: unmatchedPeople,
            stitched: plan.stitchedCount,
            crossing: plan.crossingCount,
            location_code: plan.locationCode,
          },
        })
        .eq("id", run.id);

      setDone(`${written?.length ?? 0} shifts imported.`);
      setPlan(null);
      setFile(null);
      router.refresh();
    });
  }

  function wall(dateISO: string, minutes: number) {
    const [y, mo, d] = dateISO.split("-").map(Number);
    return { year: y, month: mo, day: d, hour: Math.floor(minutes / 60), minute: minutes % 60 };
  }

  /** Link an unmatched person, writing `homebase_id` so the next import matches. */
  function link(key: string, employeeId: string) {
    setLinks((prev) => ({ ...prev, [key]: employeeId }));
    startTransition(async () => {
      const { error: e } = await supabase
        .from("employees")
        .update({ homebase_id: key })
        .eq("id", employeeId)
        .select("id");
      if (e) setError(`The link was made for this import but not saved: ${e.message}`);
    });
  }

  /* -- render -------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      <FileDropZone
        accept={ACCEPT}
        label="Read this timesheet export"
        onFiles={(fs) => fs[0] && take(fs[0])}
        onReject={() => setError("That needs to be the CSV Homebase exports, not a spreadsheet or a PDF.")}
        className="block"
      >
        <div className="flex flex-wrap items-center gap-4 border border-hairline px-4 py-6">
          <button type="button" onClick={() => inputRef.current?.click()} className={BUTTON}>
            Choose a file
          </button>
          <span className="text-sm text-muted">
            {file ? file.name : "or drop a Homebase timesheet export here. Nothing is written until you commit."}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && take(e.target.files[0])}
          />
        </div>
      </FileDropZone>

      {error && <p className="border border-accent px-4 py-3 text-sm text-accent">{error}</p>}
      {done && <p className="border border-ink bg-go px-4 py-3 text-sm text-ink">{done}</p>}

      {plan && (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionHeading>What this file says</SectionHeading>
            <dl className="grid max-w-xl grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-subtle">Shop</dt>
              <dd>
                {plan.locationCode ?? "—"}
                {plan.locationCode && !location && (
                  <span className="ml-2 bg-mark-fill px-1">
                    no location in this org has that code
                  </span>
                )}
              </dd>
              <dt className="text-subtle">Payroll period</dt>
              <dd className="tabular-nums">
                {plan.periodStart && plan.periodEnd
                  ? `${plan.periodStart} → ${plan.periodEnd}`
                  : "not stated in the file"}
              </dd>
              <dt className="text-subtle">Shifts</dt>
              <dd className="tabular-nums">{plan.shifts.length}</dd>
              <dt className="text-subtle">People</dt>
              <dd className="tabular-nums">{plan.people.length}</dd>
              <dt className="text-subtle">Crossing midnight</dt>
              <dd className="tabular-nums">
                {plan.crossingCount}
                {plan.stitchedCount > 0 && (
                  <span className="ml-2 bg-mark-fill px-1">
                    {plan.stitchedCount} reassembled from split segments
                  </span>
                )}
              </dd>
            </dl>
          </section>

          <section className="space-y-3">
            <SectionHeading>Where it lands</SectionHeading>
            {targetPeriods.length === 0 ? (
              <div className="space-y-3 border border-accent px-4 py-3">
                <p className="max-w-[72ch] text-sm text-accent">
                  No pay period covers these dates, so these shifts would have
                  nowhere to belong.
                </p>
                {proposedPeriod ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={openProposedPeriod}
                      disabled={pending || openingPeriod}
                      className={BUTTON}
                    >
                      {openingPeriod ? "Opening…" : `Open ${formatPeriodRange(proposedPeriod)}`}
                    </button>
                    <span className="text-sm text-muted tabular-nums">
                      {proposedPeriod.start_date} → {proposedPeriod.end_date}, continuing
                      the payroll calendar.
                    </span>
                  </div>
                ) : (
                  <p className="max-w-[72ch] text-sm text-muted">
                    These dates don&rsquo;t sit on the next period in the
                    sequence, so opening one here would leave a gap or an
                    overlap. Open it with New pay period on the timesheets
                    screen, where both dates are editable.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {targetPeriods.map((p) => (
                  <li key={p.id}>
                    {formatPeriodRange(p)} —{" "}
                    {p.status === "open" || p.status === "review" ? (
                      <span className="text-muted">{p.status}</span>
                    ) : (
                      <span className="bg-mark-fill px-1">
                        {p.status}, so shifts cannot be written into it
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {blockedPeriods.length > 0 && (
              <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
                This file covers a pay period that is no longer open. Importing it
                would silently write nothing — the database refuses the rows and
                reports no error — so the commit is blocked instead.
              </p>
            )}
            {shiftedWorkdays.length > 0 && (
              <p className="max-w-[72ch] text-sm">
                <span className="bg-mark-fill px-1">
                  {shiftedWorkdays.length} shift{shiftedWorkdays.length === 1 ? "" : "s"}
                </span>{" "}
                start after their own workday begins, so the hours count toward the
                NEXT day — which is the point of a workday that starts in the
                afternoon. The punch itself, and the day its tips and shift report
                belong to, are unchanged.
              </p>
            )}
            {uncoveredDays.length > 0 && targetPeriods.length > 0 && (
              <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
                {uncoveredDays.length === 1
                  ? `A shift belongs to the workday of ${uncoveredDays[0]}, which no pay period covers.`
                  : `Some shifts belong to the workdays of ${uncoveredDays[0]} – ${uncoveredDays[uncoveredDays.length - 1]}, which no pay period covers.`}{" "}
                That happens when a workday starting in the afternoon carries the
                last evening of a fortnight into the next one. Open the period they
                need before committing — written as they are, those rows would
                belong to no period at all and would never appear on the
                timesheets screen again.
              </p>
            )}
          </section>

          {unmatchedPeople.length > 0 && (
            <section className="space-y-3">
              <SectionHeading count={unmatchedPeople.length}>Unmatched people</SectionHeading>
              <p className="max-w-[72ch] text-sm text-muted">
                Their shifts will be SKIPPED unless you link them. Linking writes
                the Payroll ID onto the employee, so every import after this one
                matches them on its own — never on a name, which pays the wrong
                Sanchez.
              </p>
              <ul className="space-y-2">
                {unmatchedPeople.map((p) => (
                  <li key={p.key} className="flex flex-wrap items-center gap-3 border border-hairline px-4 py-2 text-sm">
                    <strong>{p.name}</strong>
                    <span className="text-muted">
                      Payroll ID {p.payrollId ?? "—"} · {p.shifts} shift{p.shifts === 1 ? "" : "s"}
                    </span>
                    <PickList
                      variant="field"
                      ariaLabel={`Link ${p.name}`}
                      value={links[p.key] ?? ""}
                      onPick={(id) => id && link(p.key, id)}
                      options={[
                        { value: "", label: "Skip these shifts" },
                        ...employees.map((e) => ({ value: e.id, label: e.name })),
                      ]}
                      className="w-72"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ONE LINE, not a list (Mark, 2026-08-05: "all the warning text when
              importing says a lot of shifts with no punch in - seems like
              noise"). He is right, and the noise was self-inflicted: these rows
              are the NORMAL case — Homebase prints a row for every scheduled
              day whether or not anybody punched, and the ten in a real DF01
              fortnight are mostly salaried people who never punch at all.
              Giving each one its own line put ten warnings in front of someone
              whose file was perfect, which teaches them to skim the section
              that also holds the rows that genuinely failed.

              So it states the count and hides the detail behind a disclosure.
              Nothing is dropped — the report written to `timesheet_imports`
              still carries every row — it just stops shouting. */}
          {plan.skipped.length > 0 && (
            <details className="border border-hairline px-4 py-3">
              <summary className="cursor-pointer text-sm text-muted marker:text-faint">
                {plan.skipped.length} scheduled{" "}
                {plan.skipped.length === 1 ? "day holds" : "days hold"} no punches
                — nothing to import from {plan.skipped.length === 1 ? "it" : "them"}.
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {plan.skipped.map((r) => (
                  <li key={`${r.line}-${r.name}`}>
                    <span className="tabular-nums">line {r.line}</span> · {r.name}
                    {r.punchDate ? ` · ${r.punchDate}` : ""} — {r.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.refused.length > 0 && (
            <section className="space-y-3">
              <SectionHeading count={plan.refused.length}>Rows this cannot read</SectionHeading>
              <ul className="space-y-1 text-sm">
                {plan.refused.map((r) => (
                  <li key={`${r.line}-${r.name}`} className="text-muted">
                    <span className="tabular-nums">line {r.line}</span> · {r.name} — {r.why}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button type="button" disabled={!canCommit} onClick={commit} className={BUTTON}>
              {pending
                ? "Importing…"
                : `Import ${matched.filter((m) => m.employeeId).length} shifts`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setPlan(null);
                setFile(null);
                setLinks({});
              }}
              className="text-[12px] uppercase tracking-[0.06em] text-muted underline underline-offset-4"
            >
              Discard
            </button>
            <span className="text-sm text-muted">
              Nothing has been written yet.
            </span>
          </div>
        </div>
      )}

      {/* The way OUT (Mark, 2026-08-05). Committing clears the plan, so the
          screen went back to a drop zone and a green "102 shifts imported"
          banner with nothing to press — the nav was the only way on from the
          end of the task.
          It sits OUTSIDE the `plan &&` block on purpose, so it is there before
          a file is dropped and after one is committed; those are the two moments
          you might want to leave, and the middle is the one where you wouldn't.
          BLACK, which is the panel-commit exception rather than a breach of it:
          importing produces ONE outcome and this row is a commit, not a row of
          peers — the same argument the receiving screen's Complete rests on, and
          it reuses the same class. */}
      <div className="flex justify-end border-t border-hairline pt-6">
        <button
          type="button"
          disabled={pending}
          onClick={() => router.push("/timesheets")}
          className={DIALOG_COMMIT_CLASS}
        >
          Done
        </button>
      </div>
    </div>
  );
}
