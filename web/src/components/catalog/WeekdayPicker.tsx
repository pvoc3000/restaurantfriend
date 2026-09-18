"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * What a DataTable column holding a day picker has to be, in px: seven 32px
 * boxes (224) + the All/None command (~40) + the cell's own px-4 (32).
 * DataTable is `table-fixed` with `truncate` cells, so a column narrower than
 * this silently CLIPS the right-hand end — which is how the All command went
 * missing from the item screen's Order days column (Mark, 2026-07-27: "should
 * have an All toggle"; it was there, just cut off). Every column rendering a
 * picker uses this so it can't drift again.
 */
export const WEEKDAY_PICKER_WIDTH = 300;

/**
 * A DAY THAT IS ON — DARK GREY, NOT BLACK (Mark, 2026-09-12). One constant
 * because the picker draws its cells twice, once live and once as a read-only
 * statement, and the two must never disagree about what "on" looks like.
 *
 * `--rf-neutral-500`, #757575, AND IT IS THE END OF THIS ROAD RATHER THAN A
 * TASTE (Mark, 2026-09-12, in two steps: "dark grey instead of black", then
 * "can we go lighter"). It shipped at `neutral-600` (#525252, white on it
 * 7.81:1) and this is one rung further: **the lightest grey that still carries
 * WHITE type at AA**, measured 4.61:1 against the 4.5 the 12px labels need.
 * The next step is not a step — #808080 measures 3.95 and fails — so anything
 * lighter has to flip the type to BLACK, at which point the honest value is
 * #c0c0c0, the fill every other filled control in the Mac look already uses.
 * That is a different decision, not a lighter shade; ask before taking it.
 *
 * A TOKEN rather than a hex because there is one for this: the DS calls
 * #757575 its caption grey. Written as the variable and not as `bg-subtle`,
 * which maps to the same value under a name that means text.
 *
 * It is NOT the `TabPicker` rule being loosened. That control's selected cell
 * is black and stays black — its cells abut into one segmented bar where the
 * fill IS the answer, while these seven butted boxes are a SET you read the
 * shape of, and a softer fill makes the on-days read as a pattern rather than
 * as seven separate assertions.
 *
 * EXPORTED because there is a SECOND strip of these boxes that cannot be this
 * component: `VendorItemLocations`' favorite days writes plan ROWS rather than
 * an array, so it hand-rolls the markup — and the two are drawn on neighbouring
 * records, where one black strip and one grey would read as a fault rather than
 * as a distinction. The dress is shared even though the writer cannot be.
 */
export const WEEKDAY_ON_CLASS = "bg-[var(--rf-neutral-500)] text-white";

/**
 * ONE DAY IS A SMALL RAISED BUTTON IN A 32px SLOT (Mark, 2026-09-18: keep the
 * strip's dimensions, shrink the day, add a hard drop shadow — "a linear group
 * of small action buttons"). The SLOT is what `WEEKDAY_PICKER_WIDTH` counts,
 * so it stays 32px and the strip stays 224 x 32; the button inside it is 26px
 * with `.mac-day`'s 2px shadow, which leaves 4px of air between neighbours.
 * `items-start justify-start` puts the button flush with the slot's top-left
 * and the shadow inside it, so the strip's box is exactly the seven slots.
 *
 * Shared with `VendorItemLocations`' favorites strip for the reason
 * `WEEKDAY_ON_CLASS` is: the two are drawn on neighbouring records.
 */
export const WEEKDAY_SLOT_CLASS = "inline-flex h-8 w-8 items-start justify-start";
export const WEEKDAY_DAY_CLASS =
  "inline-flex h-[26px] w-[26px] items-center justify-center border border-ink text-xs tabular-nums";
/** An OFF day: white, faint type, ink on hover. */
export const WEEKDAY_OFF_CLASS = "mac-day-off bg-white text-faint hover:text-ink";

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
  readOnly = false,
  onWrite,
}: {
  table: string;
  id: string;
  column: string;
  value: number[] | null;
  label: string;
  /** The seven boxes as a STATEMENT — no toggling, no All/None — for a role
   *  the Page Permissions sheet has at Read Only. */
  readOnly?: boolean;
  /** Replaces the UPDATE and nothing else — `InlineValue`'s prop of the same
   *  name. The /interface page hands it a local write. */
  onWrite?: (next: number[]) => Promise<{ error: string | null }>;
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
      const { error } = onWrite
        ? await onWrite(next)
        : await supabase
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

  if (readOnly) {
    return (
      <span className="inline-flex items-center" aria-label={label}>
        {DAYS.map((day) => (
          <span key={day.weekday} className={WEEKDAY_SLOT_CLASS}>
            {/* Flat — the same small square without the shadow, so a
                statement does not look pressable. */}
            <span
              className={`${WEEKDAY_DAY_CLASS} ${
                days.includes(day.weekday) ? WEEKDAY_ON_CLASS : "bg-white text-faint"
              }`}
            >
              {day.label}
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center">
      {/* Seven small raised buttons, one per 32px slot — the modern form of
          the original's 7-column day grid. They were seven butted boxes
          sharing one black rule until 2026-09-18. */}
      {DAYS.map((day) => {
        const on = days.includes(day.weekday);
        return (
          <span key={day.weekday} className={WEEKDAY_SLOT_CLASS}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={`${label}: ${day.label}`}
              disabled={pending}
              onClick={() => toggle(day.weekday)}
              className={`mac-day ${WEEKDAY_DAY_CLASS} disabled:opacity-35 ${
                on ? WEEKDAY_ON_CLASS : WEEKDAY_OFF_CLASS
              }`}
            >
              {day.label}
            </button>
          </span>
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
