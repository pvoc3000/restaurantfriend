import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { PAY_PERIODS_CRUMB } from "@/lib/payPeriodRoutes";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { StatusChip } from "@/components/payroll/PayPeriodsList";
import { PayPeriodActions } from "@/components/payroll/PayPeriodActions";
import { PayrollWorksheet } from "@/components/payroll/PayrollWorksheet";
import {
  buildEmployeeRollup,
  buildFindings,
  buildPools,
  type WorksheetShift,
} from "@/lib/payrollWorksheet";
import {
  daysBetween,
  formatPeriodRange,
  isPayPeriodEditable,
  workweekStart,
  payrollSettings,
  type PayPeriodStatus,
} from "@/lib/payPeriods";

type PayPeriodRecord = {
  id: string;
  legacy_id: string | null;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
  notes: string | null;
  exported_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
};

/** A timestamptz as a readable local moment, or an em dash. */
function stamp(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * One fortnight.
 *
 * The calendar record AND the payroll worksheet: per-employee hours, the
 * meal-break findings awaiting a decision, and each shop-day's tip pool with
 * its rate and residual.
 *
 * Everything in the worksheet is DERIVED on each load and nothing in it is
 * stored until a human records a decision — which is decisions 3 and 10 made
 * operable. The Gusto export is deliberately absent; see the note at the foot
 * of the page.
 */
export async function PayPeriodDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();
  const supabase = await createClient();

  // 027 makes pay_periods readable by any member — a period is two dates and a
  // status. Writing one is owner/admin, so below that every cell renders as
  // plain text rather than offering an edit the database will refuse.
  const canWrite = canRunPayroll(session.membership.role);

  const { data: row, error } = await supabase
    .from("pay_periods")
    .select(
      "id, legacy_id, start_date, end_date, status, notes, exported_at, closed_at, reopened_at, reopen_reason"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return <p className="text-sm text-accent">Could not load the pay period: {error.message}</p>;
  }
  if (!row) {
    return <p className="text-sm text-accent">This pay period no longer exists.</p>;
  }

  const period = row as unknown as PayPeriodRecord;
  const trail = parseTrail(rawParams, PAY_PERIODS_CRUMB);
  const timeZone = session.orgSettings.timezone ?? "UTC";
  const settings = payrollSettings(session.orgSettings.payroll);

  // A fortnight holds TWO workweeks, and California weekly overtime and the
  // seventh-day rule are per workweek. Stating them here is how the screen
  // stops anyone reading the period as the unit overtime is computed over.
  const weeks: string[] = [];
  {
    let w = workweekStart(period.start_date, settings);
    const guard = 60; // a period can't sanely hold more weeks than this
    for (let i = 0; i < guard && w <= period.end_date; i++) {
      weeks.push(w);
      const next = new Date(`${w}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      w = next.toISOString().slice(0, 10);
    }
  }

  // The one cell that stays editable in a closed period is deliberately none of
  // them. Decision 8 is the module's single read-only rule, and a note is part
  // of the record it describes.
  const editable = canWrite && isPayPeriodEditable(period.status);

  // ---- the worksheet's inputs -------------------------------------------
  // Four queries in one round trip. Below owner/admin the timesheet SELECT
  // returns nothing (028's policy), which is correct and not worth a second
  // code path: the worksheet renders empty and the screen above it already
  // explains the gate.
  const [
    { data: shiftRows },
    { data: employeeRows },
    { data: premiumRows, error: premiumError },
    { data: poolRows, error: poolError },
    { data: waiverRows },
  ] = await Promise.all([
    supabase
      .from("timesheets")
      .select(
        `id, employee_id, location_id, workday, business_date, clock_in, clock_out,
         unpaid_break_minutes, hours_regular, hours_overtime, hours_double_ot,
         sick_hours, exclude_tips, source_payload`
      )
      .eq("pay_period_id", id),
    supabase.from("employees").select("id, first_name, last_name, excludes_tips"),
    supabase
      .from("break_premiums")
      .select("employee_id, workday, kind, decision, hours")
      .gte("workday", period.start_date)
      .lte("workday", period.end_date),
    supabase
      .from("tip_pools")
      .select("id, location_id, business_date, reported_cents, corrected_cents")
      .gte("business_date", period.start_date)
      .lte("business_date", period.end_date),
    // The 51 signed waivers change the ANSWER, not the presentation — a waived
    // meal on a six-hour day owes nothing at all. NOTE: this returns zero rows
    // today, because FMP keeps its waivers in the Events table and that has
    // never been migrated. Measured consequence: the rule reports ~6,374 more
    // no-meal days across the history than FileMaker did, nearly all of them
    // six hours or less. A data gap, not a rule bug.
    supabase.from("employee_documents").select("employee_id").eq("kind", "meal_break_waiver"),
  ]);

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const shifts: WorksheetShift[] = (shiftRows ?? []).map((t) => ({
    id: t.id as string,
    employee_id: t.employee_id as string,
    location_id: (t.location_id ?? null) as string | null,
    workday: t.workday as string,
    business_date: t.business_date as string,
    clock_in: (t.clock_in ?? null) as string | null,
    clock_out: (t.clock_out ?? null) as string | null,
    unpaid_break_minutes: num(t.unpaid_break_minutes),
    hours_regular: num(t.hours_regular),
    hours_overtime: num(t.hours_overtime),
    hours_double_ot: num(t.hours_double_ot),
    sick_hours: num(t.sick_hours),
    exclude_tips: (t.exclude_tips ?? null) as boolean | null,
    source_payload: (t.source_payload ?? null) as Record<string, unknown> | null,
  }));

  const employeeMap = new Map(
    (employeeRows ?? []).map((e) => [
      e.id as string,
      {
        name: `${e.last_name}, ${e.first_name}`,
        excludes_tips: (e.excludes_tips ?? false) as boolean,
      },
    ])
  );
  const waiverIds = new Set((waiverRows ?? []).map((w) => w.employee_id as string));

  const decidedByKey = new Map(
    (premiumRows ?? []).map((p) => [
      `${p.employee_id}|${p.workday}|${p.kind}`,
      { decision: p.decision as string },
    ])
  );
  const premiumHours = new Map<string, number>();
  for (const p of premiumRows ?? []) {
    const k = p.employee_id as string;
    premiumHours.set(k, (premiumHours.get(k) ?? 0) + (num(p.hours) ?? 0));
  }

  const poolMap = new Map(
    (poolRows ?? []).map((p) => [
      `${p.location_id}|${p.business_date}`,
      {
        id: p.id as string,
        reported_cents: num(p.reported_cents),
        corrected_cents: num(p.corrected_cents),
      },
    ])
  );
  // The FULL location list, not activeLocations — DF03 is closed and people
  // were paid for shifts there. Design rule 3: a LOOK-UP, not an enumeration.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  // BEFORE 029 IS APPLIED these two are "Could not find the table", and the
  // worksheet must SAY so. Swallowing them renders a tips view reading "no
  // figure entered" for every day and a breaks view where nothing is ever
  // decided — both of which look like real answers. Same reason PO detail
  // replaces its Paperwork card with the Postgres error rather than showing an
  // empty card. The hours view needs neither table and still works.
  const worksheetError = premiumError ?? poolError;

  const findings = buildFindings(shifts, employeeMap, waiverIds, decidedByKey);
  const rollup = buildEmployeeRollup(shifts, employeeMap, findings, premiumHours);
  const pools = buildPools(shifts, employeeMap, codeById, poolMap);

  return (
    <div className="space-y-16">
      <Breadcrumbs
        trail={trail}
        current={formatPeriodRange(period)}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* ---- what this period is --------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {formatPeriodRange(period)}
          </h1>
          <StatusChip status={period.status} />
        </div>

        <dl className="grid max-w-lg grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Starts</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="start_date"
                kind="date"
                value={period.start_date}
                nullable={false}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.start_date}</span>
            )}
          </dd>

          <dt className="py-0.5 text-subtle">Ends</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="end_date"
                kind="date"
                value={period.end_date}
                nullable={false}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.end_date}</span>
            )}
          </dd>

          <dt className="py-0.5 text-subtle">Length</dt>
          <dd className={READ_ONLY_VALUE}>
            {daysBetween(period.start_date, period.end_date)} days
          </dd>

          <dt className="py-0.5 text-subtle">Workweeks</dt>
          <dd className={READ_ONLY_VALUE}>
            {weeks.join(" · ")}
            <span className="block text-[13px] text-muted">
              Overtime over 40 hours and the seventh-day rule are per workweek,
              not per period.
            </span>
          </dd>

          <dt className="py-0.5 text-subtle">Note</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="notes"
                value={period.notes}
                placeholder="—"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.notes ?? "—"}</span>
            )}
          </dd>

          {period.legacy_id && (
            <>
              <dt className="py-0.5 text-subtle">FileMaker</dt>
              <dd className={READ_ONLY_VALUE}>#{period.legacy_id}</dd>
            </>
          )}
        </dl>
      </div>

      {/* ---- where it is on the ladder --------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>Status</SectionHeading>
        <PayPeriodActions id={period.id} status={period.status} canWrite={canWrite} />

        <dl className="grid max-w-lg grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Exported</dt>
          <dd className={READ_ONLY_VALUE}>{stamp(period.exported_at, timeZone)}</dd>
          <dt className="py-0.5 text-subtle">Closed</dt>
          <dd className={READ_ONLY_VALUE}>{stamp(period.closed_at, timeZone)}</dd>
          {period.reopened_at && (
            <>
              <dt className="py-0.5 text-subtle">Reopened</dt>
              <dd className={READ_ONLY_VALUE}>
                {stamp(period.reopened_at, timeZone)}
                {period.reopen_reason && (
                  <span className="block text-[13px] text-muted">{period.reopen_reason}</span>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* ---- the worksheet ---------------------------------------------- */}
      {worksheetError ? (
        <section className="space-y-4">
          <SectionHeading>Payroll worksheet</SectionHeading>
          <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
            The break-premium and tip-pool tables are missing:{" "}
            {worksheetError.message}. Migration 029 has not been applied yet.
          </p>
        </section>
      ) : (
      <PayrollWorksheet
        employees={rollup}
        findings={findings}
        pools={pools}
        editable={editable}
        orgId={session.membership.org_id}
      />
      )}

      <p className="max-w-[72ch] border border-hairline px-4 py-3 text-sm text-muted">
        The Gusto export is deliberately last: it is irreversible, and it must
        not run until every input above is trustworthy. It also needs one
        decision from Mark — whether a meal premium exports as HOURS on Gusto&rsquo;s
        native <code>missed_break_hours</code> column or as dollars on
        <code> custom_earning_premium</code>, which is what the FileMaker export
        does today.
      </p>
    </div>
  );
}
