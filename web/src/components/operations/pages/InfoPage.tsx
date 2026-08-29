"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DateField } from "@/components/ui/DateField";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { FieldLabel } from "./fields";
import { SHIFT_SLOT_LABEL, type ShiftSlot } from "@/lib/shiftReports";

const SHIFT_OPTIONS: PickOption[] = (
  ["opening", "mid", "closing", "off_site"] as ShiftSlot[]
).map((s) => ({ value: s, label: SHIFT_SLOT_LABEL[s] }));

/**
 * FMP's page 1, hints and all.
 *
 * `next_production_date` is asked HERE and used on page 7 — which is why it is
 * on the first page rather than beside the thing it governs: the person who
 * knows it is the one filling in the header, and by page 7 you want the paper,
 * not the question.
 *
 * Changing the SHIFT here re-derives the whole page set, so an opening report
 * corrected to closing grows the sales, premades and paper pages immediately.
 */
export function InfoPage({
  reportId,
  reportDate,
  shift,
  supervisorId,
  nextProductionDate,
  locationCode,
  takers,
  editable,
}: {
  reportId: string;
  reportDate: string;
  shift: ShiftSlot;
  supervisorId: string | null;
  nextProductionDate: string | null;
  locationCode: string;
  takers: PickOption[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [, startTransition] = useTransition();

  function save(patch: Record<string, string | null>) {
    startTransition(async () => {
      // `.select()` on every write: an update matching no policy changes
      // nothing and PostgREST returns NO error, so a bare update would report
      // a cheerful success and the refresh would put the old value back.
      await supabase.from("shift_reports").update(patch).eq("id", reportId).select("id");
      router.refresh();
    });
  }

  return (
    // ONE WIDTH FOR EVERY FIELD (Mark, 2026-08-28). The two PickLists sized to
    // their own content while the dates filled the column, so a column of five
    // fields had three different right edges. The detail-field convention is
    // that the TRACK is the width — the block defines one edge and every field
    // in it shares both.
    <div className="mx-auto max-w-2xl space-y-8">
      {/* LOCATION LEADS, because it is the one thing here nobody can change
          (Mark, 2026-08-28) — a read-only value below four editable ones reads
          as a field that has stopped working. At the top it is the heading it
          actually is: which shop this report is about. */}
      <div className="space-y-2">
        <FieldLabel>Location</FieldLabel>
        <p className="text-[16px] font-semibold">{locationCode}</p>
      </div>

      <label className="block space-y-2">
        <FieldLabel hint="the day your shift started, not ended!">Date</FieldLabel>
        <DateField
          value={reportDate}
          onChange={(next) => next && save({ report_date: next })}
          variant="field"
          boxed
          disabled={!editable}
          ariaLabel="The date the shift started"
        />
      </label>

      <div className="space-y-2">
        <FieldLabel>Supervisor</FieldLabel>
        <PickList
          value={supervisorId}
          options={takers}
          onPick={(next) => save({ supervisor_employee_id: next })}
          placeholder="Who ran the shift"
          variant="field"
          size="lg"
          boxed
          className="w-full"
          disabled={!editable}
          ariaLabel="The supervisor who ran this shift"
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Shift</FieldLabel>
        <PickList
          value={shift}
          options={SHIFT_OPTIONS}
          onPick={(next) => save({ shift: next })}
          variant="field"
          size="lg"
          boxed
          className="w-full"
          disabled={!editable}
          ariaLabel="Which shift"
        />
      </div>

      <label className="block space-y-2">
        <FieldLabel hint="typically tomorrow, but could be any date in the future.">
          Next production day
        </FieldLabel>
        <DateField
          value={nextProductionDate}
          onChange={(next) => save({ next_production_date: next })}
          variant="field"
          boxed
          disabled={!editable}
          ariaLabel="The next day production happens"
        />
      </label>
    </div>
  );
}
