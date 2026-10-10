"use client";

import Link from "next/link";
import { monthGrid } from "@/lib/dateRange";
import { clockTime, type CalendarItem, type CalendarLayer } from "@/lib/calendar";

/** Sunday first — `monthGrid`'s order (Mark, 2026-09-10). */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A mark per layer, so a cell's lines are told apart by SHAPE. Colour means
 * record state in this app and a layer is not a state; U+FE0E keeps Apple from
 * drawing any of them as a colour emoji.
 */
export const LAYER_MARK: Record<CalendarLayer, string> = {
  entries: "",
  special_orders: "◆︎",
  deliveries: "▲︎",
  tasks: "■︎",
  pay_periods: "$",
  hr: "✚︎",
  feeds: "○︎",
};

/** How many lines a day shows before "+N more". */
const SHOWN = 4;

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
      <div className="grid grid-cols-7 gap-px border border-ink bg-ink">
        {weeks.flat().map((day) => {
          const items = days.get(day.iso) ?? [];
          const shown = items.length > SHOWN ? items.slice(0, SHOWN - 1) : items;
          const more = items.length - shown.length;
          const closed = items.some((i) => i.blackout);
          return (
            <div
              key={day.iso}
              // A blacked-out day is GREY to its edges, so it reads across the
              // month before any line of it is read. A day outside the month
              // keeps a white cell and a faint number.
              className={`relative min-h-[7.25rem] min-w-0 ${closed ? "bg-neutral-200" : "bg-white"}`}
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
  const dress = item.blackout
    ? "bg-ink text-white"
    : item.layer === "entries"
      ? "bg-mark-fill text-ink"
      : "text-ink hover:bg-neutral-100";
  const className = `pointer-events-auto block w-full truncate px-1 text-left text-[11px] leading-[1.35] ${dress}`;
  const mark = LAYER_MARK[item.layer];
  const body = (
    <>
      {mark && <span aria-hidden className="mr-1 text-[9px]">{mark}</span>}
      {itemText(item)}
    </>
  );

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
