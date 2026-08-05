"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TabPicker } from "@/components/ui/TabPicker";
import { MEAL_CODE_LABEL } from "@/lib/breakRules";
import { formatCents, formatRate } from "@/lib/tipPool";
import type { DayPool, WorkdayFinding, WorksheetEmployee } from "@/lib/payrollWorksheet";

/**
 * The payroll worksheet: one fortnight, in the three views a human needs before
 * payroll runs.
 *
 * Everything here is a PROPOSAL until somebody records a decision. The break
 * findings are derived on every render and never stored (decision 3); the tip
 * allocations are derived until `freeze_pay_period` snapshots them (decision
 * 10). Nothing on this screen pays anybody.
 */
export function PayrollWorksheet({
  employees,
  findings,
  pools,
  timesheetsHref,
}: {
  employees: WorksheetEmployee[];
  findings: WorkdayFinding[];
  pools: DayPool[];
  /** Where the work is actually done — see the note on this component. */
  timesheetsHref: string;
}) {
  const [view, setView] = useState<"hours" | "breaks" | "tips">("hours");

  const openFindings = findings.filter((f) => !f.decided).length;
  const missingPools = pools.filter((p) => p.effectiveCents === null).length;

  return (
    <section className="space-y-4">
      <SectionHeading>Payroll worksheet</SectionHeading>

      <TabPicker
        ariaLabel="Worksheet view"
        value={view}
        onChange={setView}
        options={[
          { key: "hours", label: "Hours", count: employees.length },
          // Both counts are shown even at zero — "Breaks 0" is the answer you
          // came for, where a hidden tab only says the screen forgot to offer
          // it. The PO list's roll-up convention.
          { key: "breaks", label: "Breaks", count: openFindings },
          { key: "tips", label: "Tips", count: missingPools },
        ]}
      />

      {/* THE WORKSHEET SHOWS; THE TIMESHEETS SCREEN DECIDES (Mark, 2026-08-05:
          "there should be one place to do what we need… Timesheets seems more
          natural to me because there's more info there so you can judge errors
          more clearly").

          So Breaks and Tips kept their totals and lost their editors. A finding
          here is a name, a date and a sentence; everything you would need to
          judge it is on the shift, one click away, which is where the controls
          now live. What this screen is still for is the view before you export:
          how many decisions are outstanding, and what the totals come to. */}
      <p className="max-w-[80ch] text-sm text-muted">
        A summary, before the file is produced. Premiums and tips are recorded on
        the shift itself, where the punches are —{" "}
        <Link
          href={timesheetsHref}
          className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          open this period&rsquo;s timesheets
        </Link>
        .
      </p>

      {view === "hours" && <HoursBlock employees={employees} />}
      {view === "breaks" && <BreaksBlock findings={findings} />}
      {/* Every value in the worksheet is a DATE or an amount — no instants, so
          no time zone is needed anywhere below. */}
      {view === "tips" && <TipsBlock pools={pools} />}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function HoursBlock({ employees }: { employees: WorksheetEmployee[] }) {
  const totals = employees.reduce(
    (t, e) => ({
      regular: t.regular + e.regular,
      overtime: t.overtime + e.overtime,
      double_ot: t.double_ot + e.double_ot,
      sick: t.sick + e.sick,
      premium: t.premium + e.premiumHours,
    }),
    { regular: 0, overtime: 0, double_ot: 0, sick: 0, premium: 0 }
  );

  const num = (n: number) => <span className="tabular-nums">{n.toFixed(2)}</span>;

  const columns: DataColumn<WorksheetEmployee>[] = [
    {
      key: "name",
      label: "Employee",
      width: 260,
      pinned: true,
      sortValue: (e) => e.name,
      render: (e) => e.name,
    },
    { key: "shifts", label: "Shifts", width: 80, sortValue: (e) => e.shifts, render: (e) => <span className="tabular-nums">{e.shifts}</span> },
    { key: "regular", label: "Regular", width: 100, sortValue: (e) => e.regular, render: (e) => num(e.regular) },
    { key: "overtime", label: "OT", width: 90, sortValue: (e) => e.overtime, render: (e) => num(e.overtime) },
    { key: "double", label: "Double", width: 90, sortValue: (e) => e.double_ot, render: (e) => num(e.double_ot) },
    {
      key: "premium",
      label: "Premium",
      width: 100,
      sortValue: (e) => e.premiumHours,
      // HOURS, never dollars (decision 1). Gusto multiplies by the regular rate
      // of compensation, which is arithmetic this system deliberately doesn't own.
      render: (e) => (e.premiumHours > 0 ? <span className="bg-mark-fill px-1 tabular-nums">{e.premiumHours.toFixed(2)}</span> : <span className="text-faint">—</span>),
    },
    {
      key: "sick",
      label: "Sick",
      width: 90,
      hideWhenCompact: true,
      sortValue: (e) => e.sick,
      render: (e) => (e.sick > 0 ? <span className="text-muted tabular-nums">{e.sick.toFixed(2)}</span> : <span className="text-faint">—</span>),
    },
    {
      key: "open",
      label: "To review",
      width: 110,
      sortValue: (e) => e.openFindings,
      render: (e) =>
        e.openFindings > 0 ? (
          <span className="bg-mark-fill px-1 tabular-nums">{e.openFindings}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-hairline py-2 text-sm">
        <span className="text-muted">{employees.length} people</span>
        <span>Regular <strong className="tabular-nums">{totals.regular.toFixed(2)}</strong></span>
        <span>OT <strong className="tabular-nums">{totals.overtime.toFixed(2)}</strong></span>
        <span>Double <strong className="tabular-nums">{totals.double_ot.toFixed(2)}</strong></span>
        <span>Premium <strong className="tabular-nums">{totals.premium.toFixed(2)}</strong> hrs</span>
        {totals.sick > 0 && (
          <span className="text-muted">
            Sick <strong className="tabular-nums">{totals.sick.toFixed(2)}</strong>
            {/* Decision 7. Stated here because this is the screen someone reads
                just before producing the export, which is where the temptation
                to include it lives. */}
            <span className="ml-1 text-[12px]">— reconciliation only, never exported</span>
          </span>
        )}
      </div>
      <DataTable
        rows={employees}
        columns={columns}
        rowKey={(e) => e.employee_id}
        storageKey="rf.worksheet.hours.v1"
        columnChooser
        compactBelow={1280}
        empty={<p className="text-sm text-muted">No shifts in this pay period.</p>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BreaksBlock({ findings }: { findings: WorkdayFinding[] }) {
  const [showDecided, setShowDecided] = useState(false);
  const shown = useMemo(
    () => (showDecided ? findings : findings.filter((f) => !f.decided)),
    [findings, showDecided]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <TabPicker
          ariaLabel="Break findings"
          value={showDecided ? "all" : "open"}
          onChange={(k) => setShowDecided(k === "all")}
          options={[
            { key: "open", label: "Undecided", count: findings.filter((f) => !f.decided).length },
            { key: "all", label: "All", count: findings.length },
          ]}
        />
      </div>

      <p className="max-w-[80ch] text-sm text-muted">
        Derived from the punches every time this screen loads, never
        stored — a flag about a punch goes stale the moment the punch is
        corrected. What gets stored is your decision, and you record it on the
        shift. Rest breaks are not assessed at all: they are paid, so they leave no punch, and anything
        derived from shift length alone would flag nearly every shift.
      </p>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {findings.length === 0
            ? "No meal-break findings in this pay period."
            : "Every finding in this period has a decision recorded."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((f) => (
            <FindingRow key={`${f.employee_id}|${f.workday}|${f.finding.kind}`} finding={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: WorkdayFinding }) {
  return (
    <li className="border border-hairline px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <strong>{finding.employeeName}</strong>
        <span className="tabular-nums text-muted">{finding.workday}</span>
        <span className={finding.decided ? "text-muted" : "bg-mark-fill px-1"}>
          {MEAL_CODE_LABEL[finding.finding.code]}
        </span>
        {finding.decided && (
          <span className="text-[12px] uppercase tracking-[0.08em] text-muted">
            decided: {finding.decision}
          </span>
        )}
      </div>
      <p className="mt-1 text-muted">{finding.finding.detail}</p>
      {finding.finding.waivable && (
        <p className="mt-1 text-[13px] text-mark">
          A signed meal-break waiver would cover this day.
        </p>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function TipsBlock({ pools }: { pools: DayPool[] }) {
  const totalPooled = pools.reduce((n, p) => n + (p.effectiveCents ?? 0), 0);
  const totalResidual = pools.reduce((n, p) => n + (p.result?.residualCents ?? 0), 0);
  const missing = pools.filter((p) => p.effectiveCents === null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-hairline py-2 text-sm">
        <span className="text-muted">{pools.length} shop-days</span>
        <span>Pooled <strong className="tabular-nums">{formatCents(totalPooled)}</strong></span>
        <span className="text-muted">
          Residual <strong className="tabular-nums">{formatCents(totalResidual)}</strong>
        </span>
        {missing.length > 0 && (
          <span className="bg-mark-fill px-2 text-ink">{missing.length} with no figure entered</span>
        )}
      </div>

      <p className="max-w-[80ch] text-sm text-muted">
        The rate is the whole calculation in one number — pooled tips divided by
        non-excluded hours worked. Every allocation beneath it can be checked by
        hand from that figure. The residual is the cents that had to be handed
        out beyond everyone&rsquo;s exact share so the total matches what Square
        collected; it is never more than a cent per person.
      </p>

      <ul className="space-y-2">
        {pools.map((p) => (
          <PoolRow key={`${p.location_id}|${p.business_date}`} pool={p} />
        ))}
      </ul>
    </div>
  );
}

function PoolRow({ pool }: { pool: DayPool }) {
  const r = pool.result;

  return (
    <li className="border border-hairline px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <strong className="tabular-nums">{pool.business_date}</strong>
        <span className="text-muted">{pool.locationCode}</span>
        <span className="text-muted">{pool.people} people</span>
        {pool.effectiveCents === null ? (
          <span className="bg-mark-fill px-1">No figure entered</span>
        ) : (
          <>
            <span>
              Pooled <strong className="tabular-nums">{formatCents(pool.effectiveCents)}</strong>
              {pool.correctedCents !== null && pool.reportedCents !== null &&
                pool.correctedCents !== pool.reportedCents && (
                  // Both figures, never one. That a correction HAPPENED is a
                  // fact worth keeping, and collapsing them loses it.
                  <span className="ml-1 text-[12px] text-muted">
                    (reported {formatCents(pool.reportedCents)}, corrected)
                  </span>
                )}
            </span>
            {r && (
              <>
                <span>
                  Rate <strong className="tabular-nums">{formatRate(r.rateMillicents)}</strong>/hr
                </span>
                <span className="text-muted tabular-nums">
                  over {r.totalTipHours.toFixed(2)} tip hours
                </span>
                {r.residualCents > 0 && (
                  <span className="text-muted">
                    residual {formatCents(r.residualCents)}
                  </span>
                )}
                {r.unallocatedCents > 0 && (
                  <span className="bg-mark-fill px-1">
                    {formatCents(r.unallocatedCents)} unallocated — nobody eligible
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>

    </li>
  );
}
