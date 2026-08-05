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
          Timesheets
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
          Timesheets
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

  // The chosen period's own dates. `break_premiums` and `tip_pools` are keyed by
  // workday and business date, not by pay_period_id, so they are fetched by
  // range rather than by id.
  const chosen = periods.find((p) => p.id === periodId) ?? periods[0];
  const periodStart = chosen.start_date;
  const periodEnd = chosen.end_date;

  const [
    { data: sheets, error },
    { data: employees },
    { data: waiverRows },
    { data: premiumRows },
    { data: poolRows },
  ] = await Promise.all([
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
    // The signed meal-break waivers. They change the ANSWER the break rules
    // give, not just how it's presented — a waived meal on a six-hour day owes
    // nothing at all. Returns zero rows today: FMP keeps its 51 waivers in the
    // Events table, which has never been migrated.
    supabase.from("employee_documents").select("employee_id").eq("kind", "meal_break_waiver"),
    // The decisions and the pools, so the row expansions can show what is
    // already on file rather than offering to record it again. Both are keyed
    // by DATE rather than by pay_period_id — 029 keys them that way, since a
    // premium belongs to a workday and a pool to a shop-day, neither of which
    // knows about fortnights.
    supabase
      .from("break_premiums")
      .select("id, employee_id, workday, kind, decision, hours, reason")
      .gte("workday", periodStart)
      .lte("workday", periodEnd),
    supabase
      .from("tip_pools")
      .select("location_id, business_date, reported_cents, corrected_cents")
      .gte("business_date", periodStart)
      .lte("business_date", periodEnd),
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
      location_id: (t.location_id ?? null) as string | null,
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

  // Keyed exactly as the expansion looks them up. A plain object rather than a
  // Map because this crosses the server/client boundary.
  const premiums: Record<string, { id: string; decision: string; hours: number; reason: string | null }> = {};
  for (const p of premiumRows ?? []) {
    premiums[`${p.employee_id}|${p.workday}|${p.kind}`] = {
      id: p.id as string,
      decision: p.decision as string,
      hours: numOrNull(p.hours) ?? 0,
      reason: (p.reason ?? null) as string | null,
    };
  }

  const pools: Record<string, { reported_cents: number | null; corrected_cents: number | null }> = {};
  for (const p of poolRows ?? []) {
    pools[`${p.location_id}|${p.business_date}`] = {
      reported_cents: numOrNull(p.reported_cents),
      corrected_cents: numOrNull(p.corrected_cents),
    };
  }

  return (
    <div className="space-y-6">
      {/* Importing is reached from inside the New timesheet dialog now (Mark,
          2026-08-05) — one door, not one per screen. */}
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Timesheets
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          Every shift in one pay period. What the source said is kept beside
          what we decided — open a row to see both, and why they differ.
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
        waiverEmployeeIds={(waiverRows ?? []).map((w) => w.employee_id as string)}
        employees={[...employeeById.entries()]
          .map(([id, e]) => ({ id, name: e.name }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))}
        // ACTIVE locations only: this enumerates somewhere to put a new shift,
        // and a closed shop is not one (design rule 3).
        locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
        orgId={session.membership.org_id}
        premiums={premiums}
        pools={pools}
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
