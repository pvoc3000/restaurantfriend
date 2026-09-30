"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SHIFT_REPORT_BATCH_SCHEDULE } from "@/lib/production";
import { UNIT_PICK_OPTIONS } from "@/lib/units";

/**
 * "batch" FIRST, then the app's units. It is the unit this page is almost
 * always in and the vocabulary lacks it (the batch log takes it through
 * `allowNew`); 155 stored today's counts under it, lower case.
 */
const MADE_UNITS: PickOption[] = [{ value: "batch", label: "batch" }, ...UNIT_PICK_OPTIONS];
import { PickList, type PickOption } from "@/components/ui/PickList";
import { CountField, TextField } from "./fields";
import { STICKY_HEAD_ROW_UNDER_RUNNER } from "@/lib/tableHead";

export type ElementBatchRow = {
  batchId: string;
  elementName: string;
  /**
   * MADE — the batch's own count × size unit (Mark, 2026-09-30: "reuse the
   * 'made' fields from the regular batch log … The three fields"). Each is this
   * report's draft, else what the batch already holds.
   */
  yieldCount: number | null;
  yieldSize: number | null;
  yieldUnit: string | null;
  /** Who made it — the draft, else the batch's own "Prepared by" (154). */
  operatorId: string | null;
  operatorName: string | null;
  /** Anything worth reporting about this batch — the batch's own Notes. */
  notes: string | null;
};

/**
 * DONUT BATCHES — the opening and mid supervisor's page (Mark, 2026-09-30):
 * how much of each donut the bakers made today in this kitchen, copied from
 * the tray guide's box — in the batch's own MADE fields, count × size unit,
 * the same three the batch log edits (155 retired a separate batch count).
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
      | { yield_count: number | null }
      | { yield_size: number | null }
      | { yield_unit: string | null }
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

  /**
   * PREPARED BY FOR EVERY ROW (Mark, 2026-09-30) — "sets all the individual
   * prepared by fields to the same employee … The user can still change the
   * individual ones later". ONE upsert naming only that column, so each row's
   * Made and Notes drafts are left alone.
   */
  function saveAllPreparers(operatorId: string | null) {
    startTransition(async () => {
      const { error } = await createClient()
        .from("shift_report_batches")
        .upsert(
          rows.map((r) => ({
            org_id: orgId,
            report_id: reportId,
            batch_id: r.batchId,
            operator_employee_id: operatorId,
          })),
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

  // The shared picker READS the rows rather than holding its own state: it
  // names a person only while every row has that person, so once one row is
  // changed it goes blank instead of claiming something no longer true.
  const shared = rows.length > 0 && rows.every((r) => r.operatorId === rows[0].operatorId)
    ? rows[0].operatorId
    : null;

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
    <div className="mx-auto max-w-6xl space-y-4">
      <table className="w-full table-fixed">
        <colgroup>
          <col />
          {/* Made is sized to its three boxes and Prepared by to a name, so
              Notes takes the rest (Mark, 2026-09-30). */}
          <col className="w-[19rem]" />
          <col className="w-48" />
          <col />
        </colgroup>
        <thead>
          <tr
            className={`text-xs font-semibold uppercase tracking-[0.08em] ${STICKY_HEAD_ROW_UNDER_RUNNER}`}
          >
            {/* `align-top` on every label, so they stay on one line while the
                Prepared by header grows a picker beneath its own. */}
            <th className="py-2 text-left align-top">Donut</th>
            <th className="py-2 text-left align-top">Made</th>
            <th className="py-2 pl-3 text-left align-top">
              Prepared by
              {/* THE EVERY-DONUT PICKER SITS IN THE COLUMN IT FILLS (Mark,
                  2026-09-30), at that column's width, and sticks with the
                  header. The wrapper undoes the header row's caps and tracking,
                  which the picker would otherwise inherit. */}
              {editable && rows.length > 1 ? (
                <div className="mt-2 font-normal normal-case tracking-normal">
                  <PickList
                    variant="field"
                    size="lg"
                    boxed
                    className="w-full"
                    value={shared}
                    options={operators}
                    clearable
                    onPick={(next) => saveAllPreparers(next === "" ? null : next)}
                    ariaLabel="Prepared by, every donut"
                  />
                </div>
              ) : null}
            </th>
            <th className="py-2 pl-3 text-left align-top">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.batchId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[16px]">{r.elementName}</td>
              <td className="py-2">
                {/* The batch log's Triple, at the runner's 48px: count × size,
                    then the unit — `MADE_UNITS`, `allowNew` like the log's. */}
                <div className="flex items-center gap-1">
                  <div className="w-20 shrink-0">
                    <CountField
                      value={r.yieldCount}
                      onCommit={(next) => save(r.batchId, { yield_count: next })}
                      disabled={!editable}
                      ariaLabel={`Made count, ${r.elementName}`}
                    />
                  </div>
                  <span className="shrink-0 text-subtle">×</span>
                  <div className="w-20 shrink-0">
                    <CountField
                      value={r.yieldSize}
                      onCommit={(next) => save(r.batchId, { yield_size: next })}
                      disabled={!editable}
                      ariaLabel={`Made size, ${r.elementName}`}
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <PickList
                      variant="field"
                      size="lg"
                      boxed
                      allowNew
                      className="w-full"
                      value={r.yieldUnit}
                      options={MADE_UNITS}
                      disabled={!editable}
                      onPick={(next) =>
                        save(r.batchId, { yield_unit: next === "" ? null : next })
                      }
                      ariaLabel={`Made unit, ${r.elementName}`}
                    />
                  </div>
                </div>
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
