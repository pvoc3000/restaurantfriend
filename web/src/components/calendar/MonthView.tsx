"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFillToBottom } from "@/lib/fillHeight";
import { chipClass, type LayerColors } from "@/lib/calendarColors";
import { monthGrid } from "@/lib/dateRange";
import {
  clockTime,
  weekLayout,
  type CalendarItem,
  type WeekBar,
} from "@/lib/calendar";

/** Sunday first — `monthGrid`'s order (Mark, 2026-09-10). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** How many lines a day shows before "+N more", until the grid is measured. */
const SHOWN = 4;
/** A cell's padding plus its day number, and one line of an item WITH the
 *  4px gap under it (`gap-1` below — keep the two in step), in px. */
const CELL_CHROME = 32;
/** Where a week's first lane starts: the day number's 4px margin, its 20px
 *  box and 4px more. */
const CELL_TOP = 28;
const LINE = 19;

/**
 * The month, six weeks of seven days, with what is on each.
 *
 * NOT `ui/CalendarGrid`. That one is a PICKER — 32px cells holding a number —
 * and a calendar page needs cells that hold a list. Both stand on
 * `lib/dateRange.monthGrid`, so they agree on where a month starts, on Sunday
 * leading the week, and on always drawing six rows.
 *
 * A day is two targets: the cell (the day's panel, where everything on it is
 * listed and a new entry starts) and each line in it (that thing's own record,
 * or the entry's dialog). The cell is a `div` with a full-size button BEHIND
 * the lines rather than a button around them, because a link inside a button is
 * not something a browser will let you press.
 */
export function MonthView({
  month,
  today,
  days,
  colors,
  onDay,
  onEntry,
}: {
  month: string;
  today: string;
  /** Each day's items, already filtered and sorted (`lib/calendar.itemsByDay`). */
  days: ReadonlyMap<string, CalendarItem[]>;
  /** The organisation's colour for each layer (`lib/calendarColors`). */
  colors: LayerColors;
  onDay: (iso: string) => void;
  onEntry: (entryId: string) => void;
}) {
  const weeks = monthGrid(month);

  // THE GRID ENDS WHERE THE WINDOW DOES (Mark, 2026-10-10: "make the calendar
  // extend to the bottom of the screen"). Measured, never `100vh - a guess` —
  // `lib/fillHeight`'s rule — and the six rows share what there is. Below the
  // floor it stops shrinking and the page scrolls: six rows shorter than this
  // hold a number and nothing else.
  const gridRef = useRef<HTMLDivElement>(null);
  useFillToBottom(gridRef, true, 6 * 84);
  // How many lines fit follows the height the rows were given, so a tall
  // window shows more of a busy day instead of more white under four lines.
  const [capacity, setCapacity] = useState(SHOWN);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const row = el.getBoundingClientRect().height / 6;
      setCapacity(Math.max(1, Math.floor((row - CELL_CHROME) / LINE)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="select-none">
      <div aria-hidden className="grid grid-cols-7">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            className="h-6 px-2 text-[11px] uppercase tracking-[0.12em] text-subtle"
          >
            {day}
          </span>
        ))}
      </div>
      {/* SIX WEEKS, each its own row, because a multi-day bar belongs to a week
          and not to a day: it is drawn once, in a layer over that week's seven
          cells, in a lane `weekLayout` chose for it. The cells underneath hold
          the day's number, its tint and the tap target, and nothing else. */}
      <div ref={gridRef} className="grid grid-rows-6 gap-px border border-ink bg-ink">
        {weeks.map((week) => {
          const { bars, more } = weekLayout(
            week.map((d) => d.iso),
            days,
            capacity,
          );
          return (
            <div key={week[0].iso} className="relative grid min-h-0 grid-cols-7 gap-px overflow-hidden">
              {week.map((day) => {
                const items = days.get(day.iso) ?? [];
                return (
                  <div
                    key={day.iso}
                    // A blacked-out day is GREY to its edges, so it reads across
                    // the month before any line of it is read. A day outside the
                    // month keeps a white cell and a faint number.
                    className={`relative min-h-0 min-w-0 ${
                      items.some((i) => i.blackout) ? "bg-neutral-200" : "bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`${day.iso}, ${items.length} item${items.length === 1 ? "" : "s"}`}
                      onClick={() => onDay(day.iso)}
                      className="absolute inset-0 hover:bg-neutral-100/60"
                    />
                    <span
                      className={`pointer-events-none relative m-1 flex h-5 w-fit min-w-5 items-center justify-center px-1 text-[12px] tabular-nums ${
                        day.iso === today
                          ? "bg-ink font-bold text-white"
                          : day.inMonth
                            ? "text-ink"
                            : "text-faint"
                      }`}
                    >
                      {Number(day.iso.slice(8, 10))}
                    </span>
                  </div>
                );
              })}

              {/* The same seven columns and the same 1px gaps as the cells, so
                  a bar's ends land on the cell edges. Rows are a chip tall and
                  `gap-y-1` apart — `LINE` above is their sum. The layer itself
                  takes no clicks; each bar does. */}
              <div
                className="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-x-px gap-y-1"
                style={{ top: CELL_TOP, gridAutoRows: "15px" }}
              >
                {bars.map((bar) => (
                  <Bar key={bar.item.key} bar={bar} colors={colors} onEntry={onEntry} />
                ))}
                {more.map((n, col) =>
                  n > 0 ? (
                    <span
                      key={week[col].iso}
                      className="truncate px-2 text-[11px] leading-[15px] text-subtle"
                      style={{ gridColumn: col + 1, gridRow: Math.max(1, capacity) }}
                    >
                      +{n} more
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What a line says, shared by the cell and the day's panel. */
export function itemText(item: CalendarItem): string {
  const lead = item.lead ? `${item.lead}: ` : "";
  const time = item.time ? `${clockTime(item.time)} ` : "";
  return `${lead}${time}${item.title}`;
}

function Bar({
  bar,
  colors,
  onEntry,
}: {
  bar: WeekBar;
  colors: LayerColors;
  onEntry: (entryId: string) => void;
}) {
  const { item } = bar;
  // A chip in one day, or one banner across several (Mark, 2026-10-10). Inset
  // 4px from the cell's edge and rounded — except at an end that carries on
  // into another week, which runs to the edge and is cut square, so the bar
  // reads as continuing rather than as ending there.
  const ends = `${bar.continuesBefore ? "rounded-l-none" : "ml-1"} ${
    bar.continuesAfter ? "rounded-r-none" : "mr-1"
  }`;
  const className = `pointer-events-auto block min-w-0 truncate rounded-[4px] px-1.5 text-left text-[11px] font-medium leading-[15px] hover:brightness-95 ${ends} ${chipClass(item, colors)}`;
  const style = { gridColumn: `${bar.col + 1} / span ${bar.days}`, gridRow: bar.lane + 1 };
  const body = itemText(item);

  if (item.entryId) {
    return (
      <button type="button" onClick={() => onEntry(item.entryId!)} className={className} style={style}>
        {body}
      </button>
    );
  }
  if (item.href) {
    return (
      <Link href={item.href} className={className} style={style}>
        {body}
      </Link>
    );
  }
  return (
    <span className={className} style={style}>
      {body}
    </span>
  );
}
