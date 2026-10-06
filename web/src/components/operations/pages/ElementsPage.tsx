"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOptimisticRows } from "@/lib/useOptimisticRows";
import { SHIFT_REPORT_BATCH_SCHEDULE } from "@/lib/production";
import { UNIT_PICK_OPTIONS } from "@/lib/units";
import { amountTotal } from "@/lib/productionBatches";

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
 * the tray guide's box — in the batch's own MADE fields, one amount and its
 * unit (the batch log's count × size, with the count dropped 2026-10-01; 155
 * retired a separate batch count).
 *
 * The rows are the kitchen's DONUT batch log for the day (153), narrowed to
 * the donuts today's schedules at this kitchen call for (Mark, 2026-10-06) —
 * the page works that out and hands over `toGenerate`, the ones not on the log
 * yet. REACHING THE PAGE MAKES THEM: generating only tops up, so a second
 * report the same day, or a log somebody already made on Batch Logs, is picked
 * up rather than duplicated. A kitchen with nothing to record has no page.
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
  toGenerate,
  rows,
  operators,
  editable,
}: {
  reportId: string;
  orgId: string;
  kitchenId: string;
  kitchenCode: string;
  reportDate: string;
  /** Donut elements asked for today with no batch on the log yet. */
  toGenerate: string[];
  rows: ElementBatchRow[];
  operators: PickOption[];
  editable: boolean;
}) {
  const router = useRouter();
  /** Generating the log failed — there is no page to show without it. */
  const [setupFailed, setSetupFailed] = useState<string | null>(null);
  /** A save failed — said above the table; the row has gone back already. */
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (toGenerate.length === 0 || !editable || started.current) return;
    started.current = true;
    void (async () => {
      const supabase = createClient();
      const args = {
        p_location_id: kitchenId,
        p_log_date: reportDate,
        p_schedule: SHIFT_REPORT_BATCH_SCHEDULE,
      };
      let { error } = await supabase.rpc("generate_production_batches", {
        ...args,
        p_element_ids: toGenerate,
      });
      // Before migration 175 the function takes no element list: generate the
      // whole log, as it always did. The page still shows only what is asked.
      if (error?.code === "PGRST202") {
        ({ error } = await supabase.rpc("generate_production_batches", args));
      }
      if (error) {
        setSetupFailed(error.message);
        return;
      }
      router.refresh();
    })();
  }, [toGenerate, editable, kitchenId, reportDate, router]);

  // EVERY CHANGE SHOWS ON THE TAP (Mark, 2026-09-30: "make the app feel
  // better. Especially on tablets") — `useOptimisticRows`, as Ratings and
  // Premades already do. The write and the refresh follow behind.
  const { rows: shown, optimistic } = useOptimisticRows(rows, (r) => r.batchId);

  /**
   * Save the WHOLE ROW, every time (156). The draft starts as a copy of what
   * the batch held, so NULL in it means "emptied" rather than "untouched" —
   * which is what lets a cleared box stay cleared, and lets Send empty the
   * batch. Upserting only the changed column made a fresh draft row hold NULL
   * everywhere else, and the page then fell back to the batch's old number.
   */
  function write(ids: string[], patch: Partial<ElementBatchRow>) {
    const next = shown
      .filter((r) => ids.includes(r.batchId))
      .map((r) => ({ ...r, ...patch }));
    setFailed(null);
    void optimistic(ids, patch, async () => {
      const { error } = await createClient()
        .from("shift_report_batches")
        .upsert(
          next.map((r) => ({
            org_id: orgId,
            report_id: reportId,
            batch_id: r.batchId,
            yield_count: r.yieldCount,
            yield_size: r.yieldSize,
            yield_unit: r.yieldUnit,
            operator_employee_id: r.operatorId,
            notes: r.notes,
          })),
          { onConflict: "report_id,batch_id" }
        )
        .select("id");
      if (error) {
        setFailed(error.message);
        return false;
      }
      router.refresh();
      return true;
    });
  }

  function setPreparer(ids: string[], operatorId: string | null) {
    write(ids, {
      operatorId,
      operatorName: operatorId
        ? operators.find((o) => o.value === operatorId)?.label ?? null
        : null,
    });
  }

  // The shared picker READS the rows rather than holding its own state: it
  // names a person only while every row has that person, so once one row is
  // changed it goes blank instead of claiming something no longer true.
  // "Sets all the individual prepared by fields to the same employee … The
  // user can still change the individual ones later" (Mark, 2026-09-30).
  const shared =
    shown.length > 0 && shown.every((r) => r.operatorId === shown[0].operatorId)
      ? shown[0].operatorId
      : null;

  if (setupFailed) {
    return <p className="text-center text-[16px] text-accent">{setupFailed}</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-center text-[16px] text-muted">
        {editable && toGenerate.length > 0
          ? "Setting up today’s donut batch log…"
          : `No donut batches were recorded at ${kitchenCode} this day.`}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      <table className="w-full table-fixed">
        <colgroup>
          <col />
          {/* Made is sized to its box and unit and Prepared by to a name, so
              Notes takes the rest (Mark, 2026-09-30). */}
          <col className="w-[13rem]" />
          <col className="w-48" />
          <col />
        </colgroup>
        <thead>
          <tr
            className={`text-xs font-semibold uppercase tracking-[0.08em] ${STICKY_HEAD_ROW_UNDER_RUNNER}`}
          >
            {/* BOTTOM-ALIGNED (Mark, 2026-09-30), so each label sits on the
                row it heads — level with the Prepared by picker's foot. */}
            <th className="py-2 text-left align-bottom">Donut</th>
            <th className="py-2 text-left align-bottom">Made</th>
            {/* `z-30!` lifts this header over its sticky neighbour: Notes comes
                later and paints its white ground over the picker's 3px shadow,
                which is what clipped its right side. */}
            <th className="py-2 pl-3 text-left align-bottom z-30!">
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
                    onPick={(next) =>
                      setPreparer(
                        shown.map((r) => r.batchId),
                        next === "" ? null : next
                      )
                    }
                    ariaLabel="Prepared by, every donut"
                  />
                </div>
              ) : null}
            </th>
            <th className="py-2 pl-3 text-left align-bottom">Notes</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.batchId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[16px]">{r.elementName}</td>
              <td className="py-2">
                {/* ONE BOX AND THE UNIT (Mark, 2026-10-01: the count × size
                    pair "is confusing to most people"). The box is the amount,
                    so it shows the batch's total — 155 put today's numbers in
                    the count — and an edit clears the count it no longer shows,
                    which would otherwise multiply whatever is typed. */}
                <div className="flex items-center gap-1">
                  <div className="w-20 shrink-0">
                    <CountField
                      value={amountTotal(r.yieldCount, r.yieldSize)}
                      onCommit={(next) =>
                        write([r.batchId], { yieldCount: null, yieldSize: next })
                      }
                      disabled={!editable}
                      ink
                      ariaLabel={`Made, ${r.elementName}`}
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
                        write([r.batchId], { yieldUnit: next === "" ? null : next })
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
                      setPreparer([r.batchId], next === "" ? null : next)
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
                  onCommit={(next) => write([r.batchId], { notes: next })}
                  disabled={!editable}
                  ink
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
