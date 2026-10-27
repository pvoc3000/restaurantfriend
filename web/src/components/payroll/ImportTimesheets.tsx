"use client";

import type { ReactNode } from "react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList } from "@/components/ui/PickList";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Checkbox } from "@/components/ui/Checkbox";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import {
  IMPORT_STATUS_COUNT_LABEL,
  IMPORT_STATUS_LABEL,
  reviewShift,
  selectedByDefault,
  type ImportStatus,
  type IncomingShift,
  type ShiftReview,
  type StoredShift,
} from "@/lib/importReview";
import {
  planImport,
  whyCommitIsBlocked,
  type ImportPlan,
  type ParsedShift,
} from "@/lib/homebaseImport";
import { resolveLocal } from "@/lib/timeZone";
import { parseWorkdayStart, workdayFor } from "@/lib/workday";
import {
  formatPeriodRange,
  isPayPeriodEditable,
  nextPeriodAfter,
  overlapsAny,
  payrollSettings as readPayrollSettings,
  periodContaining,
  type PayPeriodStatus,
  type PeriodRange,
} from "@/lib/payPeriods";

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

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

/** A shift in the checklist: the file's row, who it matched, and what a write would do. */
type ReviewRow = { key: string; m: Matched; review: ShiftReview };
/** A person in the checklist, and their shifts in the order they were worked. */
type EmployeeRow = { id: string; name: string; shifts: ReviewRow[] };

/** The order statuses are counted in, most in need of a look first. */
const STATUS_ORDER: readonly ImportStatus[] = ["edited", "changed", "new", "unchanged"];

/** The columns `reviewShift` compares — everything the upsert would overwrite. */
const STORED_COLUMNS =
  "source_row_key, source_hours_regular, source_hours_overtime, source_hours_double_ot, " +
  "source_hours_paid, source_break_minutes, hours_regular, hours_overtime, hours_double_ot, " +
  "ot_decision, unpaid_break_minutes, clock_out, position, employee_note, manager_note, source_payload";

/** "01 Overnight Baker" → "Overnight Baker" — what `position` stores. */
function roleOf(s: ParsedShift): string | null {
  return s.role ? s.role.replace(/^\d+\s+/, "") : null;
}

/**
 * The upsert's conflict target. THE PUNCH DATE, never the workday — see the
 * note where the rows are built. Shared by the commit and the checklist, so
 * the shift a box describes is the row it writes.
 */
function rowKeyOf(s: ParsedShift, locationCode: string): string {
  return [
    s.payrollId ?? s.name,
    s.punchDate,
    s.source.clockInTime ?? "-",
    s.source.clockOutTime ?? "-",
    locationCode,
  ].join("|");
}

function wall(dateISO: string, minutes: number) {
  const [y, mo, d] = dateISO.split("-").map(Number);
  return { year: y, month: mo, day: d, hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

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
  /**
   * The rows already imported for this file's shop and dates, by key. Null
   * while they are being read — the commit waits for them, because a checklist
   * that has not looked yet would call every shift New and tick the edited ones.
   */
  const [existing, setExisting] = useState<Map<string, StoredShift> | null>(null);
  /** Ticked shifts, by row key. Only these are written. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function take(f: File) {
    setError(null);
    setDone(null);
    setFile(f);
    setExisting(null);
    setSelected(new Set());
    const next = planImport(await f.text());
    setPlan(next);

    const loc = next.locationCode
      ? (locations.find((l) => l.code === next.locationCode) ?? null)
      : null;
    // No shop, no shifts: the commit is blocked for its own stated reason, and
    // there is nothing to compare against.
    if (!loc || next.shifts.length === 0) {
      setExisting(new Map());
      return;
    }

    const dates = next.shifts.map((s) => s.punchDate).sort();
    const found = new Map<string, StoredShift>();
    // PAGED: PostgREST stops at 1,000 rows without saying so, and a shift it
    // dropped would read as New and be ticked over an edit.
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase
        .from("timesheets")
        .select(STORED_COLUMNS)
        .eq("org_id", orgId)
        .eq("source", "homebase")
        .eq("location_id", loc.id)
        .gte("business_date", dates[0])
        .lte("business_date", dates[dates.length - 1])
        .order("id")
        .range(from, from + 999);
      if (e) {
        setError(`Could not read the shifts already imported: ${e.message}`);
        return;
      }
      for (const r of (data ?? []) as unknown as (StoredShift & { source_row_key: string })[]) {
        found.set(r.source_row_key, r);
      }
      if (!data || data.length < 1000) break;
    }

    setExisting(found);
    setSelected(
      new Set(
        next.shifts
          .map((s) => rowKeyOf(s, loc.code))
          .filter((k, i) => selectedByDefault(reviewShift(incomingOf(next.shifts[i]), found.get(k) ?? null).status))
      )
    );
  }

  /** What the file says about a shift, in the terms the stored row uses. */
  function incomingOf(s: ParsedShift): IncomingShift {
    const outAt =
      s.clockOutDate === null || s.clockOutMinutes === null
        ? null
        : resolveLocal(timeZone, wall(s.clockOutDate, s.clockOutMinutes));
    return {
      regular: s.source.regularHours,
      overtime: s.source.overtimeHours,
      double_ot: s.source.doubleOtHours,
      paid: s.source.totalPaidHours,
      breakMinutes: s.unpaidBreakMinutes,
      clockOut: outAt ? new Date(outAt.instant).toISOString() : null,
      position: roleOf(s),
      wageRate: s.source.wageRate,
      employeeNote: s.source.employeeNote,
      managerNote: s.source.managerNote,
    };
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

  /** Every matched shift, with what writing it would do. */
  const reviewRows: ReviewRow[] = useMemo(() => {
    if (!location || existing === null) return [];
    return matched
      .filter((m) => m.employeeId)
      .map((m) => {
        const key = rowKeyOf(m.shift, location.code);
        return { key, m, review: reviewShift(incomingOf(m.shift), existing.get(key) ?? null) };
      });
    // incomingOf closes over the time zone only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, location, existing]);

  const chosen = reviewRows.filter((r) => selected.has(r.key));

  const statusCounts = useMemo(() => {
    const out: Record<ImportStatus, number> = { new: 0, unchanged: 0, changed: 0, edited: 0 };
    for (const r of reviewRows) out[r.review.status] += 1;
    return out;
  }, [reviewRows]);

  // Which fortnight owns these shifts. Looked up from the file's own dates, so
  // the screen can say "that period is closed" before anything is written
  // rather than letting 028's policy silently refuse every row.
  const targetPeriods = useMemo(() => {
    if (!plan) return [];
    // THE PUNCH DATE, not the workday — since 062 the fortnight is derived from
    // `business_date`. A workday starting in the afternoon can carry an evening
    // past a fortnight's end for OVERTIME purposes without the hours having
    // been worked in the next fortnight, which is a different claim.
    const days = new Set(matched.map((m) => m.shift.punchDate));
    return periods.filter((p) => [...days].some((d) => d >= p.start_date && d <= p.end_date));
  }, [plan, matched, periods]);

  const blockedPeriods = targetPeriods.filter((p) => !isPayPeriodEditable(p.status));

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
   * Days no pay period covers — by the PUNCH date, which since 062 is what
   * decides the fortnight.
   *
   * The failure it guards is silent and total: 028's
   * `timesheet_period_editable(null)` is deliberately TRUE, so a row with no
   * period writes without error, no trigger ever fills the column in, and
   * `/timesheets` fetches by `pay_period_id`. The shift would be invisible and
   * never paid.
   *
   * It keyed on the WORKDAY between 061 and 062, and blocked Mark's first real
   * import over two shifts whose hours were worked inside the closing fortnight
   * and only counted toward the next one. That was 028's derivation reading the
   * wrong column, not a file with nowhere to land — see 062.
   */
  const uncoveredDays = useMemo(() => {
    const days = new Set(matched.filter((m) => m.employeeId).map((m) => m.shift.punchDate));
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

  /** The shifts that land on a day no period covers — named, not just counted. */
  const uncoveredShifts = useMemo(
    () => matched.filter((m) => m.employeeId && uncoveredDays.includes(m.shift.punchDate)),
    [matched, uncoveredDays]
  );

  const employeeName = (id: string | null) =>
    (id ? byId.get(id)?.name : null) ?? "(unmatched)";
  const clockLabel = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  /** The sentence the Import button owes when it cannot run. See `lib/homebaseImport`. */
  const commitBlockedBecause =
    plan === null || file === null
      ? null
      : whyCommitIsBlocked({
          shiftCount: plan.shifts.length,
          hasLocation: location !== null,
          blockedPeriodCount: blockedPeriods.length,
          targetPeriodCount: targetPeriods.length,
          uncoveredDays,
          uncoveredShiftCount: uncoveredShifts.length,
        });

  const canCommit =
    plan !== null &&
    file !== null &&
    plan.shifts.length > 0 &&
    existing !== null &&
    chosen.length > 0 &&
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
      const rows = chosen
        .map(({ m }) => {
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
          const natural = rowKeyOf(s, location.code);

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
            position: roleOf(s),
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
              // What the export groups by — see `HomebaseRow.wageRate`.
              wage_rate: s.source.wageRate,
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
      setExisting(null);
      setSelected(new Set());
      router.refresh();
    });
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

  /* -- the checklist ------------------------------------------------------- */

  /**
   * ONE ROW PER EMPLOYEE, their shifts behind the disclosure (Mark,
   * 2026-10-27: "present the user with a list of employees instead of all the
   * timesheets"). A fortnight is ~150 shifts and ~20 people, and the decision
   * is usually about a person — re-import Sky, leave everyone else — so the
   * person is the row and the box beside their name ticks all of their shifts.
   * The shifts stay individually tickable inside, for the one edited shift
   * among five that should be left alone.
   */
  const employeeRows: EmployeeRow[] = useMemo(() => {
    const by = new Map<string, ReviewRow[]>();
    for (const r of reviewRows) {
      const id = r.m.employeeId as string;
      const list = by.get(id);
      if (list) list.push(r);
      else by.set(id, [r]);
    }
    return [...by.entries()].map(([id, shifts]) => ({
      id,
      name: employeeName(id),
      shifts: shifts
        .slice()
        .sort(
          (a, b) =>
            a.m.shift.punchDate.localeCompare(b.m.shift.punchDate) ||
            a.m.shift.clockInMinutes - b.m.shift.clockInMinutes
        ),
    }));
    // employeeName reads `byId`, which changes only with `employees`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRows]);

  const allChosen = reviewRows.length > 0 && chosen.length === reviewRows.length;

  function setTicked(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  const tickedOf = (e: EmployeeRow) => e.shifts.filter((r) => selected.has(r.key)).length;

  /** "pay rate, notes" — what differs, said once per side. */
  function differs(r: ShiftReview): string {
    const parts: string[] = [];
    if (r.edited.length > 0) parts.push(`Here: ${r.edited.join(", ")}`);
    if (r.changed.length > 0) parts.push(`Homebase: ${r.changed.join(", ")}`);
    return parts.join(" · ");
  }

  /** "2 new · 1 edited here" — an employee's shifts by status, in one order. */
  function statusLine(e: EmployeeRow): ReactNode {
    const counts: Record<ImportStatus, number> = { new: 0, unchanged: 0, changed: 0, edited: 0 };
    for (const r of e.shifts) counts[r.review.status] += 1;
    return STATUS_ORDER.filter((k) => counts[k] > 0).map((k, i) => (
      <span key={k}>
        {i > 0 && " · "}
        {/* Yellow on the one a person has to decide: an edit, which a write
            would overwrite. */}
        <span className={k === "edited" ? "bg-mark-fill px-1" : ""}>
          {counts[k]} {IMPORT_STATUS_COUNT_LABEL[k]}
        </span>
      </span>
    ));
  }

  const paidOf = (rows: ReviewRow[]) =>
    rows.reduce((n, r) => n + (r.m.shift.source.totalPaidHours ?? 0), 0);

  const employeeColumns: DataColumn<EmployeeRow>[] = [
    {
      key: "pick",
      label: "",
      width: 48,
      header: (
        <Checkbox
          checked={allChosen}
          onChange={() =>
            setSelected(allChosen ? new Set() : new Set(reviewRows.map((r) => r.key)))
          }
          label="Tick every shift"
        />
      ),
      // TICKED ONLY WHEN EVERY SHIFT IS. A partly ticked person shows an empty
      // box and "2 of 5" beside it, and a click ticks the rest — the box says
      // what one click will do to the whole person.
      render: (e) => {
        const all = tickedOf(e) === e.shifts.length;
        return (
          <Checkbox
            checked={all}
            onChange={() => setTicked(e.shifts.map((r) => r.key), !all)}
            label={`Import every shift for ${e.name}`}
          />
        );
      },
    },
    {
      key: "employee",
      label: "Employee",
      width: 240,
      pinned: true,
      sortValue: (e) => e.name,
      render: (e) => e.name,
    },
    {
      key: "shifts",
      label: "Shifts",
      width: 80,
      align: "right",
      sortValue: (e) => e.shifts.length,
      render: (e) => <span className="tabular-nums">{e.shifts.length}</span>,
    },
    {
      key: "ticked",
      label: "Ticked",
      width: 90,
      align: "right",
      sortValue: (e) => tickedOf(e),
      render: (e) => (
        <span className="tabular-nums">
          {tickedOf(e)} of {e.shifts.length}
        </span>
      ),
    },
    {
      key: "paid",
      label: "Paid hours",
      width: 100,
      align: "right",
      sortValue: (e) => paidOf(e.shifts),
      render: (e) => <span className="tabular-nums">{paidOf(e.shifts).toFixed(2)}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 320,
      wrap: true,
      // Edited people first, then changed, so the ones worth opening rise.
      sortValue: (e) =>
        e.shifts.some((r) => r.review.status === "edited")
          ? 0
          : e.shifts.some((r) => r.review.status === "changed")
            ? 1
            : e.shifts.some((r) => r.review.status === "new")
              ? 2
              : 3,
      render: statusLine,
    },
  ];

  /**
   * One person's shifts, inside the disclosure. A ruled grid rather than a
   * second `DataTable`: a table nested in a cell would bring sticky column
   * labels and its own saved widths to a list of five lines.
   */
  function shiftList(e: EmployeeRow) {
    return (
      <div className="py-2 text-sm">
        <div className="grid grid-cols-[2rem_9.5rem_10rem_5rem_10rem_minmax(0,1fr)] items-center gap-x-4 border-b border-hairline pb-1 text-[11px] uppercase tracking-[0.12em] text-muted">
          <span />
          <span>Clocked in</span>
          <span>Role</span>
          <span className="text-right">Paid hours</span>
          <span>Status</span>
          <span>What differs</span>
        </div>
        {e.shifts.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-[2rem_9.5rem_10rem_5rem_10rem_minmax(0,1fr)] items-center gap-x-4 border-b border-hairline py-2 last:border-b-0"
          >
            <Checkbox
              checked={selected.has(r.key)}
              onChange={(on) => setTicked([r.key], on)}
              label={`Import ${e.name}, ${r.m.shift.punchDate}`}
            />
            <span className="tabular-nums">
              {r.m.shift.punchDate} {clockLabel(r.m.shift.clockInMinutes)}
            </span>
            <span className="truncate">{roleOf(r.m.shift) ?? "—"}</span>
            <span className="text-right tabular-nums">
              {r.m.shift.source.totalPaidHours?.toFixed(2) ?? "—"}
            </span>
            <span>
              {r.review.status === "edited" ? (
                <span className="bg-mark-fill px-1">{IMPORT_STATUS_LABEL.edited}</span>
              ) : (
                IMPORT_STATUS_LABEL[r.review.status]
              )}
            </span>
            <span className="text-muted">{differs(r.review)}</span>
          </div>
        ))}
      </div>
    );
  }

  /* -- render -------------------------------------------------------------- */

  // THE COMMIT, and therefore black (Mark, 2026-08-22: "the 'import x sheets'
  // button should be black and not the 'done' button, shouldn't it?"). It
  // should: these only exist once a file is loaded, and at that moment
  // importing is the one outcome the screen is for — a commit standing beside
  // no peers, which is what the panel-commit exception actually turns on. Done
  // is the escape beside it and gives the fill up while a plan is up.
  const commitButton = (
    <button type="button" disabled={!canCommit} onClick={commit} className={DIALOG_COMMIT_CLASS}>
      {pending ? "Importing…" : `Import ${chosen.length} shift${chosen.length === 1 ? "" : "s"}`}
    </button>
  );
  const discardButton = (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPlan(null);
        setFile(null);
        setLinks({});
        setExisting(null);
        setSelected(new Set());
      }}
      className="text-[12px] uppercase tracking-[0.06em] text-muted underline underline-offset-4"
    >
      Discard
    </button>
  );
  const commitReason =
    commitBlockedBecause ??
    (existing === null
      ? "Checking which of these shifts are already imported…"
      : chosen.length === 0
        ? "Tick at least one shift to import."
        : "Nothing has been written yet.");
  const doneButton = (
    <button
      type="button"
      disabled={pending}
      onClick={() => router.push("/timesheets")}
      className={plan ? BUTTON : DIALOG_COMMIT_CLASS}
    >
      Done
    </button>
  );

  const body = (
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
            {targetPeriods.length > 0 && (
              <ul className="space-y-1 text-sm">
                {targetPeriods.map((p) => (
                  <li key={p.id}>
                    {formatPeriodRange(p)} —{" "}
                    {isPayPeriodEditable(p.status) ? (
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

            {/* THE PERIOD THIS FILE STILL NEEDS.

                Gated on `uncoveredDays`, NOT on `targetPeriods.length === 0`,
                which is what it was until 2026-08-22 and which made this whole
                block unreachable in the case 061 introduced: a file whose shifts
                mostly land in an open fortnight, with two evenings carried past
                its end by a workday that starts in the afternoon. The commit was
                blocked, the reason was stated, and the button that fixes it was
                inside a branch that never ran — a refusal naming something the
                screen gives you no way to settle, which is exactly how people
                learn to stop reading refusals (Mark hit this on the real
                2026-08-03 export). */}
            {uncoveredDays.length > 0 && (
              <div className="space-y-3 border border-accent px-4 py-3">
                <p className="max-w-[72ch] text-sm text-accent">
                  {targetPeriods.length === 0
                    ? "No pay period covers these dates, so these shifts would have nowhere to belong."
                    : `${uncoveredShifts.length} shift${uncoveredShifts.length === 1 ? "" : "s"} ` +
                      `were punched on ${uncoveredDays.join(", ")}, which no pay period covers. ` +
                      "Written as they are, those rows would belong to no period at all and " +
                      "would never show on the timesheets screen."}
                </p>
                {uncoveredShifts.length > 0 && targetPeriods.length > 0 && (
                  <ul className="space-y-0.5 text-sm text-muted">
                    {uncoveredShifts.map((m) => (
                      <li key={m.shift.line} className="tabular-nums">
                        {employeeName(m.employeeId)} — clocked in {m.shift.punchDate} at{" "}
                        {clockLabel(m.shift.clockInMinutes)}
                      </li>
                    ))}
                  </ul>
                )}
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
          </section>

          {employeeRows.length > 0 && (
            <DataTable
              rows={employeeRows}
              columns={employeeColumns}
              rowKey={(e) => e.id}
              storageKey="rf.timesheetImport.employees.v1"
              defaultSort={{ key: "employee" }}
              expand={{ render: shiftList, columnKey: "employee" }}
              leading={
                <div className="space-y-1">
                  <SectionHeading count={employeeRows.length}>Employees</SectionHeading>
                  <p className="text-sm text-muted tabular-nums">
                    {reviewRows.length} shifts:{" "}
                    {STATUS_ORDER.filter((k) => statusCounts[k] > 0)
                      .map((k) => `${statusCounts[k]} ${IMPORT_STATUS_COUNT_LABEL[k]}`)
                      .join(" · ")}
                    {" — "}
                    {chosen.length} ticked
                  </p>
                </div>
              }
            />
          )}

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
            {commitButton}
            {discardButton}
            <span className="text-sm text-muted">{commitReason}</span>
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
          BLACK ONLY WHILE THERE IS NO PLAN. The panel-commit exception is
          about the one outcome a screen is for, and that outcome moves: with a
          file loaded it is Import, so Import takes the fill and Done becomes the
          escape beside it; before and after, Done is the only thing to press and
          is the commit. A screen with two black buttons has said nothing about
          which one finishes the task (Mark, 2026-08-22). */}
      <div className="flex justify-end border-t border-hairline pt-6">{doneButton}</div>
    </div>
  );

  return body;
}
