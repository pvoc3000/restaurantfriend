"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ISO weekdays, 1 = Monday … 7 = Sunday (CLAUDE.md).
const DAYS = [
  { weekday: 1, label: "Mo" },
  { weekday: 2, label: "Tu" },
  { weekday: 3, label: "We" },
  { weekday: 4, label: "Th" },
  { weekday: 5, label: "Fr" },
  { weekday: 6, label: "Sa" },
  { weekday: 7, label: "Su" },
];

/**
 * Inline editor for a smallint[] of ISO weekdays (vendor order days / delivery
 * days). Click a day to toggle it; the whole array is written sorted so the
 * stored value is always canonical.
 *
 * Optimistic like the other inline controls, reverting on failure — a silent
 * no-op would leave you believing an order day was saved when it wasn't.
 */
export function WeekdayPicker({
  table,
  id,
  column,
  value,
  label,
}: {
  table: string;
  id: string;
  column: string;
  value: number[] | null;
  label: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [days, setDays] = useState<number[]>(value ?? []);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function toggle(weekday: number) {
    const next = days.includes(weekday)
      ? days.filter((d) => d !== weekday)
      : [...days, weekday].sort((a, b) => a - b);
    const previous = days;

    setDays(next);
    setFailed(false);

    startTransition(async () => {
      const { error } = await supabase
        .from(table)
        .update({ [column]: next })
        .eq("id", id);
      if (error) {
        setDays(previous);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      {DAYS.map((day) => {
        const on = days.includes(day.weekday);
        return (
          <button
            key={day.weekday}
            type="button"
            aria-pressed={on}
            aria-label={`${label}: ${day.label}`}
            disabled={pending}
            onClick={() => toggle(day.weekday)}
            className={`rounded px-1 text-xs tabular-nums disabled:opacity-50 ${
              on
                ? "bg-neutral-900 text-white"
                : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
            }`}
          >
            {day.label}
          </button>
        );
      })}
      {failed && <span className="ml-1 text-xs text-red-700">retry</span>}
    </span>
  );
}
