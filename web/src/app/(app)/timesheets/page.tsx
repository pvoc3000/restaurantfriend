import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import {
  TimesheetsList,
  type PeriodOption,
  type TimesheetRow,
} from "@/components/payroll/TimesheetsList";
import { PeriodBar } from "@/components/payroll/PeriodBar";
import { NewPayPeriod } from "@/components/payroll/NewPayPeriod";
import {
  ExportTimesheets,
  type PayPeriodRecord,
} from "@/components/payroll/ExportTimesheets";
import type { ShiftBenefitLine } from "@/components/payroll/ShiftDecisions";
import { addDays, payrollSettings, workweekStart, type PayPeriodStatus } from "@/lib/payPeriods";
import { proposeOvertime } from "@/lib/overtime";
import { workedHours, type OtDecision } from "@/lib/timesheets";
import { isEarningColumn } from "@/lib/gustoExport";
import {
  buildEmployeeRollup,
  buildFindings,
  buildPools,
  type WorksheetShift,
} from "@/lib/payrollWorksheet";
import {
  computeAccruals,
  earningsByEmployee,
  explainShift,
  mergeFrozen,
  totalByBenefit,
  totalByEmployee,
  type BenefitEntitlement,
  type PayrollBenefit,
} from "@/lib/payrollBenefits";

/**
 * A fortnight of shifts, and everything payroll does with them.
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
 *
 * THE PAY-PERIOD SCREENS FOLDED IN HERE (Mark, 2026-08-06). There used to be a
 * list of 178 fortnights and a record screen for each; the list's whole job was
 * choosing one, which the picker on `PeriodBar` does, and the record's contents
 * decide nothing — the 2026-08-05 rework had already moved every decision onto
 * the shift row. So the record became a ROUTINE you open over the shifts,
 * `ExportTimesheets`, and this page computes its inputs alongside its own.
 *
 * Which is why the derivations below the queries are in two halves: the ROWS the
 * table shows, and the ROLL-UP the panel shows. They read the same shifts.
 */
export default async function TimesheetsPage({
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
  const timeZone = session.orgSettings.timezone ?? "UTC";
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const settings = payrollSettings(session.orgSettings.payroll);

  // Every period, for the picker — and wide enough to BE the chosen period's
  // record, since the export panel needs its note and its stamps. 178 rows of
  // six more columns is cheaper than a second round trip for one of them.
  const { data: periodRows, error: periodError } = await supabase
    .from("pay_periods")
    .select(
      "id, legacy_id, start_date, end_date, status, notes, exported_at, closed_at, reopened_at, reopen_reason"
    )
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
      <div className="max-w-2xl space-y-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Timesheets
        </h1>
        <p className="text-sm text-muted">
          There are no pay periods yet, so there is nowhere to record hours. Open
          the first one and this screen fills in.
        </p>
        {/* This used to send you to the Pay Periods screen, which no longer
            exists — a dead end for the one state that most needed a way out. */}
        <NewPayPeriod
          rows={periods}
          today={today}
          settings={session.orgSettings.payroll}
          orgId={session.membership.org_id}
        />
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
  const record = ((periodRows ?? []).find((p) => p.id === chosen.id) ??
    null) as unknown as PayPeriodRecord | null;

  const [
    { data: sheets, error },
    { data: employees, error: employeeError },
    { data: waiverRows },
    { data: premiumRows, error: premiumError },
    { data: poolRows, error: poolError },
    { data: benefitRows, error: benefitError },
    { data: entitlementRows, error: entitlementError },
  ] = await Promise.all([
    // ONE select for both halves of the screen. It is all-or-nothing on the
    // payroll migrations — the `timesheet_benefits` embed already made it so
    // before 031's three columns joined it — which is why a failure here returns
    // the Postgres text rather than an empty table.
    supabase
      .from("timesheets")
      .select(
        `id, employee_id, location_id, workday, business_date, workweek_start,
         clock_in, clock_out,
         source_hours_regular, source_hours_overtime, source_hours_double_ot,
         source_hours_paid, source_break_minutes,
         hours_regular, hours_overtime, hours_double_ot,
         ot_decision, ot_reason, unpaid_break_minutes, sick_hours, exclude_tips,
         stitched, kind, position, employee_note, manager_note, source, source_payload,
         wage_type, tip_hours, tip_allocation,
         timesheet_benefits(benefit_id, amount)`
      )
      .eq("pay_period_id", periodId)
      .order("workday"),
    // Names and the durable tip-exclusion flag, plus the two the FILE needs
    // (031). A separate query rather than an embed: the same employee appears on
    // ~20 shifts a fortnight, and embedding would send their row twenty times.
    supabase
      .from("employees")
      .select("id, first_name, last_name, excludes_tips, primary_wage_type, gusto_id, workday_starts_at"),
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
    // `id` is here for the FREEZE: `freeze_pay_period`'s pool payload names each
    // tip_pool row, so the panel cannot snapshot a rate without it.
    //
    // ONE DAY EARLIER than the period starts, since 061. A shift whose employee
    // has a workday boundary can have `workday` on the period's first day and
    // `business_date` on the day before — the punch really did happen the
    // previous evening. Its shop-day pool would then sit outside this range and
    // read as missing, which `exportReadiness` reports as a caveat about a pool
    // that exists. One day is provably enough: 061's noon floor means the
    // workday moves forward by at most one.
    supabase
      .from("tip_pools")
      .select("id, location_id, business_date, reported_cents, corrected_cents")
      .gte("business_date", addDays(periodStart, -1))
      .lte("business_date", periodEnd),
    // 033. Both small enough not to filter — an entitlement's own date range is
    // what decides which days it covers.
    supabase
      .from("payroll_benefits")
      .select("id, code, name, gusto_column, unit, default_amount, is_active")
      .eq("is_active", true),
    supabase
      .from("employee_benefits")
      .select("id, employee_id, benefit_id, location_id, amount, starts_on, ends_on"),
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
        workday_starts_at: (e.workday_starts_at ?? null) as string | null,
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

  // ---- benefits ----------------------------------------------------------
  // Derived, then the frozen snapshot laid over the top — the order the export
  // uses too, so a shift reads the same figure in the row and in the file.
  const benefits: PayrollBenefit[] = (benefitRows ?? []).map((b) => ({
    id: b.id as string,
    code: b.code as string,
    name: b.name as string,
    gusto_column: b.gusto_column as string,
    unit: b.unit as PayrollBenefit["unit"],
    default_amount: numOrNull(b.default_amount),
    is_active: (b.is_active ?? true) as boolean,
  }));
  const entitlements: BenefitEntitlement[] = (entitlementRows ?? []).map((e) => ({
    id: e.id as string,
    employee_id: e.employee_id as string,
    benefit_id: e.benefit_id as string,
    location_id: e.location_id as string,
    amount: numOrNull(e.amount),
    starts_on: (e.starts_on ?? null) as string | null,
    ends_on: (e.ends_on ?? null) as string | null,
  }));

  const benefitShifts = (sheets ?? []).map((t) => ({
    id: t.id as string,
    employee_id: t.employee_id as string,
    location_id: (t.location_id ?? null) as string | null,
    workday: t.workday as string,
    clock_in: (t.clock_in ?? null) as string | null,
    clock_out: (t.clock_out ?? null) as string | null,
  }));
  // THE FROZEN FIGURE WINS, which is backwards from how tips are handled in the
  // export panel — and deliberately. Every input to the tip allocator is gated
  // on the period being editable, so recomputing reproduces the snapshot
  // exactly. An ENTITLEMENT carries no such gate (033 argues why), so its inputs
  // really can move under a closed period, and only the snapshot knows what was
  // paid.
  const accruals = mergeFrozen(
    computeAccruals(benefitShifts, benefits, entitlements),
    (sheets ?? []).flatMap((t) =>
      ((t.timesheet_benefits ?? []) as Array<Record<string, unknown>>).map((b) => ({
        timesheet_id: t.id as string,
        benefit_id: b.benefit_id as string,
        amount: numOrNull(b.amount) ?? 0,
      }))
    ),
    new Map(benefitShifts.map((s) => [s.id, { employee_id: s.employee_id, workday: s.workday }]))
  );

  // One note per shift, computed on the SERVER: `explainShift` needs every
  // entitlement and every accrual, and shipping both to the browser to answer a
  // question per row would send the whole benefit configuration down the wire.
  const benefitNotes: Record<string, ShiftBenefitLine[]> = {};
  for (const s of benefitShifts) {
    const notes = explainShift(s, accruals, benefits, entitlements);
    if (notes.length === 0) continue;
    benefitNotes[s.id] = notes.map((n) => ({
      state: n.state,
      benefitName: n.benefit.name,
      unit: n.benefit.unit,
      amount: n.state === "accrued" ? n.amount : null,
      locationCodes:
        n.state === "not_entitled_here"
          ? n.locationIds.map((id) => codeById.get(id) ?? "—")
          : [],
    }));
  }

  const pools: Record<string, { reported_cents: number | null; corrected_cents: number | null }> = {};
  for (const p of poolRows ?? []) {
    pools[`${p.location_id}|${p.business_date}`] = {
      reported_cents: numOrNull(p.reported_cents),
      corrected_cents: numOrNull(p.corrected_cents),
    };
  }

  /* ---- the export panel's inputs ----------------------------------------
     Everything from here down was `/pay-periods/[id]`'s. It reads the same
     `sheets` the table above does, which is the merge's one measurable win:
     the two screens ran the same seven queries over the same seven tables. */

  const shifts: WorksheetShift[] = (sheets ?? []).map((t) => ({
    id: t.id as string,
    employee_id: t.employee_id as string,
    location_id: (t.location_id ?? null) as string | null,
    workday: t.workday as string,
    business_date: t.business_date as string,
    clock_in: (t.clock_in ?? null) as string | null,
    clock_out: (t.clock_out ?? null) as string | null,
    unpaid_break_minutes: numOrNull(t.unpaid_break_minutes),
    hours_regular: numOrNull(t.hours_regular),
    hours_overtime: numOrNull(t.hours_overtime),
    hours_double_ot: numOrNull(t.hours_double_ot),
    sick_hours: numOrNull(t.sick_hours),
    exclude_tips: (t.exclude_tips ?? null) as boolean | null,
    source_payload: (t.source_payload ?? null) as Record<string, unknown> | null,
  }));

  const waiverIds = new Set((waiverRows ?? []).map((w) => w.employee_id as string));

  const decidedByKey = new Map(
    (premiumRows ?? []).map((p) => [
      `${p.employee_id}|${p.workday}|${p.kind}`,
      { decision: p.decision as string },
    ])
  );
  // Every premium's hours, for the roll-up; and only the ones DECIDED as owed,
  // for the file. A finding with no decision is not a premium — decision 3's
  // whole point, and `exportReadiness` names how many are still outstanding.
  const premiumHours = new Map<string, number>();
  const owedHours = new Map<string, number>();
  for (const p of premiumRows ?? []) {
    const k = p.employee_id as string;
    const hours = numOrNull(p.hours) ?? 0;
    premiumHours.set(k, (premiumHours.get(k) ?? 0) + hours);
    if (p.decision === "owed") owedHours.set(k, (owedHours.get(k) ?? 0) + hours);
  }

  const poolMap = new Map(
    (poolRows ?? []).map((p) => [
      `${p.location_id}|${p.business_date}`,
      {
        id: p.id as string,
        reported_cents: numOrNull(p.reported_cents),
        corrected_cents: numOrNull(p.corrected_cents),
      },
    ])
  );

  // BEFORE 029 IS APPLIED these are "Could not find the table", and the panel
  // must SAY so. Swallowing them renders a tips view reading "no figure entered"
  // for every day and a breaks view where nothing is ever decided — both of
  // which look like real answers. Same reason PO detail replaces its Paperwork
  // card with the Postgres error rather than showing an empty card.
  //
  // 033's two are here for a SHARPER version of the same reason. A missing 029
  // renders a tips view that is visibly empty; a swallowed 033 renders an export
  // that looks entirely correct and is $432 short, because a benefit that
  // accrues nothing and a benefit table that isn't there produce the same blank
  // column. The shift and employee selects are NOT in here — they gate the whole
  // screen above, and `error` has already returned by this point.
  const problem = employeeError ?? premiumError ?? poolError ?? benefitError ?? entitlementError;
  const worksheetError = problem
    ? problem.message +
      (/payroll_benefits|employee_benefits|timesheet_benefits/.test(problem.message)
        ? " — migration 033 has not been applied yet."
        : /^column/i.test(problem.message)
          ? " — migration 031 has not been applied yet."
          : " — migration 029 has not been applied yet.")
    : null;

  const findings = buildFindings(shifts, employeeById, waiverIds, decidedByKey);
  const worksheetPools = buildPools(shifts, employeeById, codeById, poolMap);
  const benefitDollars = totalByEmployee(accruals);
  const earnings = earningsByEmployee(accruals, benefits);
  const rollup = buildEmployeeRollup(shifts, employeeById, findings, premiumHours, benefitDollars);

  // A benefit aimed at a column `lib/gustoExport` does not have. The picker on
  // /payroll-benefits makes that unenterable, so this is the net for a value
  // written in the SQL editor — and it names the money rather than the mistake.
  const benefitTotals = totalByBenefit(accruals);
  const unknownEarningColumns = benefits
    .filter((b) => !isEarningColumn(b.gusto_column) && (benefitTotals.get(b.id) ?? 0) > 0)
    .map((b) => ({ name: b.name, column: b.gusto_column, dollars: benefitTotals.get(b.id) ?? 0 }));

  const rawById = new Map((sheets ?? []).map((t) => [t.id as string, t]));

  // Overtime still disagreeing with our recompute, for the readiness list. Same
  // one-cent tolerance and the same comparison against the DECISION that the
  // list's own needs-review queue uses — see lib/overtime's EPSILON. It is
  // computed TWICE, here and in the browser, and the two must not drift.
  const proposals = proposeOvertime(
    shifts
      .map((s) => {
        const hours = workedHours(s);
        const wk = rawById.get(s.id)?.workweek_start as string | undefined;
        return hours === null || !wk
          ? null
          : {
              id: s.id,
              employee_id: s.employee_id,
              workday: s.workday,
              workweek_start: wk,
              hours,
              // Which shift carries the day's overtime depends on this. See
              // `ShiftHours.starts_at`.
              starts_at: s.clock_in,
            };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  );
  let overtimeNeedingReview = 0;
  for (const s of shifts) {
    const p = proposals.get(s.id);
    if (!p) continue;
    if (
      Math.abs(p.regular - (s.hours_regular ?? 0)) >= 0.015 ||
      Math.abs(p.overtime - (s.hours_overtime ?? 0)) >= 0.015 ||
      Math.abs(p.double_ot - (s.hours_double_ot ?? 0)) >= 0.015
    ) {
      overtimeNeedingReview += 1;
    }
  }

  const exportShifts = shifts.map((s) => {
    const r = rawById.get(s.id);
    return {
      id: s.id,
      employee_id: s.employee_id,
      wage_type: (r?.wage_type ?? null) as string | null,
      hours_regular: s.hours_regular,
      hours_overtime: s.hours_overtime,
      hours_double_ot: s.hours_double_ot,
      sick_hours: s.sick_hours,
      // The FROZEN allocation where there is one. On an unfrozen period the
      // panel recomputes from the pools instead, so the file and the worksheet
      // can never disagree.
      tip_allocation: numOrNull(r?.tip_allocation),
      tip_hours: numOrNull(r?.tip_hours),
    };
  });

  const exportEmployees = (employees ?? []).map((e) => ({
    id: e.id as string,
    first_name: e.first_name as string,
    last_name: e.last_name as string,
    primary_wage_type: (e.primary_wage_type ?? null) as string | null,
    gusto_id: (e.gusto_id ?? null) as string | null,
  }));

  // A fortnight holds TWO workweeks, and California weekly overtime and the
  // seventh-day rule are per workweek. Stating them in the panel is how it stops
  // anyone reading the period as the unit overtime is computed over.
  const weeks: string[] = [];
  {
    let w = workweekStart(periodStart, settings);
    const guard = 60; // a period can't sanely hold more weeks than this
    for (let i = 0; i < guard && w <= periodEnd; i++) {
      weeks.push(w);
      const next = new Date(`${w}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      w = next.toISOString().slice(0, 10);
    }
  }

  const canWrite = canRunPayroll(session.membership.role);

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Timesheets
      </h1>

      {/* Which fortnight and what state it's in, then the two commands that act
          on the PERIOD. The filters below act on the shifts. */}
      <PeriodBar periods={periods} periodId={periodId} status={chosen.status}>
        <NewPayPeriod
          rows={periods}
          today={today}
          settings={session.orgSettings.payroll}
          orgId={session.membership.org_id}
        />
        {record && (
          <ExportTimesheets
            period={record}
            canWrite={canWrite}
            timeZone={timeZone}
            weeks={weeks}
            orgName={session.orgName}
            worksheetError={worksheetError}
            rollup={rollup}
            findings={findings}
            pools={worksheetPools}
            shifts={exportShifts}
            employees={exportEmployees}
            premiumHours={[...owedHours.entries()]}
            benefits={benefits}
            accruals={accruals}
            earnings={[...earnings.entries()]}
            caveatInputs={{
              shiftsWithoutClockOut: shifts.filter((s) => !s.clock_out).length,
              undecidedBreakFindings: findings.filter((f) => !f.decided).length,
              poolsWithoutFigure: worksheetPools.filter((p) => p.effectiveCents === null).length,
              overtimeNeedingReview,
              unknownEarningColumns,
            }}
          />
        )}
      </PeriodBar>

      <TimesheetsList
        rows={rows}
        period={chosen}
        canWrite={canWrite}
        // The org's zone, not the server's: a punch is an instant, and reading
        // one back on a UTC host would show every shift seven hours out.
        timeZone={timeZone}
        waiverEmployeeIds={(waiverRows ?? []).map((w) => w.employee_id as string)}
        employees={[...employeeById.entries()]
          .map(([id, e]) => ({ id, name: e.name, workday_starts_at: e.workday_starts_at }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))}
        // ACTIVE locations only: this enumerates somewhere to put a new shift,
        // and a closed shop is not one (design rule 3).
        locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
        orgId={session.membership.org_id}
        premiums={premiums}
        pools={pools}
        benefitNotes={benefitNotes}
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
