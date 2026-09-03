"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { CountField, TextField } from "./fields";

export type PremadeRow = {
  scheduleItemId: string;
  itemType: string | null;
  size: string | null;
  subtype: string | null;
  name: string;
  par: number | null;
  made: number | null;
  leftover: number | null;
  /**
   * The SCHEDULE's own note — an instruction, snapshotted at generation and
   * printed on the packet as what the kitchen was told to make.
   */
  note: string | null;
  /**
   * The SUPERVISOR's note about this count — migration 081.
   *
   * A different fact from `note` and kept apart from it deliberately: one is
   * the order, the other is what happened to it. Writing the second over the
   * first would corrupt a document somebody has already worked from, which is
   * why 081 adds a column rather than flushing through to the schedule line.
   */
  countNote: string | null;
};

/**
 * FMP's page 4 — what was made and what is left.
 *
 * DELIBERATELY NOT `ScheduleLines`. That component writes `made` and `leftover`
 * straight through `set_schedule_actual`, which is the one thing this report
 * defers: nothing reaches the schedule until Send. These boxes write the
 * report's own draft rows and the flush moves them across in one transaction.
 *
 * The rows come from `v_production_schedule_lines` for TODAY at this shop —
 * the schedule the night before produced. Tomorrow's is page 7, and confusing
 * the two would have the closer counting donuts nobody has made yet.
 */
export function PremadesPage({
  reportId,
  orgId,
  scheduleTitle,
  rows,
  editable,
}: {
  reportId: string;
  orgId: string;
  scheduleTitle: string | null;
  rows: PremadeRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Rows with nothing in the Left column yet — what the button below fills. */
  const uncounted = rows.filter((r) => r.leftover === null);

  /**
   * "Nothing left over" — every EMPTY Left box becomes 0, in one write.
   *
   * The other half of making the send gate strict (Mark, 2026-09-02). Counting
   * is now required before a report can go, and measured over every report ever
   * sent nobody had counted more than 13 lines of 32 — so the requirement on
   * its own would simply have stopped reports going out. The usual answer at
   * close is "none left" and typing it thirty-two times is the whole burden.
   *
   * IT NEVER OVERWRITES A COUNT — only rows where Left is empty, which is
   * `Receive n from invoice`'s rule and for its reason: a number somebody
   * counted is a measurement, and a batch button must not silently replace one.
   * The label names how many it will fill, so there is no confirm to read: what
   * it is about to do is on its face, and pressing it again does nothing.
   *
   * `made` is deliberately untouched — the per-row arrow already takes the par,
   * and asserting that everything on the sheet was MADE is a different claim
   * from saying nothing came back.
   */
  function nothingLeftOver() {
    if (uncounted.length === 0) return;
    startTransition(async () => {
      // ONE upsert for every row. Uniform keys, which PostgREST's bulk upsert
      // requires — and because `made` is not among them it is left alone on
      // rows that already have one rather than being reset.
      const { error } = await supabase
        .from("shift_report_counts")
        .upsert(
          uncounted.map((r) => ({
            org_id: orgId,
            report_id: reportId,
            schedule_item_id: r.scheduleItemId,
            leftover: 0,
          })),
          { onConflict: "report_id,schedule_item_id" }
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

  function save(scheduleItemId: string, patch: Record<string, number | string | null>) {
    startTransition(async () => {
      // UPSERT on the pair, because most lines have no draft row until somebody
      // types in one — an update would match nothing and report success.
      const { error } = await supabase
        .from("shift_report_counts")
        .upsert(
          { org_id: orgId, report_id: reportId, schedule_item_id: scheduleItemId, ...patch },
          { onConflict: "report_id,schedule_item_id" }
        )
        .select("id");
      if (error) {
        // Name the migration when the message names the column — the same
        // courtesy every other screen in this app extends, and here the fix is
        // one `alter table` rather than anything the reader did wrong.
        setFailed(
          /note/.test(error.message)
            ? `${error.message} — if this names a missing column, migration 081 has not been applied yet.`
            : error.message
        );
        return;
      }
      setFailed(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-center text-sm text-muted">
        No production schedule was generated for this shop today, so there is nothing to count.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {scheduleTitle ? (
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.08em]">Schedule:</span>{" "}
            {scheduleTitle}
          </p>
        ) : (
          <span />
        )}
        {editable ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            // Disabled rather than hidden once every row has a count, so the
            // control does not appear and vanish as the sheet fills in.
            disabled={uncounted.length === 0}
            onClick={nothingLeftOver}
          >
            Nothing left over
            {uncounted.length > 0 ? ` (${uncounted.length})` : ""}
          </button>
        ) : null}
      </div>

      {/* `table-fixed` with a colgroup, or the two 112px input columns push the
          Note header into Left's and it renders as "LEFTNOTE". A `w-28` on a
          `th` is a suggestion an auto-layout table is free to ignore. */}
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[9%]" />
          <col className="w-[11%]" />
          <col className="w-[24%]" />
          <col className="w-[7%]" />
          <col className="w-[5%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[19%]" />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
            <th className="py-2 pr-3 text-left">Type</th>
            <th className="py-2 pr-3 text-left">Sub type</th>
            <th className="py-2 pr-3 text-left">Name</th>
            <th className="py-2 pr-1 text-right">Par</th>
            <th className="py-2" />
            <th className="py-2 pr-2 text-right">Made</th>
            <th className="py-2 pr-2 text-right">Left</th>
            <th className="py-2 pl-4 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scheduleItemId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[15px]">{r.itemType ?? "—"}</td>
              <td className="py-2 pr-3 text-[15px]">{r.subtype ?? "—"}</td>
              <td className="py-2 pr-3 text-[15px]">{r.name}</td>
              <td className="py-2 pr-1 text-right text-[15px]">{r.par ?? "—"}</td>
              {/* TAKE THE PAR (Mark, 2026-08-28). The receiving screen's `→`
                  idiom, and for its reason: the usual answer is "we made what
                  we were asked to", and typing it out forty times is the work.
                  An ARROW rather than a prefilled box — a box that filled
                  itself would make merely OPENING the page look like somebody
                  had counted, which is the one thing the report must not
                  claim. Hidden when there is no par to take, and when the made
                  figure already equals it. */}
              <td className="py-2 pr-1 text-center align-middle">
                {editable && r.par !== null && r.made !== r.par ? (
                  <button
                    type="button"
                    className="px-2 py-2 text-lg leading-none text-muted hover:text-ink"
                    onClick={() => save(r.scheduleItemId, { made: r.par })}
                    title={`Made ${r.par}`}
                    aria-label={`Made ${r.par}, ${r.name}`}
                  >
                    &rarr;
                  </button>
                ) : null}
              </td>
              <td className="py-2 pr-2">
                <CountField
                  value={r.made}
                  onCommit={(next) => save(r.scheduleItemId, { made: next })}
                  disabled={!editable}
                  ariaLabel={`Made, ${r.name}`}
                />
              </td>
              <td className="py-2 pr-2">
                <CountField
                  value={r.leftover}
                  onCommit={(next) => save(r.scheduleItemId, { leftover: next })}
                  disabled={!editable}
                  ariaLabel={`Left over, ${r.name}`}
                />
              </td>
              {/* TWO NOTES IN ONE COLUMN'S WIDTH — PO detail's Item cell in
                  another costume. The schedule's own note sits above as muted
                  context (it is what the kitchen was ASKED to do, and it is
                  worth having in front of you while you count), and the field
                  below is the supervisor's own. Most lines have neither, so the
                  cell is usually just the box. */}
              <td className="py-2 pl-4 align-top">
                {r.note ? (
                  <p className="pb-1 text-[13px] leading-snug text-muted">{r.note}</p>
                ) : null}
                <TextField
                  value={r.countNote}
                  onCommit={(next) => save(r.scheduleItemId, { note: next })}
                  disabled={!editable}
                  ariaLabel={`Note, ${r.name}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
