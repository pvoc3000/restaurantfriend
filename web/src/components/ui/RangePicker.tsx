"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import {
  addMonths,
  formatRange,
  inRange,
  matchingPreset,
  monthGrid,
  monthLabel,
  monthStart,
  normalizeRange,
  resolvePreset,
  WEEKDAY_LETTERS,
  type DateRange,
  type RangePresetSpec,
} from "@/lib/dateRange";
import { CalendarIcon } from "@/components/ui/DateField";
import { BOXED_FIELD, BOXED_FIELD_BORDER } from "@/components/ui/fieldMetrics";

/**
 * A RANGE of dates, for filtering a list by them (Mark, 2026-09-08).
 *
 * At rest it is a boxed field with a calendar glyph, the dress `DateField`
 * wears `boxed` — so beside a search box and a date box it reads as the same
 * kind of thing. Pressed, it opens a panel: a calendar on the LEFT and a
 * column of preset buttons on the RIGHT. A preset sets the range in one tap;
 * the calendar sets it in two — the first tap is the start, the second the
 * end — and either way THE MOMENT THE RANGE IS COMPLETE the picker applies it
 * and closes. There is no OK button, because there is nothing left to say.
 *
 * WHICH PRESETS is the caller's, per instance: `presets` names them in the
 * order they should read, from `lib/dateRange`'s vocabulary or as the
 * caller's own `RangePreset` for a word that vocabulary lacks.
 *
 * `today` is PASSED IN and is the org's calendar day (`lib/today`) — the
 * presets are functions of it, and a "Today" computed off the browser's clock
 * on a UTC host is the drift that module exists to keep out.
 *
 * Two things the calendar does that are easy to lose in a rewrite:
 *
 * TWO TAPS IN EITHER ORDER MAKE A RANGE. Tapping the 8th and then the 1st is
 * the 1st to the 8th, not a refusal — `normalizeRange` — because a person
 * reaching for "last week" from its end is not making a mistake.
 *
 * A HALF-PICKED RANGE IS ABANDONED ON CLOSE, never applied. Escape, a click
 * away or a scroll leaves the stored value exactly as it was; the caller only
 * ever hears a finished pair. What that costs is that a first tap and then a
 * wander off is a tap lost, which is the cheaper of the two mistakes.
 *
 * The panel portals and positions through `useAnchoredPanel`, so it escapes
 * scroll panes, flips above the field near the foot of the window and closes
 * on scroll — `PickList`'s own behaviour, not re-derived.
 */
export function RangePicker({
  value,
  onChange,
  presets,
  today,
  ariaLabel,
  placeholder = "Any date",
  clearable = true,
  disabled = false,
  className = "",
}: {
  /** The range in force, or null for no filter. */
  value: DateRange | null;
  /** Fires once, with a finished range — or null when the ✕ clears it. */
  onChange: (next: DateRange | null) => void;
  /** The buttons down the right, in reading order. */
  presets: readonly RangePresetSpec[];
  /** The org's calendar day, ISO. */
  today: string;
  ariaLabel: string;
  /** What the field says with no range set. */
  placeholder?: string;
  /** Offer a ✕ that sets the value back to null. */
  clearable?: boolean;
  disabled?: boolean;
  /** For width — the box is `w-full` of whatever it is put in. */
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** The month the grid shows, as any ISO day inside it. */
  const [month, setMonth] = useState(() => monthStart(value?.from ?? today));
  /** The first tap, while waiting for the second. */
  const [start, setStart] = useState<string | null>(null);
  /** The day under the pointer, so the range-to-be shows before the second tap. */
  const [hover, setHover] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setStart(null);
    setHover(null);
  }, []);

  const box = useAnchoredPanel({ open, triggerRef, panelRef, onClose: close });

  const openPanel = () => {
    // Open on the month of the range in force, else today's.
    setMonth(monthStart(value?.from ?? today));
    setStart(null);
    setHover(null);
    setOpen(true);
  };

  const apply = (next: DateRange) => {
    onChange(next);
    close();
  };

  const tapDay = (iso: string) => {
    if (start === null) {
      setStart(iso);
      return;
    }
    apply(normalizeRange(start, iso));
  };

  const preset = matchingPreset(value, presets, today);
  const face = value ? (preset?.label ?? formatRange(value)) : null;

  /** What the grid paints as the range: the pending pair while picking, else the value. */
  const painted: DateRange | null =
    start !== null
      ? normalizeRange(start, hover ?? start)
      : value;

  return (
    <>
      <span
        className={`flex items-center ${BOXED_FIELD_BORDER} ${BOXED_FIELD} bg-white ${
          disabled ? "opacity-35" : ""
        } ${className}`}
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => (open ? close() : openPanel())}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm hover:bg-neutral-100 disabled:hover:bg-white"
        >
          <span className={`min-w-0 flex-1 truncate tabular-nums ${face ? "" : "text-faint"}`}>
            {face ?? placeholder}
          </span>
          {/* The glyph rides inside the button: on a range field the whole box
              is the control, and a second button for "open the calendar"
              beside one that opens the calendar is two ways to do one thing. */}
          <span className="shrink-0 text-muted">
            <CalendarIcon />
          </span>
        </button>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            title="Clear"
            // `TextInput`'s ✕: untabbable, so Tab goes to the next filter.
            tabIndex={-1}
            onClick={() => onChange(null)}
            className="h-9 shrink-0 px-2 text-xs text-muted hover:text-ink"
          >
            ✕
          </button>
        )}
      </span>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            style={{ top: box.top, left: box.left }}
            // Layout only — the colours are stated here, not inherited:
            // `position: fixed` moves the box and not its place in the DOM, so
            // a trigger sitting in a black band would otherwise paint white
            // type into this panel (the Generate-POs lesson).
            className="fixed z-[70] flex gap-4 border-2 border-ink bg-white p-3 text-ink whitespace-normal"
          >
            <Calendar
              month={month}
              today={today}
              painted={painted}
              picking={start !== null}
              onMonth={setMonth}
              onTap={tapDay}
              onHover={setHover}
            />
            <div className="flex w-40 shrink-0 flex-col gap-1" role="group" aria-label="Preset ranges">
              {presets.map((spec) => {
                const p = resolvePreset(spec);
                const current = preset?.key === p.key && start === null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={current}
                    onClick={() => apply(p.range(today))}
                    // The app's one button weight (`BUTTON_CLASS` at h-8 and
                    // left-aligned), with the range in force marked the way a
                    // set filter is: filled black.
                    className={`inline-flex h-8 items-center whitespace-nowrap border border-ink px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                      current
                        ? "bg-ink text-white"
                        : "bg-white text-ink hover:bg-ink hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * The month grid. Six rows always (`monthGrid`), so the panel does not change
 * height as you page — and the presets beside it never move under the pointer.
 */
function Calendar({
  month,
  today,
  painted,
  picking,
  onMonth,
  onTap,
  onHover,
}: {
  month: string;
  today: string;
  painted: DateRange | null;
  picking: boolean;
  onMonth: (iso: string) => void;
  onTap: (iso: string) => void;
  onHover: (iso: string | null) => void;
}) {
  const weeks = monthGrid(month);
  return (
    <div className="w-[15.5rem] shrink-0 select-none">
      <div className="mb-2 flex items-center">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}
          className="h-8 w-8 hover:bg-neutral-100"
        >
          ‹
        </button>
        <span className="flex-1 text-center text-sm font-semibold">{monthLabel(month)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}
          className="h-8 w-8 hover:bg-neutral-100"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7" onMouseLeave={() => onHover(null)}>
        {WEEKDAY_LETTERS.map((letter, i) => (
          <span
            key={i}
            aria-hidden
            className="h-6 text-center text-[11px] uppercase tracking-[0.12em] text-subtle"
          >
            {letter}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const inside = painted !== null && inRange(day.iso, painted);
          const edge =
            painted !== null && (day.iso === painted.from || day.iso === painted.to);
          return (
            <button
              key={day.iso}
              type="button"
              aria-label={day.iso}
              aria-pressed={edge}
              onClick={() => onTap(day.iso)}
              onMouseEnter={() => onHover(day.iso)}
              onFocus={() => onHover(day.iso)}
              // The two ends are FILLED, the days between are WASHED, and a
              // day outside the month is faint but still a target — the last
              // week of August is a fine place to start "the week before
              // the first". Today is bold; it is a fact, not a state.
              className={`h-8 text-sm tabular-nums ${
                edge
                  ? "bg-ink text-white"
                  : inside
                    ? "bg-neutral-100"
                    : "hover:bg-neutral-100"
              } ${day.inMonth ? "" : "text-faint"} ${day.iso === today ? "font-bold" : ""}`}
            >
              {Number(day.iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
      {/* The one state a reader cannot see: which tap comes next. */}
      <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-subtle">
        {picking ? "Tap the end date" : "Tap the start date"}
      </p>
    </div>
  );
}
