"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { MEAL_CODE_LABEL } from "@/lib/breakRules";
import { formatCents, formatRate, parseDollarsToCents } from "@/lib/tipPool";
import type { DayPool, WorkdayFinding, WorksheetEmployee } from "@/lib/payrollWorksheet";

const BUTTON =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

const DECISION_OPTIONS = [
  { value: "owed", label: "Owed", hint: "a premium hour is due" },
  { value: "waived", label: "Waived", hint: "a signed waiver covers it" },
  { value: "not_owed", label: "Not owed", hint: "looked at; the rule wasn't broken" },
];

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
  editable,
  orgId,
}: {
  employees: WorksheetEmployee[];
  findings: WorkdayFinding[];
  pools: DayPool[];
  editable: boolean;
  orgId: string;
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

      {view === "hours" && <HoursBlock employees={employees} />}
      {view === "breaks" && (
        <BreaksBlock findings={findings} editable={editable} orgId={orgId} />
      )}
      {/* Every value in the worksheet is a DATE or an amount — no instants, so
          no time zone is needed anywhere below. */}
      {view === "tips" && <TipsBlock pools={pools} editable={editable} />}
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

function BreaksBlock({
  findings,
  editable,
  orgId,
}: {
  findings: WorkdayFinding[];
  editable: boolean;
  orgId: string;
}) {
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
        These are DERIVED from the punches every time this screen loads, never
        stored — a flag about a punch goes stale the moment the punch is
        corrected. What gets stored is your decision. Rest breaks are not
        assessed at all: they are paid, so they leave no punch, and anything
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
            <FindingRow
              key={`${f.employee_id}|${f.workday}|${f.finding.kind}`}
              finding={f}
              editable={editable}
              orgId={orgId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  editable,
  orgId,
}: {
  finding: WorkdayFinding;
  editable: boolean;
  orgId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [decision, setDecision] = useState("owed");
  const [reason, setReason] = useState("");

  function record() {
    if (reason.trim() === "") return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("break_premiums")
        .insert({
          org_id: orgId,
          employee_id: finding.employee_id,
          location_id: finding.location_id,
          workday: finding.workday,
          kind: finding.finding.kind,
          decision,
          // HOURS. One per premium; zero when nothing is owed, so the row still
          // records that somebody looked.
          hours: decision === "owed" ? 1 : 0,
          reason: reason.trim(),
        })
        .select("id");

      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed("Nothing was written — the database refused it. This period may no longer be open.");
        return;
      }
      setReason("");
      router.refresh();
    });
  }

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

      {!finding.decided && editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PickList
            variant="field"
            ariaLabel="Decision"
            value={decision}
            onPick={setDecision}
            options={DECISION_OPTIONS}
            className="w-44"
          />
          <TextInput
            value={reason}
            onValueChange={setReason}
            placeholder="Why (required)"
            aria-label="Reason for this decision"
            clearLabel="Clear the reason"
            className="h-8 w-80 text-[13px]"
          />
          <button
            type="button"
            disabled={pending || reason.trim() === ""}
            onClick={record}
            className={BUTTON}
          >
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      )}

      {failed && <p className="mt-2 border border-accent px-3 py-2 text-[13px] text-accent">{failed}</p>}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function TipsBlock({ pools, editable }: { pools: DayPool[]; editable: boolean }) {
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
          <PoolRow key={`${p.location_id}|${p.business_date}`} pool={p} editable={editable} />
        ))}
      </ul>
    </div>
  );
}

function PoolRow({ pool, editable }: { pool: DayPool; editable: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [entry, setEntry] = useState("");

  const cents = parseDollarsToCents(entry);
  const ready = cents !== null && cents >= 0 && !pending;

  function report() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      // The definer function, not a direct write: it is what lets a supervisor
      // record the figure without being able to touch the correction beside it.
      // RLS filters rows, not columns.
      const { error } = await supabase.rpc("report_pooled_tips", {
        p_location_id: pool.location_id,
        p_business_date: pool.business_date,
        p_cents: cents,
      });
      if (error) {
        setFailed(error.message);
        return;
      }
      setEntry("");
      router.refresh();
    });
  }

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

      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TextInput
            value={entry}
            onValueChange={setEntry}
            placeholder={pool.effectiveCents === null ? "Card tips for the day, e.g. 423.50" : "Replace the reported figure"}
            aria-label={`Pooled tips for ${pool.locationCode} on ${pool.business_date}`}
            clearLabel="Clear"
            className="h-8 w-56 text-[13px]"
          />
          <button type="button" disabled={!ready} onClick={report} className={BUTTON}>
            {pending ? "Saving…" : "Report"}
          </button>
          {entry.trim() !== "" && cents === null && (
            <span className="text-[13px] text-accent">
              Enter dollars and cents, e.g. 423.50
            </span>
          )}
        </div>
      )}

      {failed && <p className="mt-2 border border-accent px-3 py-2 text-[13px] text-accent">{failed}</p>}
    </li>
  );
}
