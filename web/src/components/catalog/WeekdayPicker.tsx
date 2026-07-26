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
 * Inline editor for a smallint[] of ISO weekdays — vendor order/delivery days
 * (`vendor_locations`) and item order days (`inventory_item_locations`, schema
 * 008) alike. Click a day to toggle it; the whole array is written sorted so
 * the stored value is always canonical.
 *
 * Toggling only edits the array: item order days no longer create or destroy
 * plan rows, so clearing a day can't throw away favorites or their par
 * overrides (the defect the old OrderDaysPicker had). Clearing every day takes
 * the item out of focus while keeping it reachable on the guide; empty is
 * meaningful, never "any day" (Mark, 2026-07-22).
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

  function write(next: number[]) {
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

  function toggle(weekday: number) {
    write(
      days.includes(weekday)
        ? days.filter((d) => d !== weekday)
        : [...days, weekday].sort((a, b) => a - b)
    );
  }

  // All-on / all-off in one click — seven clicks to say "every day" is the
  // kind of friction that stops config from being kept accurate.
  const allOn = days.length === DAYS.length;
  function toggleAll() {
    write(allOn ? [] : DAYS.map((d) => d.weekday));
  }

  return (
    <span className="inline-flex items-center">
      {/* Seven butted boxes sharing one black rule — the modern form of the
          original's 7-column day grid. */}
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
            className={`inline-flex h-8 w-8 items-center justify-center border border-l-0 border-ink text-xs tabular-nums transition-colors first:border-l disabled:opacity-35 ${
              on ? "bg-ink text-white" : "bg-white text-faint hover:text-ink"
            }`}
          >
            {day.label}
          </button>
        );
      })}
      {/* An underlined text link so it reads as a command, not an 8th day. */}
      <button
        type="button"
        aria-pressed={allOn}
        aria-label={`${label}: ${allOn ? "clear every day" : "select every day"}`}
        disabled={pending}
        onClick={toggleAll}
        title={allOn ? "Clear every day" : "Select every day"}
        className="ml-2 text-xs text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 disabled:opacity-35"
      >
        {allOn ? "None" : "All"}
      </button>
      {failed && (
        <span className="ml-2 text-[12px] uppercase tracking-[0.12em] text-accent">
          retry
        </span>
      )}
    </span>
  );
}
