"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickSet } from "@/components/ui/PickSet";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";

/**
 * Which shifts this template is asked for.
 *
 * `ui/PickSet` rather than an `InlineValue`, because the column is a text ARRAY
 * and `InlineValue`'s array support writes ONE SLOT of a positional strip (the
 * `par_by_weekday` idiom) — the wrong shape entirely for a set.
 *
 * PickSet's own semantics are already the ones 076 wants: an empty selection
 * reads as "all", which here is "any shift". It is stored as NULL rather than
 * `{}` because 076 refuses the empty array, deliberately, so that "any" has
 * exactly one spelling.
 */
export function TemplateShiftSet({
  templateId,
  value,
}: {
  templateId: string;
  value: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [shifts, setShifts] = useState<string[]>(value);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function write(next: string[]) {
    const before = shifts;
    setShifts(next);
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("checklist_templates")
        .update({ shifts: next.length ? next : null })
        .eq("id", templateId)
        // A write that matches no policy changes 0 rows and returns NO error,
        // so the row count is the only honest success test.
        .select("id");
      if (error || !data || data.length === 0) {
        setShifts(before);
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <PickSet
        label="Shifts"
        noun="shift"
        allLabel="Any shift"
        boxed={BOXED_FIELDS}
        value={shifts}
        onChange={write}
        options={SHIFT_SLOT_OPTIONS.map((o) => ({
          value: String(o.value),
          label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
        }))}
      />
      {failed && <p className="text-[12px] text-accent">{failed}</p>}
    </div>
  );
}
