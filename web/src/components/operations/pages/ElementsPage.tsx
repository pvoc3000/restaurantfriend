"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SHIFT_REPORT_BATCH_SCHEDULE } from "@/lib/production";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { CountField, TextField } from "./fields";
import { STICKY_HEAD_ROW_UNDER_RUNNER } from "@/lib/tableHead";

export type ElementBatchRow = {
  batchId: string;
  elementName: string;
  /** This report's draft, else what the batch already holds. */
  batchCount: number | null;
  /** Who made it — the draft, else the batch's own "Prepared by" (154). */
  operatorId: string | null;
  operatorName: string | null;
  /** Anything worth reporting about this batch — the batch's own Notes. */
  notes: string | null;
};

/**
 * DONUT BATCHES — the opening and mid supervisor's page (Mark, 2026-09-30):
 * how many batches of each donut the bakers made today in this kitchen. One
 * number per donut, the total, copied from the tray guide's box.
 *
 * The rows are the kitchen's DONUT batch log for the day (153). REACHING THE
 * PAGE MAKES IT: if the log is not there yet, this generates it — every element
 * on the Donut schedule that this kitchen has on its batch log — and refreshes.
 * Generating twice only tops up, so a second report the same day, or a log
 * somebody already made on Batch Logs, is picked up rather than duplicated.
 *
 * It checks the kitchen HAS donuts first, so a shop that bakes none does not
 * collect an empty Donut log every morning.
 *
 * PREPARED BY, one per donut (Mark, 2026-09-30) — the batch record's own field,
 * from `production_operators` because a supervisor cannot read `employees`.
 *
 * The numbers and names are a DRAFT (`shift_report_batches`) until Send writes
 * them onto the batches — 070's rule for every page of this report.
 */
export function ElementsPage({
  reportId,
  orgId,
  kitchenId,
  kitchenCode,
  reportDate,
  hasLog,
  rows,
  operators,
  editable,
}: {
  reportId: string;
  orgId: string;
  kitchenId: string;
  kitchenCode: string;
  reportDate: string;
  hasLog: boolean;
  rows: ElementBatchRow[];
  operators: PickOption[];
  editable: boolean;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [nothingHere, setNothingHere] = useState(false);
  const [, startTransition] = useTransition();
  const started = useRef(false);

  useEffect(() => {
    if (hasLog || !editable || started.current) return;
    started.current = true;
    void (async () => {
      const supabase = createClient();
      const { count, error: countErr } = await supabase
        .from("production_element_locations")
        .select("id, production_elements!inner ( schedule_class, is_active )", {
          count: "exact",
          head: true,
        })
        .eq("location_id", kitchenId)
        .eq("on_batch_log", true)
        .eq("is_active", true)
        .eq("production_elements.schedule_class", SHIFT_REPORT_BATCH_SCHEDULE)
        .eq("production_elements.is_active", true);
      if (countErr) {
        setFailed(countErr.message);
        return;
      }
      if (!count) {
        setNothingHere(true);
        return;
      }
      const { error } = await supabase.rpc("generate_production_batches", {
        p_location_id: kitchenId,
        p_log_date: reportDate,
        p_schedule: SHIFT_REPORT_BATCH_SCHEDULE,
      });
      if (error) {
        setFailed(error.message);
        return;
      }
      router.refresh();
    })();
  }, [hasLog, editable, kitchenId, reportDate, router]);

  function save(
    batchId: string,
    patch:
      | { batch_count: number | null }
      | { operator_employee_id: string | null }
      | { notes: string | null }
  ) {
    startTransition(async () => {
      const { error } = await createClient()
        .from("shift_report_batches")
        .upsert(
          { org_id: orgId, report_id: reportId, batch_id: batchId, ...patch },
          { onConflict: "report_id,batch_id" }
        )
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      setFailed(null);
      router.refresh();
    });
  }

  if (failed) {
    return <p className="text-center text-[16px] text-accent">{failed}</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-center text-[16px] text-muted">
        {nothingHere || (hasLog && editable)
          ? `${kitchenCode} has no donuts on its batch log.`
          : editable
            ? "Setting up today’s donut batch log…"
            : `No donut batches were recorded at ${kitchenCode} this day.`}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <table className="w-full table-fixed">
        <colgroup>
          <col />
          <col className="w-40" />
          <col className="w-64" />
          <col />
        </colgroup>
        <thead>
          <tr
            className={`text-xs font-semibold uppercase tracking-[0.08em] ${STICKY_HEAD_ROW_UNDER_RUNNER}`}
          >
            <th className="py-2 text-left">Donut</th>
            <th className="py-2 text-right">Total batches</th>
            <th className="py-2 pl-3 text-left">Prepared by</th>
            <th className="py-2 pl-3 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.batchId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[16px]">{r.elementName}</td>
              <td className="py-2">
                <CountField
                  value={r.batchCount}
                  onCommit={(next) => save(r.batchId, { batch_count: next })}
                  disabled={!editable}
                  ariaLabel={`Total batches, ${r.elementName}`}
                />
              </td>
              <td className="py-2 pl-3">
                {editable ? (
                  // Fills its column rather than shrinking to its value, and
                  // `boxed` keeps an empty one blank rather than showing a dash
                  // — the Employees page's Position picker, for its reasons.
                  <PickList
                    variant="field"
                    size="lg"
                    boxed
                    className="w-full"
                    value={r.operatorId}
                    options={operators}
                    clearable
                    onPick={(next) =>
                      save(r.batchId, { operator_employee_id: next === "" ? null : next })
                    }
                    ariaLabel={`Prepared by, ${r.elementName}`}
                  />
                ) : (
                  <span className="text-[16px]">{r.operatorName ?? "—"}</span>
                )}
              </td>
              <td className="py-2 pl-3">
                <TextField
                  value={r.notes}
                  onCommit={(next) => save(r.batchId, { notes: next })}
                  disabled={!editable}
                  ariaLabel={`Notes, ${r.elementName}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
