"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CountField } from "./fields";

export type PremadeRow = {
  scheduleItemId: string;
  itemType: string | null;
  subtype: string | null;
  name: string;
  par: number | null;
  made: number | null;
  leftover: number | null;
  note: string | null;
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
        setFailed(error.message);
        return;
      }
      setFailed(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="mx-auto max-w-3xl text-sm text-muted">
        No production schedule was generated for this shop today, so there is nothing to count.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      {scheduleTitle ? (
        <p className="text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.08em]">Schedule:</span>{" "}
          {scheduleTitle}
        </p>
      ) : null}

      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
            <th className="py-2 text-left">Type</th>
            <th className="py-2 text-left">Sub type</th>
            <th className="py-2 text-left">Name</th>
            <th className="py-2 text-right">Par</th>
            <th className="w-28 py-2 text-right">Made</th>
            <th className="w-28 py-2 text-right">Left</th>
            <th className="py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scheduleItemId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[15px]">{r.itemType ?? "—"}</td>
              <td className="py-2 pr-3 text-[15px]">{r.subtype ?? "—"}</td>
              <td className="py-2 pr-3 text-[15px]">{r.name}</td>
              <td className="py-2 pr-3 text-right text-[15px]">{r.par ?? "—"}</td>
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
              <td className="py-2 text-[15px] text-muted">{r.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
