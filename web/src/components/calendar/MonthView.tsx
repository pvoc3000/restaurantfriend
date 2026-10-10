"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFillToBottom } from "@/lib/fillHeight";
import { monthGrid } from "@/lib/dateRange";
import { clockTime, type CalendarItem, type CalendarLayer } from "@/lib/calendar";

/** Sunday first — `monthGrid`'s order (Mark, 2026-09-10). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A COLOUR PER LAYER, as a chip (Mark, 2026-10-10: "apple style chips, with
 * different colors for each event type instead of the glyphs").
 *
 * This is the one screen where colour is not record state. Everywhere else in
 * the app it is, and the classic Mac look keeps to ink, white and the yellow
 * fill; a calendar is read by colour before it is read by word, which is the
 * reason Mark asked for it and the reason it stays HERE and nowhere else.
 *
 * A pale fill under dark type of the same hue — Apple Calendar's all-day chip
 * — so every one is legible (each pair is 7:1 or better) and a busy day reads
 * as bands rather than as a paragraph. Whole class strings, never assembled:
 * Tailwind only ships a class it can see written out.
 */
export const LAYER_CHIP: Record<CalendarLayer, string> = {
  entries: "bg-yellow-200 text-yellow-950",
  orders_paid: "bg-green-100 text-green-900",
  orders_unpaid: "bg-orange-100 text-orange-900",
  deliveries: "bg-sky-100 text-sky-900",
  tasks: "bg-purple-100 text-purple-900",
  pay_periods: "bg-slate-200 text-slate-800",
  hr: "bg-pink-100 text-pink-900",
  hr_events: "bg-red-100 text-red-900",
  feeds: "bg-indigo-100 text-indigo-900",
};

/** A blackout: the one chip that is solid, so it leads its day by weight too. */
export const BLACKOUT_CHIP = "bg-neutral-800 text-white";

/** The chip's dress for an item — a blackout's, or its layer's. */
export function chipClass(item: Pick<CalendarItem, "layer" | "blackout">): string {
  return item.blackout ? BLACKOUT_CHIP : LAYER_CHIP[item.layer];
}

/** How many lines a day shows before "+N more", until the grid is measured. */
const SHOWN = 4;
/** A cell's padding plus its day number, and one line of an item, in px. */
const CELL_CHROME = 32;
const LINE = 16;

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
  onDay,
  onEntry,
}: {
  month: string;
  today: string;
  /** Each day's items, already filtered and sorted (`lib/calendar.itemsByDay`). */
  days: ReadonlyMap<string, CalendarItem[]>;
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
      <div
        ref={gridRef}
        className="grid grid-cols-7 grid-rows-6 gap-px border border-ink bg-ink"
      >
        {weeks.flat().map((day) => {
          const items = days.get(day.iso) ?? [];
          const shown = items.length > capacity ? items.slice(0, capacity - 1) : items;
          const more = items.length - shown.length;
          const closed = items.some((i) => i.blackout);
          return (
            <div
              key={day.iso}
              // A blacked-out day is GREY to its edges, so it reads across the
              // month before any line of it is read. A day outside the month
              // keeps a white cell and a faint number.
              className={`relative min-h-0 min-w-0 overflow-hidden ${closed ? "bg-neutral-200" : "bg-white"}`}
            >
              <button
                type="button"
                aria-label={`${day.iso}, ${items.length} item${items.length === 1 ? "" : "s"}`}
                onClick={() => onDay(day.iso)}
                className="absolute inset-0 hover:bg-neutral-100/60"
              />
              <div className="pointer-events-none relative flex flex-col gap-px p-1">
                <span
                  className={`mb-0.5 flex h-5 w-fit min-w-5 items-center justify-center px-1 text-[12px] tabular-nums ${
                    day.iso === today
                      ? "bg-ink font-bold text-white"
                      : day.inMonth
                        ? "text-ink"
                        : "text-faint"
                  }`}
                >
                  {Number(day.iso.slice(8, 10))}
                </span>
                {shown.map((item) => (
                  <ItemLine key={item.key} item={item} onEntry={onEntry} />
                ))}
                {more > 0 && (
                  <span className="px-1 text-[11px] text-subtle">+{more} more</span>
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
  const time = item.time ? `${clockTime(item.time)} ` : "";
  return `${time}${item.title}`;
}

function ItemLine({ item, onEntry }: { item: CalendarItem; onEntry: (entryId: string) => void }) {
  // One line, truncated: the cell is a summary and the panel has the rest.
  // Rounded and inset from the cell's edge, with a hairline of the cell showing
  // between one chip and the next.
  const className = `pointer-events-auto block w-full truncate rounded-[4px] px-1.5 text-left text-[11px] font-medium leading-[15px] hover:brightness-95 ${chipClass(item)}`;
  const body = itemText(item);

  if (item.entryId) {
    return (
      <button type="button" onClick={() => onEntry(item.entryId!)} className={className}>
        {body}
      </button>
    );
  }
  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        {body}
      </Link>
    );
  }
  return <span className={className}>{body}</span>;
}
