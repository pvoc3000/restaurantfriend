import type { ReactNode } from "react";

/**
 * A filter-row control under its caption.
 *
 * WHY EVERY COLLAPSED PICKER NEEDS ONE (Mark, 2026-09-10, first for the order
 * guide and then for the two purchasing lists: "caption the filter row
 * elements like we did the order guide"). A `TabPicker` shows its whole
 * vocabulary, so the row says what each control is ABOUT just by standing
 * there. A `PickList`, a `PickSet` and a `RangePicker` show one value, and at
 * rest a purchasing row read "All time", "All vendors", "All" — three
 * dimensions, three variations of one word, and nothing saying which was
 * which. **The caption is what a collapsed control gives up, so it is what a
 * collapsed control has to state.**
 *
 * ABOVE, NEVER BESIDE — `/items`' Last-ordered rule (Mark, 2026-08-01): a
 * caption to the left starts its control 130px in, so it stops lining up with
 * whatever sits above it, and stacked, every control in a row begins on one
 * margin.
 *
 * VISUAL ONLY. This is not a `<label>` and it wraps nothing: each control
 * keeps its own `ariaLabel`, which is longer and says more ("Which vendors to
 * walk"), so a screen reader hears the better sentence and hears it once.
 *
 * The row that holds these wants `items-end`, so an UNCAPTIONED control — a
 * search box, a command — sits on the line of the fields rather than floating
 * against their captions.
 */
export function ControlField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-[0.12em] text-subtle">{label}</span>
      {children}
    </span>
  );
}
