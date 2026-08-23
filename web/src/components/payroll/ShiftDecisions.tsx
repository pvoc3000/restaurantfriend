"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { PickList } from "@/components/ui/PickList";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TextInput } from "@/components/ui/TextInput";
import { MEAL_CODE_LABEL, type BreakFinding } from "@/lib/breakRules";
import { effectiveExclusion } from "@/lib/timesheets";
import { formatCents, formatRate, parseDollarsToCents, type PoolResult } from "@/lib/tipPool";

/**
 * The two decisions that used to live on the pay-period worksheet, moved into
 * the timesheet row's own expansion (Mark, 2026-08-05: "I'm not sure whether
 * it's in pay periods or in timesheets, but there should be one place to do
 * what we need… Timesheets seems more natural to me because there's more info
 * there so you can judge errors more clearly").
 *
 * That is the whole argument for the move, and it is a good one: on the
 * worksheet a finding was a name, a date and a sentence, and the only way to
 * check it was to go and find the shift. Here the punches, the recorded meal,
 * the hours and the day's other shifts are all on screen above the control.
 *
 * ---------------------------------------------------------------------------
 * BOTH OF THESE ARE COARSER THAN THE ROW THEY SIT IN
 *
 * A timesheet row is one SHIFT. A meal premium is per employee-WORKDAY (§226.7
 * pays one hour per workday per category, which 029's
 * `unique (org_id, employee_id, workday, kind)` is), and a tip pool is per
 * SHOP-DAY. So on a workday holding two shifts both expansions show the same
 * premium control and write the same row, and every shift at one shop on one
 * day shows the same pool. Each says which span it covers, because a control
 * that looks per-shift and isn't would otherwise be read as one premium per
 * shift — which is the thing the law caps.
 */

const BUTTON =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

const DECISION_OPTIONS = [
  { value: "owed", label: "Owed", hint: "an hour of premium pay is due" },
  { value: "waived", label: "Waived", hint: "a signed waiver covers it" },
  { value: "not_owed", label: "Not owed", hint: "looked at; the rule wasn't broken" },
];

export type PremiumRow = {
  id: string;
  decision: string;
  hours: number;
  reason: string | null;
};

/**
 * The workday's meal premium.
 *
 * Shown whenever the day owes a finding OR already carries a decision — never
 * on a clean day, which would be a control with nothing to decide. The finding
 * is DERIVED on every render and never stored (decision 3); what gets stored is
 * this decision.
 */
export function ShiftPremium({
  employeeId,
  locationId,
  workday,
  dayShifts,
  finding,
  existing,
  editable,
  orgId,
}: {
  employeeId: string;
  locationId: string | null;
  workday: string;
  /** How many shifts this workday holds — so the control can say what it covers. */
  dayShifts: number;
  finding: BreakFinding | null;
  existing: PremiumRow | null;
  editable: boolean;
  orgId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [decision, setDecision] = useState(existing?.decision ?? "owed");
  const [reason, setReason] = useState(existing?.reason ?? "");

  if (!finding && !existing) return null;

  // A REASON IS REQUIRED ONLY FOR `owed` (migration 032). That is the decision
  // that pays an hour, and the row is the only record of why it was granted;
  // the other two may be recorded bare, because a fortnight carries ninety
  // findings and demanding a sentence for each is how a reviewer learns to stop
  // reviewing.
  const needsReason = decision === "owed";
  const ready = editable && !pending && (!needsReason || reason.trim() !== "");

  function record() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const row = {
        org_id: orgId,
        employee_id: employeeId,
        location_id: locationId,
        workday,
        kind: "meal" as const,
        decision,
        // HOURS, never dollars (decision 1). Zero when nothing is owed, so the
        // row still records that somebody looked.
        hours: decision === "owed" ? 1 : 0,
        reason: reason.trim() === "" ? null : reason.trim(),
      };

      // Upsert on the cap's own key, so recording twice from the two shifts of
      // one workday CHANGES the decision rather than colliding with 029's
      // unique index and reporting a constraint error at somebody standing in a
      // shop.
      const { data, error } = await supabase
        .from("break_premiums")
        .upsert(row, { onConflict: "org_id,employee_id,workday,kind" })
        .select("id");

      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed("Nothing was written — the database refused it. This period may no longer be open.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">Meal premium</h3>

      {finding ? (
        <div className="space-y-1">
          <p className="bg-mark-fill px-1 text-sm text-ink">{MEAL_CODE_LABEL[finding.code]}</p>
          <p className="text-sm text-muted">{finding.detail}</p>
          {finding.waivable && (
            <p className="text-[13px]">A signed meal-break waiver would cover this day.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Nothing is owed on this day now, but a decision is on file.
        </p>
      )}

      {/* What the premium COVERS. One hour per workday per category is the
          statutory cap, so on a two-shift day this control is the day's, not
          this row's — and it has to say so or it reads as one premium a shift. */}
      <p className="text-[13px] text-subtle">
        Covers the whole workday {workday}
        {dayShifts > 1 ? `, across ${dayShifts} shifts` : ""} — one hour at most, whichever
        shift it is recorded from.
      </p>

      {existing && (
        <p className="text-sm">
          Recorded:{" "}
          <span className="bg-mark-fill px-1">
            {existing.decision === "owed"
              ? `${existing.hours.toFixed(2)} premium hours`
              : existing.decision === "waived"
                ? "waived"
                : "not owed"}
          </span>
          {existing.reason && <span className="ml-2 text-muted">{existing.reason}</span>}
        </p>
      )}

      {editable ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <PickList
              variant="field"
              ariaLabel="Premium decision"
              value={decision}
              onPick={setDecision}
              options={DECISION_OPTIONS}
              className="w-40"
            />
            <TextInput
              size="sm"
              value={reason}
              onValueChange={setReason}
              placeholder={needsReason ? "Why (required)" : "Why (optional)"}
              aria-label="Reason for this decision"
              clearLabel="Clear the reason"
              className="w-64"
            />
            <button type="button" disabled={!ready} onClick={record} className={BUTTON}>
              {pending ? "Saving…" : existing ? "Change" : "Record"}
            </button>
          </div>
          {needsReason && reason.trim() === "" && (
            <p className="text-[13px] text-muted">
              An owed hour needs a reason — it is the only record of why it was granted.
            </p>
          )}
        </div>
      ) : (
        !existing && <p className="text-sm text-muted">This period is closed, so nothing can be recorded.</p>
      )}

      {failed && <p className="border border-accent px-3 py-2 text-[13px] text-accent">{failed}</p>}
    </div>
  );
}

/**
 * The shop-day's tip pool, and what this shift takes from it.
 *
 * ENTERED HERE, from any shift of that shop-day (Mark, 2026-08-05: "we need a
 * way to enter that data"). There was no writer at all before this — the
 * worksheet had one, but on a screen where you could not see the shift the
 * money was being divided over.
 *
 * The write goes through `report_pooled_tips`, the definer function 029 added,
 * NOT a direct update: RLS filters rows and not columns, and that function is
 * what lets a supervisor report the day's figure without also being able to
 * touch the corrected one beside it. It is already granted to `authenticated`,
 * so this is the same call the worksheet made, from a better place.
 */
export function ShiftTips({
  timesheetId,
  locationId,
  locationCode,
  businessDate,
  reportedCents,
  correctedCents,
  result,
  tipHours,
  allocationCents,
  excluded,
  excludeTips,
  employeeExcludesTips,
  editable,
}: {
  timesheetId: string;
  locationId: string | null;
  locationCode: string | null;
  businessDate: string;
  reportedCents: number | null;
  correctedCents: number | null;
  /** The division, or null when no figure has been entered for the day. */
  result: PoolResult | null;
  /** This shift's tip-eligible hours. */
  tipHours: number;
  /** This shift's share, in cents. */
  allocationCents: number | null;
  /** True when this shift takes nothing — by the person's default or an override. */
  excluded: boolean;
  /** The row's own tri-state: null inherits the person's default. */
  excludeTips: boolean | null;
  /** `employees.excludes_tips` — the durable flag the null inherits from. */
  employeeExcludesTips: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [entry, setEntry] = useState("");

  const effective = correctedCents ?? reportedCents;
  const cents = parseDollarsToCents(entry);
  const ready = editable && cents !== null && cents >= 0 && !pending && locationId !== null;

  function report() {
    if (!ready || !locationId) return;
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.rpc("report_pooled_tips", {
        p_location_id: locationId,
        p_business_date: businessDate,
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

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">Tips</h3>

      {/* Same warning the premium carries, for the same reason: this figure is
          the SHOP-DAY's, so editing it from here moves everyone's share. */}
      <p className="text-[13px] text-subtle">
        The pool for {locationCode ?? "this shop"} on {businessDate} — shared by everyone who
        worked it, so changing it here changes every share.
      </p>

      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-subtle">Pooled</dt>
        <dd className="tabular-nums">
          {effective === null ? (
            <span className="bg-mark-fill px-1">no figure entered</span>
          ) : (
            <>
              {formatCents(effective)}
              {correctedCents !== null && reportedCents !== null && correctedCents !== reportedCents && (
                // Both figures, never one — that a correction HAPPENED is a fact
                // worth keeping, and collapsing them loses it.
                <span className="ml-1 text-[12px] text-muted">
                  (reported {formatCents(reportedCents)}, corrected)
                </span>
              )}
            </>
          )}
        </dd>
        {result && (
          <>
            <dt className="text-subtle">Rate</dt>
            <dd className="tabular-nums">
              {formatRate(result.rateMillicents)}/hr over {result.totalTipHours.toFixed(2)} tip hours
            </dd>
          </>
        )}
        <dt className="text-subtle">This shift</dt>
        <dd className="tabular-nums">
          {excluded ? (
            <span className="text-muted">excluded from the pool</span>
          ) : allocationCents === null ? (
            <span className="text-faint">—</span>
          ) : (
            <>
              {formatCents(allocationCents)}
              <span className="ml-1 text-[12px] text-muted">for {tipHours.toFixed(2)} hours</span>
            </>
          )}
        </dd>
        {/* THE TRI-STATE MOVED HERE from the list's Tips column (Mark,
            2026-08-23), which now shows what this shift actually EARNED.
            This is its right home: it is a tip decision, and it sits directly
            under the share it governs, where "excluded from the pool" above
            and the control that causes it are one glance apart. On the list it
            was a picker in a 100px cell answering a question nobody asks while
            scanning a fortnight. */}
        <dt className="text-subtle">In pool</dt>
        <dd>
          <TipExclusion
            timesheetId={timesheetId}
            excludeTips={excludeTips}
            employeeExcludesTips={employeeExcludesTips}
            editable={editable}
          />
        </dd>
      </dl>

      {editable && locationId && (
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            size="sm"
            value={entry}
            onValueChange={setEntry}
            placeholder={effective === null ? "Card tips, e.g. 423.50" : "Replace the figure"}
            aria-label={`Pooled tips for ${locationCode ?? "this shop"} on ${businessDate}`}
            clearLabel="Clear"
            className="w-44"
          />
          <button type="button" disabled={!ready} onClick={report} className={BUTTON}>
            {pending ? "Saving…" : "Report"}
          </button>
          {entry.trim() !== "" && cents === null && (
            <span className="text-[13px] text-accent">Enter dollars and cents, e.g. 423.50</span>
          )}
        </div>
      )}

      {failed && <p className="border border-accent px-3 py-2 text-[13px] text-accent">{failed}</p>}
    </div>
  );
}

/**
 * The tri-state (decision 4). A PickList with three options, never a checkbox —
 * a checkbox cannot say the third thing, and the third thing ("included despite
 * the default") is the whole reason the column is nullable.
 *
 * Moved here from the list's Tips column on 2026-08-23, when that column
 * started showing the money instead.
 */
function TipExclusion({
  timesheetId,
  excludeTips,
  employeeExcludesTips,
  editable,
}: {
  timesheetId: string;
  excludeTips: boolean | null;
  employeeExcludesTips: boolean;
  editable: boolean;
}) {
  const effective = effectiveExclusion(excludeTips, employeeExcludesTips);
  const label =
    excludeTips === null
      ? effective
        ? "Excluded (person)"
        : "In pool"
      : excludeTips
        ? "Excluded"
        : "In pool (override)";

  if (!editable) return <span className={`${READ_ONLY_VALUE} text-muted`}>{label}</span>;

  return (
    <InlineValue
      table="timesheets"
      id={timesheetId}
      column="exclude_tips"
      kind="pick"
      value={excludeTips === null ? "" : String(excludeTips)}
      options={[
        { value: "", label: employeeExcludesTips ? "Inherit — excluded" : "Inherit — in pool" },
        { value: "true", label: "Excluded from this shift" },
        { value: "false", label: "In the pool despite the default" },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Flat payroll benefits — READ ONLY                                           */
/* -------------------------------------------------------------------------- */

/**
 * One line per benefit this person is entitled to somewhere, computed on the
 * server by `payrollBenefits.explainShift`.
 *
 * The two blocks above it are DECISIONS and carry editors. This one carries
 * none, deliberately: an accrual is arithmetic, not an adjudication — nobody
 * decides whether somebody drove to work. What it must do instead is EXPLAIN
 * ITSELF, which is the thing FileMaker's stamped dollar figure could never do.
 * A stamped $0 and a person who was never entitled look identical, and that is
 * why nobody noticed Casildo Herrera's seven consecutive unstamped DF02
 * overnights in July 2024, or that two configured people were never paid at all.
 *
 * To change what a shift earns you change the ENTITLEMENT, on the employee's
 * record. That is the only writer, and it is one place rather than one per
 * shift.
 */
export type ShiftBenefitLine = {
  state: "accrued" | "covered_elsewhere" | "not_entitled_here" | "not_worked";
  benefitName: string;
  unit: "per_shift" | "per_workday" | "per_period";
  /** Dollars, on an `accrued` line only. */
  amount: number | null;
  /** The shops they DO earn it at — `not_entitled_here` only. */
  locationCodes: string[];
};

export function ShiftBenefits({
  lines,
  locationCode,
}: {
  lines: ShiftBenefitLine[];
  locationCode: string | null;
}) {
  if (lines.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">Benefits</h3>

      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-sm">
        {lines.map((line) => (
          <Fragment key={line.benefitName}>
            <dt className="text-subtle">{line.benefitName}</dt>
            <dd>
              {line.state === "accrued" ? (
                <>
                  <span className="tabular-nums">${(line.amount ?? 0).toFixed(2)}</span>
                  <span className="ml-2 text-muted">
                    {line.unit === "per_shift"
                      ? "per shift"
                      : line.unit === "per_workday"
                        ? "per day"
                        : "per pay period"}
                    {locationCode ? ` · ${locationCode}` : ""}
                  </span>
                </>
              ) : line.state === "not_entitled_here" ? (
                // Angelica Castellanos's 359 DF01 shifts, in one sentence.
                <span className="text-muted">
                  Earned at {line.locationCodes.join(", ") || "no shop"}
                  {locationCode ? `, and this shift was at ${locationCode}` : ""}.
                </span>
              ) : line.state === "covered_elsewhere" ? (
                <span className="text-muted">
                  Already earned on {line.unit === "per_workday" ? "this workday" : "this pay period"}
                  &rsquo;s earlier shift.
                </span>
              ) : (
                <span className="text-muted">
                  This row has no punches, so nothing accrues.
                </span>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
