"use client";

import { useEffect, useRef } from "react";
import { dayAgenda, longDate, type CalendarItem } from "@/lib/calendar";
import type { LayerColors } from "@/lib/calendarColors";
import { ItemLine } from "@/components/calendar/ItemLine";

/**
 * THE MONTH AS A LIST (Mark, 2026-10-11: "The calendar but in a list form") —
 * the same items, filters and colours as the month view, one band per day.
 *
 *   · Only the month itself: the grid's spill-over days are not listed.
 *   · Only days with something on them.
 *   · An entry that runs three days is under each of the three, so a day's
 *     band is the whole truth about that day.
 *   · Within a day: what has no time first (blackouts leading), then by time —
 *     `dayAgenda`'s order, the day view's.
 *
 * In the CURRENT month the list opens scrolled to today, or the next day with
 * anything on it: the days already gone are above, not in the way.
 */
export function ListView({
  days,
  today,
  shopCodes,
  colors,
  onDay,
  onEntry,
}: {
  /** The month's days that have items, in date order, already filtered. */
  days: readonly { date: string; items: readonly CalendarItem[] }[];
  today: string;
  shopCodes: ReadonlyMap<string, string>;
  colors: LayerColors;
  onDay: (iso: string) => void;
  onEntry: (entryId: string) => void;
}) {
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  // Where to open: today's band, or the first one after it — only when today
  // is inside what is listed, and not when that is the top band already.
  const landing =
    first && last && today > first && today <= last ? days.find((d) => d.date >= today)?.date : undefined;
  const landingRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    landingRef.current?.scrollIntoView({ block: "start" });
    // Once, when the list is first drawn — never again as filters change.
  }, []);

  if (days.length === 0) {
    return <p className="border border-hairline px-4 py-8 text-center text-sm text-muted">Nothing this month.</p>;
  }

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const { banners, timed } = dayAgenda(day.items);
        return (
          <section
            key={day.date}
            ref={day.date === landing ? landingRef : undefined}
            // Clear of the sticky masthead when scrolled to.
            style={{ scrollMarginTop: "calc(var(--rf-header-h) + 0.75rem)" }}
            className="border border-ink bg-white"
          >
            {/* A group band: black, white text — and the way into the day. */}
            <h2>
              <button
                type="button"
                onClick={() => onDay(day.date)}
                className="flex w-full items-baseline justify-between gap-4 bg-ink px-3 py-1.5 text-left text-sm font-semibold text-white"
              >
                <span>{longDate(day.date)}</span>
                {day.date === today && (
                  <span className="text-[11px] font-normal uppercase tracking-[0.12em]">Today</span>
                )}
              </button>
            </h2>
            <ul className="divide-y divide-neutral-200">
              {[...banners, ...timed].map((item) => (
                <ItemLine key={item.key} item={item} shopCodes={shopCodes} colors={colors} onEntry={onEntry} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
