"use client";

import type { ReactNode } from "react";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { requestShiftFocus } from "@/lib/shiftFocus";
import { PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import {
  buildExportRows,
  exportFileName,
  exportReadiness,
  toCsv,
  GUSTO_COLUMNS,
  type ExportEmployee,
  type ExportShift,
} from "@/lib/gustoExport";
import { formatCents, formatRate } from "@/lib/tipPool";
import { totalByBenefit, type BenefitAccrual, type PayrollBenefit } from "@/lib/payrollBenefits";
import type { DayPool, WorkdayFinding, WorksheetEmployee } from "@/lib/payrollWorksheet";
import {
  daysBetween,
  formatPeriodRange,
  isPayPeriodEditable,
  type PayPeriodStatus,
} from "@/lib/payPeriods";
import { PayPeriodActions } from "./PayPeriodActions";
import { PayrollWorksheet } from "./PayrollWorksheet";
import { SyncFromSquare } from "@/components/sales/SyncFromSquare";
import { StatusChip } from "./PayPeriodStatusChip";

/**
 * What the export needs, plus the two fields the FREEZE needs. Kept here rather
 * than pushed into `ExportShift`: `lib/gustoExport` has no business knowing
 * about timesheet ids or frozen tip hours, and widening its type to carry them
 * would let a future column leak into the file by accident.
 */
type FreezeShift = ExportShift & { id: string; tip_hours: number | null };

/** The fortnight itself. Was the shape of `/pay-periods/[id]`'s own query. */
export type PayPeriodRecord = {
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

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

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
 * Running payroll for a fortnight: the period's own record, the worksheet, the
 * file, and the freeze that follows it.
 *
 * A PANEL, not a screen (Mark, 2026-08-06). This was `/pay-periods/[id]`, and
 * the pay-period LIST beside it — two screens for one fortnightly task, which
 * you reached by leaving the shifts you were working on. But the 2026-08-05
 * rework had already moved every DECISION onto the timesheet row, so what was
 * left here decides nothing: it states the period, steps it along the ladder,
 * rolls the shifts up, and produces the file. That is a ROUTINE you open, do,
 * and close — so it opens over the shifts instead of replacing them, and the
 * period `PickList` on the bar behind it is what the list used to be for.
 *
 * Export Timesheets and Close Pay Period are TWO ACTS, side by side in the
 * footer, and each MOVES THE STATUS (Mark, 2026-09-29). Before that, Export
 * was a download that changed nothing and a button labelled Close Pay Period
 * ran the freeze — which set the period to EXPORTED, not closed — while the
 * real close sat up in the Status section; Mark closed a period, found it at
 * Exported, and had to hunt for the other button. Now: EXPORT locks every tip
 * allocation and benefit accrual and marks the period exported through
 * `freeze_pay_period` (one transaction), downloading the file, and is a plain
 * download after that; CLOSE sets `closed` — payroll ran — and warns, but
 * allows, when nothing was exported. Whichever is next is the primary.
 *
 * Decision 10 is why the freeze exists at all: someone editing a March punch
 * must not silently re-derive a February allocation that disagrees with money
 * already paid. Until the freeze, everything in here is derived on each open;
 * after it, the numbers are the ones the file was built from.
 *
 * Finalize is BLACK, where on the old screen it was white. That is the rule
 * applying rather than bending: a panel exists to produce one outcome, so its
 * footer is a two-weight decision — `DIALOG_COMMIT_CLASS` beside a text Close —
 * which is exactly the case CLAUDE.md carves out. The same button on a screen
 * full of peers was correctly white.
 *
 * Nothing is rendered until it is opened. Every block in here is a client
 * component fed plain data, so a fortnight you never export costs the markup of
 * one button.
 */
export function ExportTimesheets({
  period,
  canWrite,
  timeZone,
  today,
  weeks,
  orgName,
  worksheetError,
  rollup,
  findings,
  pools,
  shifts,
  employees,
  premiumHours,
  benefits,
  accruals,
  earnings,
  caveatInputs,
  children,
}: {
  period: PayPeriodRecord;
  canWrite: boolean;
  timeZone: string;
  /** The org's calendar day — the tip sync never asks Square for tomorrow. */
  today: string;
  /** The workweeks this period spans — stated because overtime is per WEEK. */
  weeks: string[];
  orgName: string;
  /** Already worded by the server, migration hint included, or null. */
  worksheetError: string | null;
  rollup: WorksheetEmployee[];
  findings: WorkdayFinding[];
  pools: DayPool[];
  shifts: FreezeShift[];
  employees: ExportEmployee[];
  /** Employee id → premium HOURS owed (decision = 'owed'). */
  premiumHours: [string, number][];
  /** The active benefit catalog, for the summary line's names. */
  benefits: PayrollBenefit[];
  /** Every accrual in the period — what the freeze snapshots. */
  accruals: BenefitAccrual[];
  /** Employee id → Gusto column → dollars. Entries, not a Map: this crosses the
   *  server→client boundary, same as `premiumHours`. */
  earnings: [string, Record<string, number>][];
  caveatInputs: {
    shiftsWithoutClockOut: number;
    undecidedBreakFindings: number;
    poolsWithoutFigure: number;
    overtimeNeedingReview: number;
    unknownEarningColumns: { name: string; column: string; dollars: number }[];
    homebaseShiftsWithoutRate: number;
  };
  /** Hand this component's row to an `ActionMenu` instead of drawing a
   *  button — `OrderCommandMenu`'s arrangement, so the dialog, its writes and
   *  its confirms stay here and only the command's PLACE moves. */
  children?: (items: ActionMenuItem[]) => ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const premiums = useMemo(() => new Map(premiumHours), [premiumHours]);
  const earningsMap = useMemo(() => new Map(earnings), [earnings]);

  /**
   * The tip allocations, computed from the pools — the same `allocateTips` the
   * worksheet shows, so the file and the screen can never disagree. On a period
   * already frozen these are the SNAPSHOT instead; see `allocationById`.
   */
  const allocationById = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of pools) {
      if (!p.result) continue;
      for (const a of p.result.allocations) out.set(a.id, a.cents / 100);
    }
    return out;
  }, [pools]);

  const rows = useMemo(
    () =>
      buildExportRows(
        shifts.map((s) => ({ ...s, tip_allocation: allocationById.get(s.id) ?? s.tip_allocation })),
        employees,
        premiums,
        earningsMap
      ),
    [shifts, employees, premiums, earningsMap, allocationById]
  );

  const caveats = useMemo(
    () => exportReadiness({ rows, employees, ...caveatInputs }),
    [rows, employees, caveatInputs]
  );

  const csv = useMemo(() => toCsv(rows), [rows]);
  const people = new Set(rows.map((r) => r.employee_id)).size;
  const totalTips = rows.reduce((n, r) => n + (r.paycheck_tips ?? 0), 0);
  const totalPremium = rows.reduce((n, r) => n + r.missed_break_hours, 0);

  /** Per benefit, but only the ones that came to anything — a nil benefit on the
   *  summary line is a figure you have to read to learn it says nothing. */
  const benefitTotals = useMemo(() => {
    const totals = totalByBenefit(accruals);
    return benefits
      .map((b) => ({ name: b.name, dollars: totals.get(b.id) ?? 0 }))
      .filter((b) => b.dollars > 0);
  }, [benefits, accruals]);

  function download() {
    // A blob and an anchor, not a route: the file is already built in the
    // browser and a round trip would only give it a second chance to differ
    // from what's on screen.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(orgName, period.start_date);
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * EXPORTING IS WHAT MARKS THE PERIOD EXPORTED (Mark, 2026-09-29: "The status
   * should be changed to 'Exported' when I export time sheets"). Until then the
   * file was a side effect-free download and the status moved only on a
   * separate button labelled Close Pay Period — which set it to Exported, not
   * Closed, and caught him out. Now the first export of an open period locks
   * the allocations and marks it Exported (`freeze_pay_period`, one
   * transaction) and THEN downloads, so the file is always built from numbers
   * that can no longer drift. Once exported, it is a plain download again.
   */
  function exportTimesheets() {
    if (frozen || !canWrite) {
      download();
      return;
    }
    setConfirming(true);
  }

  /**
   * Close sets CLOSED — "payroll ran" — from wherever the period is (Mark,
   * 2026-09-29: "even if the timesheets [weren't] exported … if they insist we
   * should allow it"). Unexported, it says so first. Irreversible either way:
   * a closed period is never reopened.
   */
  async function closePeriod() {
    const ok = await confirmDialog(
      frozen
        ? {
            title: "Close this pay period?",
            body: "Payroll ran. A closed period is final — it can't be reopened, and a correction becomes an adjustment in the current open period.",
            confirmLabel: "Close Pay Period",
          }
        : {
            title: "Close without exporting?",
            body:
              "These timesheets haven't been exported, so their tip allocations and benefit accruals were never locked and no file was produced.\n\nA closed period is final — it can't be reopened.",
            confirmLabel: "Close Anyway",
            tone: "danger",
          }
    );
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", period.id)
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      if (!data || data.length === 0) {
        setFailed("Nothing was changed — the database refused the write. You may not have permission to run payroll.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function finalize() {
    setFailed(null);
    // DOWNLOAD FIRST, inside the click: Safari may refuse a download started
    // after an await, as no longer the user's gesture. The file is built from
    // the same allocations the lock is about to write, so the order changes
    // nothing about what is in it.
    download();
    startTransition(async () => {
      // The allocations, in the shape freeze_pay_period validates. EVERY
      // timesheet in the period must be covered or it refuses — which is what
      // stops a stale browser tab freezing a fortnight it only half knows.
      const allocations = shifts.map((s) => ({
        timesheet_id: s.id,
        tip_hours: s.tip_hours ?? 0,
        tip_allocation: allocationById.get(s.id) ?? 0,
      }));
      const poolPayload = pools
        .filter((p) => p.poolId && p.result)
        .map((p) => ({
          tip_pool_id: p.poolId,
          tip_rate_millicents: p.result!.rateMillicents,
          residual_cents: p.result!.residualCents,
        }));

      const { data, error } = await supabase.rpc("freeze_pay_period", {
        p_period_id: period.id,
        p_allocations: allocations,
        p_pools: poolPayload,
        // SPARSE by construction — most shifts accrue nothing — which is why
        // the function checks that every row it was given landed rather than
        // that every timesheet is covered, the way the allocations are.
        p_benefits: accruals.map((a) => ({
          timesheet_id: a.timesheet_id,
          benefit_id: a.benefit_id,
          amount: a.amount,
        })),
      });

      if (error) {
        setConfirming(false);
        setFailed(`The file downloaded, but the period was not marked exported: ${error.message}`);
        return;
      }
      setConfirming(false);
      // STAY: Close Pay Period, now the primary, is the next act, taken once
      // Gusto has the file.
      router.refresh();
      void data;
    });
  }

  const frozen = period.status === "exported" || period.status === "closed";

  // Decision 8 is the module's single read-only rule, and the period's own dates
  // and note are part of the record it describes.
  const editable = canWrite && isPayPeriodEditable(period.status);

  return (
    <>
      {/* BLACK ONCE THERE ARE SHIFTS TO CLOSE (Mark, 2026-08-22). The screen
          has one obvious next act and which one it is depends on the period: an
          empty fortnight wants Import timesheets, a full one wants this. That
          is exactly what `PRIMARY_BUTTON_CLASS` is for — "only ever right
          CONDITIONALLY" — rather than a standing primary, which this app does
          not have. The two never both fill, so the row still says one thing. */}
      {/* IN THE MENU (2026-09-12) — pass `children` and this hands back
          its row instead of drawing a button; the dialog below is
          unchanged and still belongs to this component. */}
      {children ? (
        children([
          {
            label: "Close Pay Period…",
            onSelect: () => setOpen(true),
          },
        ])
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={shifts.length > 0 ? PRIMARY_BUTTON_CLASS : BUTTON}
        >
          Close pay period…
        </button>
      )}

      {open && (
        <Dialog
          title={`Close pay period · ${formatPeriodRange(period)}`}
          onClose={() => !pending && setOpen(false)}
          busy={pending}
          width="max-w-5xl"
          // A DEFINITE height, not the 85vh cap: the worksheet's table alone is
          // taller than the panel, so there is no shrink-wrapping to do and a
          // cap would only make the box jump as you change view. The PO email
          // compose's precedent.
          height="h-[88vh]"
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Close
              </button>
              {/* SIDE BY SIDE, AND THE NEXT ACT IS THE PRIMARY (Mark,
                  2026-09-29): Export until the period is exported, then
                  Close. A closed period keeps only the download. */}
              {!worksheetError && (
                <button
                  type="button"
                  onClick={exportTimesheets}
                  disabled={pending}
                  className={canWrite && !frozen ? DIALOG_COMMIT_CLASS : BUTTON}
                  // UPLOAD IT AS DOWNLOADED (Mark, 2026-08-23, on seeing an id
                  // render as 1.8E+54). The FILE is right — Gusto's own import
                  // template writes `018e53` and `060f28` bare, unquoted and
                  // with no `="…"` prefix, and this produces byte-identical
                  // output. A spreadsheet is what turns `018e53` into
                  // scientific notation, and only on the way IN.
                  //
                  // So the hazard is not the export, it is opening the file to
                  // look at it and saving it again — which would send Gusto an
                  // id that no longer exists. Said here, on the control that
                  // produces it, because there is nothing to fix in the file
                  // and a fixture already stops anyone "fixing" it.
                  title="Upload this to Gusto as downloaded. Opening it in a spreadsheet can turn an employee id like 018e53 into 1.8E+54 — don't open and re-save it."
                >
                  Export Timesheets
                </button>
              )}
              {canWrite && period.status !== "closed" && (
                <button
                  type="button"
                  onClick={() => void closePeriod()}
                  disabled={pending}
                  className={frozen ? DIALOG_COMMIT_CLASS : BUTTON}
                >
                  Close Pay Period
                </button>
              )}
            </>
          }
        >
          <div className="space-y-10">
            {/* ---- what this period is ----------------------------------- */}
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
                  Overtime over 40 hours and the seventh-day rule are per
                  workweek, not per period.
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

            {/* ---- where it is on the ladder ----------------------------- */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SectionHeading>Status</SectionHeading>
                <StatusChip status={period.status} />
              </div>

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
                        <span className="block text-[13px] text-muted">
                          {period.reopen_reason}
                        </span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {/* ---- the worksheet ----------------------------------------- */}
            {worksheetError ? (
              <section className="space-y-4">
                <SectionHeading>Payroll worksheet</SectionHeading>
                <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
                  {worksheetError}
                </p>
              </section>
            ) : (
              <PayrollWorksheet
                employees={rollup}
                findings={findings}
                pools={pools}
                // CLOSE, THEN ASK. The panel sits over the shift list, so
                // leaving it up would hand you a row you cannot see; and the
                // list is a sibling under a server component, which is why this
                // goes through a store rather than a prop (see lib/shiftFocus).
                onOpenShift={(employeeId, workday) => {
                  setOpen(false);
                  requestShiftFocus(employeeId, workday);
                }}
              />
            )}

            {/* ---- the file ---------------------------------------------- */}
            {!worksheetError && (
              <section className="space-y-4">
                <SectionHeading>Payroll export</SectionHeading>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-hairline py-2 text-sm">
                  <span className="text-muted">
                    {rows.length} rows · {people} {people === 1 ? "person" : "people"}
                  </span>
                  <span>
                    Tips <strong className="tabular-nums">${totalTips.toFixed(2)}</strong>
                  </span>
                  <span>
                    Premium <strong className="tabular-nums">{totalPremium.toFixed(2)}</strong> hrs
                  </span>
                  {/* One per benefit that came to something. This is the figure
                      that has to match the Gusto file's own column, on the last
                      screen before the file leaves — which is the only place
                      anyone would catch it. */}
                  {benefitTotals.map((b) => (
                    <span key={b.name}>
                      {b.name} <strong className="tabular-nums">${b.dollars.toFixed(2)}</strong>
                    </span>
                  ))}
                  {/* Said here because this is the last thing before the file
                      leaves. */}
                  <span className="text-[12px] text-muted">
                    Sick hours are not in this file — Gusto already pays them.
                  </span>
                </div>

                {/* TIPS COME FROM SQUARE, AND ONLY FOR DAYS AN OPEN PERIOD
                    COVERS (064), so a sync taken before this period existed
                    skipped them (Mark, 2026-09-29). Migration 151 now fills
                    them when the period is created; this pulls the period
                    again — for a day synced before closing time, or a tip that
                    settled late — right where a missing figure is reported. */}
                {!frozen && canWrite && (
                  <div className="flex justify-end">
                    <SyncFromSquare
                      today={today}
                      range={{ from: period.start_date, to: period.end_date }}
                    />
                  </div>
                )}

                {frozen && (
                  <p className="max-w-[72ch] border border-ink bg-go px-4 py-3 text-sm text-ink">
                    This period is {period.status}. Its tip allocations and
                    benefit accruals are frozen, so the numbers here are the ones
                    the file was built from — not a fresh derivation that might
                    have drifted.
                  </p>
                )}

                <details className="border border-hairline">
                  <summary className="cursor-pointer px-4 py-2 text-sm">
                    Preview the first rows
                  </summary>
                  <div className="overflow-x-auto border-t border-hairline">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-ink text-left">
                          {["Name", "Title", "Payroll ID", "Reg", "OT", "Dbl", "Premium hrs", "Tips"].map(
                            (h) => (
                              <th
                                key={h}
                                className="px-3 py-2 font-semibold uppercase tracking-[0.06em]"
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 12).map((r, i) => (
                          <tr key={`${r.employee_id}-${r.title}-${i}`} className="hover:bg-neutral-50">
                            <td className="px-3 py-1.5">
                              {r.last_name}, {r.first_name}
                            </td>
                            <td className="px-3 py-1.5">
                              {r.title}
                              {r.title.trim() === "(Primary)" && (
                                <span className="ml-1 bg-mark-fill px-1">no job title</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              {r.gusto_employee_id || (
                                <span className="bg-mark-fill px-1">none</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">{r.regular_hours.toFixed(2)}</td>
                            <td className="px-3 py-1.5 tabular-nums">{r.overtime_hours.toFixed(2)}</td>
                            <td className="px-3 py-1.5 tabular-nums">
                              {r.double_overtime_hours.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">
                              {r.missed_break_hours ? r.missed_break_hours.toFixed(2) : "—"}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">
                              {r.paycheck_tips === null ? "—" : `$${r.paycheck_tips.toFixed(2)}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 12 && (
                      <p className="px-3 py-2 text-[13px] text-muted">
                        …and {rows.length - 12} more. Export the timesheets to see them all.
                      </p>
                    )}
                  </div>
                </details>

                {caveats.length > 0 && (
                  <div className="max-w-[80ch] space-y-1 border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
                    <p className="font-semibold">Unresolved in this period:</p>
                    {caveats.map((c) => (
                      <p key={c.code}>{c.detail}</p>
                    ))}
                    <p className="text-[13px]">
                      None of this blocks the export. Gate it on a complete set
                      and the period with one missing clock-out never exports,
                      which is how a status stops meaning anything.
                    </p>
                  </div>
                )}

                <p className="max-w-[80ch] text-sm text-muted">
                  Exporting locks the tip allocations and benefit accruals and
                  marks the period exported; after that the file can be taken
                  again as often as you like. Closing marks it closed — payroll
                  ran — and is final.
                </p>

                <p className="max-w-[80ch] text-[13px] text-muted">
                  The file is {GUSTO_COLUMNS.length} columns: one row per person
                  per pay rate — titled with the Homebase role worked most at
                  that rate — one of them marked <code>(Primary)</code>, and
                  every earning — tips and premium hours — on that row only.
                </p>
              </section>
            )}

            {failed && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>
            )}
          </div>
        </Dialog>
      )}

      {confirming && (
        <Dialog
          title="Export timesheets"
          onClose={() => !pending && setConfirming(false)}
          busy={pending}
          width="max-w-xl"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={finalize}
                disabled={pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Exporting…" : "Export Timesheets"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="max-w-[60ch] text-sm">
              This locks every tip allocation and every benefit accrual, marks
              the period <strong>exported</strong>, and downloads the file for
              Gusto. After it, editing a
              punch no longer moves anybody&rsquo;s tips and correcting
              somebody&rsquo;s shops next month cannot move their benefit — which
              is the point: a correction later must not silently re-divide money
              that has already been paid out.
            </p>

            {caveats.length > 0 ? (
              <div className="space-y-1 border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
                <p className="font-semibold">Still unresolved:</p>
                {caveats.map((c) => (
                  <p key={c.code}>{c.detail}</p>
                ))}
                <p className="text-[13px]">You can export it anyway.</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Nothing is outstanding.</p>
            )}

            <p className="max-w-[60ch] text-sm text-muted">
              It stays reversible: an <strong>exported</strong> period can be
              reopened, with a reason, which discards the file it produced. A{" "}
              <strong>closed</strong> one never can — that is the difference
              between the two.
            </p>

            {pools.some((p) => p.result && p.result.residualCents > 0) && (
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                <dt className="text-subtle">Tip rates</dt>
                <dd className="space-y-0.5">
                  {pools
                    .filter((p) => p.result)
                    .slice(0, 5)
                    .map((p) => (
                      <div key={`${p.location_id}-${p.business_date}`} className="tabular-nums">
                        {p.business_date} {p.locationCode} —{" "}
                        {formatRate(p.result!.rateMillicents)}/hr, residual{" "}
                        {formatCents(p.result!.residualCents)}
                      </div>
                    ))}
                </dd>
              </dl>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
