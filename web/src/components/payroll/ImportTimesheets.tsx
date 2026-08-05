"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { PickList } from "@/components/ui/PickList";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { planImport, type ImportPlan, type ParsedShift } from "@/lib/homebaseImport";
import { resolveLocal } from "@/lib/timeZone";
import { formatPeriodRange, type PayPeriodStatus } from "@/lib/payPeriods";

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

const ACCEPT = ["text/csv", "application/vnd.ms-excel", "text/plain"] as const;

export type ImportEmployee = {
  id: string;
  name: string;
  legacy_id: string | null;
  homebase_id: string | null;
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
}: {
  employees: ImportEmployee[];
  periods: ImportPeriod[];
  locations: { id: string; code: string }[];
  orgId: string;
  timeZone: string;
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
    const manual = links[key || s.name];
    if (manual) return { shift: s, employeeId: manual, via: "homebase_id" };
    if (key) {
      const hb = byHomebase.get(key);
      if (hb) return { shift: s, employeeId: hb.id, via: "homebase_id" };
      const lg = byLegacy.get(key);
      if (lg) return { shift: s, employeeId: lg.id, via: "legacy_id" };
    }
    return { shift: s, employeeId: null, via: null };
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
    const days = new Set(plan.shifts.map((s) => s.workday));
    return periods.filter((p) => [...days].some((d) => d >= p.start_date && d <= p.end_date));
  }, [plan, periods]);

  const blockedPeriods = targetPeriods.filter(
    (p) => p.status !== "open" && p.status !== "review"
  );

  const canCommit =
    plan !== null &&
    file !== null &&
    plan.shifts.length > 0 &&
    location !== null &&
    blockedPeriods.length === 0 &&
    targetPeriods.length > 0 &&
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
          const inAt = resolveLocal(timeZone, wall(s.clockInISO, s.clockInMinutes));
          const outAt =
            s.clockOutISO === null || s.clockOutMinutes === null
              ? null
              : resolveLocal(timeZone, wall(s.clockOutISO, s.clockOutMinutes));

          const natural = [
            s.payrollId ?? s.name,
            s.workday,
            s.source.clockInTime ?? "-",
            s.source.clockOutTime ?? "-",
            location.code,
          ].join("|");

          return {
            org_id: orgId,
            employee_id: m.employeeId as string,
            location_id: location.id,
            workday: s.workday,
            business_date: s.workday,
            clock_in: new Date(inAt.instant).toISOString(),
            clock_out: outAt ? new Date(outAt.instant).toISOString() : null,
            source_hours_regular: s.source.regularHours,
            source_hours_overtime: s.source.overtimeHours,
            source_hours_double_ot: s.source.doubleOtHours,
            source_hours_paid: s.source.totalPaidHours,
            source_break_minutes: s.breakMinutes,
            // The historical posture: take the source's word for it, and record
            // that nobody has re-checked. The overtime queue on /time-sheets is
            // where that gets argued with.
            hours_regular: s.source.regularHours,
            hours_overtime: s.source.overtimeHours,
            hours_double_ot: s.source.doubleOtHours,
            ot_decision: "source",
            unpaid_break_minutes: s.breakMinutes,
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
              matched_via: m.via,
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
              <p className="border border-accent px-4 py-3 text-sm text-accent">
                No pay period covers these dates. Open one first, or these shifts
                would have nowhere to belong.
              </p>
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
                This file covers a fortnight that is no longer open. Importing it
                would silently write nothing — the database refuses the rows and
                reports no error — so the commit is blocked instead.
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

          {plan.skipped.length > 0 && (
            <section className="space-y-3">
              <SectionHeading count={plan.skipped.length}>Rows with nothing on them</SectionHeading>
              <p className="max-w-[72ch] text-sm text-muted">
                Homebase prints a row for a scheduled day even when nobody
                punched. These are read correctly and hold no shift, so there is
                nothing to import from them — they are listed here rather than
                among the failures, which they are not.
              </p>
              <ul className="space-y-1 text-sm text-muted">
                {plan.skipped.map((r) => (
                  <li key={`${r.line}-${r.name}`}>
                    <span className="tabular-nums">line {r.line}</span> · {r.name}
                    {r.workday ? ` · ${r.workday}` : ""} — {r.why}
                  </li>
                ))}
              </ul>
            </section>
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
    </div>
  );
}
