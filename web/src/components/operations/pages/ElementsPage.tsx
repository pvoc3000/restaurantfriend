"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { CountField, TextField } from "./fields";

export type ElementBatchRow = {
  batchId: string;
  batchNumber: string;
  elementName: string;
  batchLabel: string | null;
  yieldCount: number | null;
  yieldUnit: string | null;
  status: string | null;
  notes: string | null;
};

const STATUS: PickOption[] = [
  { value: "complete", label: "Complete" },
  { value: "in_progress", label: "In progress" },
  { value: "to_do", label: "To do" },
  { value: "skipped", label: "Skipped" },
  { value: "test", label: "Test" },
];

/**
 * What the overnight bake produced — the OPENING supervisor's page.
 *
 * The mirror of Premades and never shown beside it (Mark, 2026-08-28): the
 * opener reports what was made, the closer reports what was left of it.
 *
 * Rows are today's `production_batch_logs` entry for this kitchen, which is
 * unique on (location, date) — so there is exactly one, and if it is missing
 * the week was never generated rather than the query being wrong.
 */
export function ElementsPage({
  reportId,
  orgId,
  rows,
  editable,
}: {
  reportId: string;
  orgId: string;
  rows: ElementBatchRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save(batchId: string, patch: Record<string, number | string | null>) {
    startTransition(async () => {
      const { error } = await supabase
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

  if (rows.length === 0) {
    return (
      <p className="mx-auto max-w-3xl text-sm text-muted">
        No batch log was generated for this kitchen today, so there is nothing to record. Generate
        the week from Batch Logs and it will appear here.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
            <th className="py-2 text-left">#</th>
            <th className="py-2 text-left">Element</th>
            <th className="py-2 text-left">Batch</th>
            <th className="w-28 py-2 text-right">Yield</th>
            <th className="w-28 py-2 text-left">Unit</th>
            <th className="w-40 py-2 text-left">Status</th>
            <th className="py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.batchId} className="border-b border-hairline/60">
              <td className="py-2 pr-3 text-[15px] text-muted">{r.batchNumber}</td>
              <td className="py-2 pr-3 text-[15px]">{r.elementName}</td>
              <td className="py-2 pr-3 text-[15px] text-muted">{r.batchLabel ?? "—"}</td>
              <td className="py-2 pr-2">
                <CountField
                  value={r.yieldCount}
                  onCommit={(next) => save(r.batchId, { yield_count: next })}
                  disabled={!editable}
                  ariaLabel={`Yield, ${r.elementName}`}
                />
              </td>
              <td className="py-2 pr-2">
                <TextField
                  value={r.yieldUnit}
                  onCommit={(next) => save(r.batchId, { yield_unit: next })}
                  disabled={!editable}
                  ariaLabel={`Yield unit, ${r.elementName}`}
                />
              </td>
              <td className="py-2 pr-2">
                <PickList
                  value={r.status}
                  options={STATUS}
                  onPick={(next) => save(r.batchId, { status: next })}
                  variant="field"
                  disabled={!editable}
                  placeholder="—"
                  ariaLabel={`Status, ${r.elementName}`}
                />
              </td>
              <td className="py-2">
                <TextField
                  value={r.notes}
                  onCommit={(next) => save(r.batchId, { notes: next })}
                  disabled={!editable}
                  ariaLabel={`Note, ${r.elementName}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
