"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  addMonths,
  inRange,
  monthGrid,
  monthLabel,
  monthStart,
  WEEKDAY_LETTERS,
  type DateRange,
} from "@/lib/dateRange";
import { daysAfter, daysBefore } from "@/lib/today";

/**
 * THE APP'S MONTH CALENDAR — one grid for both date controls.
 *
 * Lifted out of `ui/RangePicker` when `ui/DateField` stopped handing its
 * calendar to the browser (Mark, 2026-09-10: "roll our own date picker to match
 * the rangepicker"), so a single date and a range are picked from the same
 * panel with the same month, the same letters and the same marks. A second copy
 * would be the `ui/Dialog` story again.
 *
 * Sunday first (`monthGrid`), six rows always, so the panel never changes height
 * as you page. `painted` is what the grid marks: the two ends FILLED, the days
 * between WASHED — a single date is a range of one day, so the same marking
 * serves both callers. Today is bold; it is a fact, not a state.
 *
 * THE KEYBOARD, which is the half a native picker gave for free and this has to
 * earn: the grid is ONE tab stop (a roving `tabIndex`), the arrow keys move a
 * day or a week and turn the month when they cross its edge, and Enter or Space
 * picks, being the button's own activation. Escape belongs to the panel around
 * it (`useAnchoredPanel`). `autoFocusIso` puts focus on a day when the grid
 * mounts — the date field's own panel does, so the keyboard starts on the date
 * already chosen; the range picker does not, so opening it steals nothing.
 */
export function CalendarGrid({
  month,
  today,
  painted,
  onMonth,
  onTap,
  onHover,
  isDisabled,
  autoFocusIso,
}: {
  /** The month showing, as any ISO day inside it. */
  month: string;
  /** Today, ISO — bolded. */
  today: string;
  /** What to mark: a range, a single day as a range of one, or nothing. */
  painted: DateRange | null;
  onMonth: (iso: string) => void;
  onTap: (iso: string) => void;
  /** The day under the pointer or keyboard, for a caller previewing a range. */
  onHover?: (iso: string | null) => void;
  /** A day that cannot be picked — past a `max`, say. */
  isDisabled?: (iso: string) => boolean;
  /** Focus this day when the grid mounts. */
  autoFocusIso?: string | null;
}) {
  const weeks = monthGrid(month);
  const days = weeks.flat();
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusIso, setFocusIso] = useState<string | null>(autoFocusIso ?? null);
  // Only move DOM focus when something asked for it — mount with
  // `autoFocusIso`, or an arrow key — never because the month changed by a
  // click on ‹ or ›.
  const wantFocus = useRef(autoFocusIso != null);

  // The one day that takes Tab: the focused one if it is on screen, else the
  // painted end, else today, else the month's first day.
  const onGrid = (iso: string | null | undefined): iso is string =>
    !!iso && days.some((d) => d.iso === iso);
  const roving = onGrid(focusIso)
    ? focusIso
    : onGrid(painted?.to)
      ? painted!.to
      : onGrid(today)
        ? today
        : (days.find((d) => d.inMonth)?.iso ?? days[0].iso);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-iso="${roving}"]`)?.focus();
  }, [roving]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    const n = step[e.key];
    const next = n > 0 ? daysAfter(roving, n) : daysBefore(roving, -n);
    // A day that cannot be picked cannot take focus either, so moving onto one
    // would leave the roving index on a button the browser refuses to focus —
    // the keyboard would be somewhere the screen is not. Stay put.
    if (isDisabled?.(next)) return;
    wantFocus.current = true;
    setFocusIso(next);
    onHover?.(next);
    if (monthStart(next) !== monthStart(month)) onMonth(monthStart(next));
  }

  // ON A TOUCH SCREEN EVERY TARGET IS 44px (Mark, 2026-09-10: "impossible for
  // me to hit the next and last month buttons - they're tiny"). Keyed on the
  // POINTER, not the shell, so the full-screen runners get it too; an iPad
  // always has a touchscreen, hence `any-pointer` rather than `pointer`.
  // THE MAC LOOK (Mark, 2026-09-10: "mac style the rangepicker and
  // datepicker"): the month buttons are raised `mac-control` boxes, and the days
  // are `ui/TimePicker`'s black-ruled grid — one hairline of ink between cells,
  // the chosen ends filled black, grey under the pointer.
  const NAV =
    "mac-control flex h-8 w-8 items-center justify-center border border-ink bg-white text-lg leading-none any-pointer-coarse:h-11 any-pointer-coarse:w-11 any-pointer-coarse:text-3xl";

  return (
    <div className="w-[15.5rem] select-none any-pointer-coarse:w-[21rem]">
      <div className="mb-3 flex items-center">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}
          className={NAV}
        >
          ‹
        </button>
        <span className="flex-1 text-center text-sm font-semibold any-pointer-coarse:text-base">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}
          className={NAV}
        >
          ›
        </button>
      </div>
      {/* The letters sit OUTSIDE the ruled grid: they label its columns and
          are not cells you can pick. */}
      <div aria-hidden className="grid grid-cols-7">
        {WEEKDAY_LETTERS.map((letter, i) => (
          <span
            key={i}
            className="h-6 text-center text-[11px] uppercase tracking-[0.12em] text-subtle"
          >
            {letter}
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={monthLabel(month)}
        className="grid grid-cols-7 gap-px border border-ink bg-ink"
        onMouseLeave={() => onHover?.(null)}
        onKeyDown={onKeyDown}
      >
        {days.map((day) => {
          const inside = painted !== null && inRange(day.iso, painted);
          const edge =
            painted !== null && (day.iso === painted.from || day.iso === painted.to);
          const disabled = isDisabled?.(day.iso) ?? false;
          // Colour and fill are composed apart — two text colours in one class
          // string are decided by stylesheet order, not by which came last.
          const color = edge ? "text-white" : day.inMonth ? "text-ink" : "text-faint";
          const fill = edge
            ? "bg-ink font-semibold"
            : inside
              ? "bg-neutral-200"
              : "bg-white hover:bg-[#c0c0c0] disabled:hover:bg-white";
          return (
            <button
              key={day.iso}
              type="button"
              data-iso={day.iso}
              aria-label={day.iso}
              aria-pressed={edge}
              tabIndex={day.iso === roving ? 0 : -1}
              disabled={disabled}
              onClick={() => onTap(day.iso)}
              onMouseEnter={() => onHover?.(day.iso)}
              onFocus={() => {
                setFocusIso(day.iso);
                onHover?.(day.iso);
              }}
              // The two ends are FILLED, the days between are WASHED, and a
              // day outside the month is faint but still a target — the last
              // week of August is a fine place to start "the week before
              // the first". Today is bold; it is a fact, not a state. A
              // disabled day greys its NUMBER, never its cell: an opacity would
              // let the black rules show through the white and read as a hole.
              className={`h-8 text-sm tabular-nums disabled:cursor-default disabled:text-neutral-300 any-pointer-coarse:h-11 any-pointer-coarse:text-base ${fill} ${color} ${
                day.iso === today ? "font-bold" : ""
              }`}
            >
              {Number(day.iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
