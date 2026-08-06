"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { SectionHeading } from "@/components/ui/SectionHeading";
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
import type { DayPool } from "@/lib/payrollWorksheet";

/**
 * What the export needs, plus the two fields the FREEZE needs. Kept here rather
 * than pushed into `ExportShift`: `lib/gustoExport` has no business knowing
 * about timesheet ids or frozen tip hours, and widening its type to carry them
 * would let a future column leak into the file by accident.
 */
type FreezeShift = ExportShift & { id: string; tip_hours: number | null };

const BUTTON =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * The export, and the freeze that follows it.
 *
 * Two separate acts, deliberately. DOWNLOAD produces the file and changes
 * nothing — you can take it as many times as you like while you check it
 * against Gusto. FINALIZE is the irreversible one: it snapshots every tip
 * allocation onto its timesheet and flips the period to `exported`, in one
 * transaction, through `freeze_pay_period`.
 *
 * Decision 10 is why the freeze exists at all: someone editing a March punch
 * must not silently re-derive a February allocation that disagrees with money
 * already paid. Until the freeze, everything on this screen is derived on each
 * load; after it, the numbers are the ones the file was built from.
 */
export function ExportPayroll({
  periodId,
  periodStart,
  orgName,
  status,
  shifts,
  employees,
  premiumHours,
  pools,
  benefits,
  accruals,
  earnings,
  caveatInputs,
  canWrite,
  closeHref,
}: {
  periodId: string;
  periodStart: string;
  orgName: string;
  status: string;
  shifts: FreezeShift[];
  employees: ExportEmployee[];
  /** Employee id → premium HOURS owed (decision = 'owed'). */
  premiumHours: [string, number][];
  pools: DayPool[];
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
  };
  canWrite: boolean;
  closeHref: string;
}) {
  const router = useRouter();
  const supabase = createClient();
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
    a.download = exportFileName(orgName, periodStart);
    a.click();
    URL.revokeObjectURL(url);
  }

  function finalize() {
    setFailed(null);
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
        p_period_id: periodId,
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
        setFailed(error.message);
        return;
      }
      setConfirming(false);
      // Finalizing is the end of the task, so it LEAVES — the receiving
      // screen's lesson. Everything still on this screen is for a fortnight you
      // have just declared done.
      router.refresh();
      router.push(closeHref);
      void data;
    });
  }

  const frozen = status === "exported" || status === "closed";

  return (
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
        {/* One per benefit that came to something. This is the figure that has
            to match the Gusto file's own column, on the last screen before the
            file leaves — which is the only place anyone would catch it. */}
        {benefitTotals.map((b) => (
          <span key={b.name}>
            {b.name} <strong className="tabular-nums">${b.dollars.toFixed(2)}</strong>
          </span>
        ))}
        {/* Said here because this is the last screen before the file leaves. */}
        <span className="text-[12px] text-muted">
          Sick hours are not in this file — Gusto already pays them.
        </span>
      </div>

      {frozen && (
        <p className="max-w-[72ch] border border-ink bg-go px-4 py-3 text-sm text-ink">
          This period is {status}. Its tip allocations and benefit accruals are
          frozen, so the numbers below are the ones the file was built from — not
          a fresh derivation that might have drifted.
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
                {["Name", "Title", "Payroll ID", "Reg", "OT", "Dbl", "Premium hrs", "Tips"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold uppercase tracking-[0.06em]">
                    {h}
                  </th>
                ))}
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
                    {r.gusto_employee_id || <span className="bg-mark-fill px-1">none</span>}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{r.regular_hours.toFixed(2)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.overtime_hours.toFixed(2)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.double_overtime_hours.toFixed(2)}</td>
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
              …and {rows.length - 12} more. Download the file to see them all.
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
            None of this blocks the export. Gate it on a complete set and the
            period with one missing clock-out never exports, which is how a
            status stops meaning anything.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={download} className={BUTTON}>
          Download the file
        </button>
        {canWrite && !frozen && (
          <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
            Finalize the period
          </button>
        )}
        <span className="max-w-[52ch] text-sm text-muted">
          Downloading changes nothing — take it as often as you like. Finalizing
          snapshots the tip allocations and benefit accruals, and marks the
          period exported.
        </span>
      </div>

      {failed && <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>}

      {confirming && (
        <Dialog
          title="Finalize this pay period"
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
              <button type="button" onClick={finalize} disabled={pending} className={DIALOG_COMMIT_CLASS}>
                {pending ? "Finalizing…" : "Finalize"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="max-w-[60ch] text-sm">
              This snapshots every tip allocation and every benefit accrual, and
              marks the period <strong>exported</strong>. After it, editing a
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
                <p className="text-[13px]">You can finalize anyway.</p>
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
                        {p.business_date} {p.locationCode} — {formatRate(p.result!.rateMillicents)}/hr,
                        residual {formatCents(p.result!.residualCents)}
                      </div>
                    ))}
                </dd>
              </dl>
            )}
          </div>
        </Dialog>
      )}

      <p className="max-w-[80ch] text-[13px] text-muted">
        The file is {GUSTO_COLUMNS.length} columns: one row per person per job
        title, the primary job marked <code>(Primary)</code>, and every earning —
        tips and premium hours — on that primary row only.
      </p>
    </section>
  );
}
