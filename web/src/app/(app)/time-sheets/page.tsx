import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import {
  TimesheetsList,
  type PeriodOption,
  type TimesheetRow,
} from "@/components/payroll/TimesheetsList";
import type { PayPeriodStatus } from "@/lib/payPeriods";
import type { OtDecision } from "@/lib/timesheets";

/**
 * A fortnight of shifts.
 *
 * ORG-scoped, so exempt from the inactive-location gate for the reason
 * `/employees` is: payroll belongs to the company, not to a shop. A shift at
 * DF03 — closed since — is still a shift someone was paid for, and 5,578 of
 * them are in this table.
 *
 * SCOPED TO ONE PERIOD by query string. 44,721 rows exist; loading them all
 * would be slow and would answer a question nobody asks. `?period=` names it;
 * with no parameter it opens the most recent period that HAS shifts, which
 * after the historical load is the last paid fortnight rather than an empty
 * current one.
 */
export default async function TimeSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getAppSession();

  // 028 gates timesheets at owner/admin on EVERY verb, select included — what a
  // named person was paid for is the same class of fact as their home address
  // (020's reasoning). RLS would simply return no rows below that, which renders
  // as an empty table and reads like a broken screen. Say what's true instead.
  if (!canRunPayroll(session.membership.role)) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Time Sheets
        </h1>
        <p className="text-sm text-muted">
          Timesheets are open to managers and the owner. Ask a manager if you
          need something from them.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { period: requested } = await searchParams;

  const { data: periodRows, error: periodError } = await supabase
    .from("pay_periods")
    .select("id, start_date, end_date, status")
    .order("start_date", { ascending: false });

  if (periodError) {
    return <p className="text-sm text-accent">Could not load pay periods: {periodError.message}</p>;
  }

  const periods: PeriodOption[] = (periodRows ?? []).map((p) => ({
    id: p.id as string,
    start_date: p.start_date as string,
    end_date: p.end_date as string,
    status: p.status as PayPeriodStatus,
  }));

  if (periods.length === 0) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Time Sheets
        </h1>
        <p className="text-sm text-muted">
          There are no pay periods yet, so there is nowhere to record hours. Open
          one on the Pay Periods screen first.
        </p>
      </div>
    );
  }

  // The most recent period that actually HAS shifts. After the historical load
  // the newest period is the current, empty fortnight, and opening onto an
  // empty table would read as "the load failed".
  let periodId = requested ?? null;
  if (!periodId || !periods.some((p) => p.id === periodId)) {
    const { data: newest } = await supabase
      .from("timesheets")
      .select("pay_period_id, workday")
      .not("pay_period_id", "is", null)
      .order("workday", { ascending: false })
      .limit(1);
    periodId = (newest?.[0]?.pay_period_id as string | undefined) ?? periods[0].id;
  }

  const [{ data: sheets, error }, { data: employees }] = await Promise.all([
    supabase
      .from("timesheets")
      .select(
        `id, employee_id, location_id, workday, business_date, workweek_start,
         clock_in, clock_out,
         source_hours_regular, source_hours_overtime, source_hours_double_ot,
         source_hours_paid, source_break_minutes,
         hours_regular, hours_overtime, hours_double_ot,
         ot_decision, ot_reason, unpaid_break_minutes, sick_hours, exclude_tips,
         stitched, kind, position, employee_note, manager_note, source, source_payload`
      )
      .eq("pay_period_id", periodId)
      .order("workday"),
    // Names and the durable tip-exclusion flag. A separate query rather than an
    // embed: the same employee appears on ~20 shifts a fortnight, and embedding
    // would send their row twenty times.
    supabase.from("employees").select("id, first_name, last_name, excludes_tips"),
  ]);

  if (error) {
    // Before 028 is applied this says "Could not find the table" rather than
    // showing an empty list, which would read as "no shifts this fortnight".
    return <p className="text-sm text-accent">Could not load timesheets: {error.message}</p>;
  }

  const employeeById = new Map(
    (employees ?? []).map((e) => [
      e.id as string,
      {
        name: `${e.last_name}, ${e.first_name}`,
        excludes_tips: (e.excludes_tips ?? false) as boolean,
      },
    ])
  );
  // The FULL location list, not activeLocations — DF03 is closed and 5,578
  // shifts happened there. Design rule 3: this is a LOOK-UP, not an enumeration.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: TimesheetRow[] = (sheets ?? []).map((t) => {
    const emp = employeeById.get(t.employee_id as string);
    return {
      id: t.id as string,
      employee_id: t.employee_id as string,
      employee_name: emp?.name ?? "(unknown)",
      employee_excludes_tips: emp?.excludes_tips ?? false,
      location_code: t.location_id ? (codeById.get(t.location_id as string) ?? null) : null,
      workday: t.workday as string,
      business_date: t.business_date as string,
      workweek_start: t.workweek_start as string,
      clock_in: (t.clock_in ?? null) as string | null,
      clock_out: (t.clock_out ?? null) as string | null,
      source_hours_regular: numOrNull(t.source_hours_regular),
      source_hours_overtime: numOrNull(t.source_hours_overtime),
      source_hours_double_ot: numOrNull(t.source_hours_double_ot),
      source_hours_paid: numOrNull(t.source_hours_paid),
      source_break_minutes: numOrNull(t.source_break_minutes),
      hours_regular: numOrNull(t.hours_regular),
      hours_overtime: numOrNull(t.hours_overtime),
      hours_double_ot: numOrNull(t.hours_double_ot),
      ot_decision: t.ot_decision as OtDecision,
      ot_reason: (t.ot_reason ?? null) as string | null,
      unpaid_break_minutes: numOrNull(t.unpaid_break_minutes),
      sick_hours: numOrNull(t.sick_hours),
      exclude_tips: (t.exclude_tips ?? null) as boolean | null,
      stitched: (t.stitched ?? false) as boolean,
      kind: t.kind as "shift" | "adjustment",
      position: (t.position ?? null) as string | null,
      employee_note: (t.employee_note ?? null) as string | null,
      manager_note: (t.manager_note ?? null) as string | null,
      source: t.source as string,
      source_payload: (t.source_payload ?? null) as Record<string, unknown> | null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Time Sheets
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          Every shift in one pay period. What the source said is kept beside what
          we decided — open a row to see both, and why they differ.{" "}
          <Link
            href="/time-sheets/import"
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Import a Homebase export
          </Link>
          .
        </p>
      </div>

      <TimesheetsList
        rows={rows}
        periods={periods}
        periodId={periodId}
        canWrite={canRunPayroll(session.membership.role)}
        // The org's zone, not the server's: a punch is an instant, and reading
        // one back on a UTC host would show every shift seven hours out.
        timeZone={session.orgSettings.timezone ?? "UTC"}
      />
    </div>
  );
}

/** PostgREST returns `numeric` as a string. Left unconverted, arithmetic on it
 *  concatenates instead of adding — "8" + "1.5" is "81.5" hours. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
