"use client";

import { useEffect, useRef } from "react";
import { dayAgenda, longDate, type CalendarItem } from "@/lib/calendar";
import type { LayerColors } from "@/lib/calendarColors";
import { ItemLine } from "@/components/calendar/ItemLine";
import { BackToTop } from "@/components/ui/BackToTop";

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
  // TODAY'S BAND, or the first one after it, or the last when the month's
  // remaining days are empty — only in the month today is in. It is where the
  // list opens and where the Today button scrolls to (`data-calendar-landing`).
  const first = days[0]?.date;
  const landing =
    first && today.slice(0, 7) === first.slice(0, 7)
      ? (days.find((d) => d.date >= today) ?? days[days.length - 1]).date
      : undefined;
  const landingRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Not when it is the top band already: there is nothing to skip past.
    if (landing !== first) landingRef.current?.scrollIntoView({ block: "start" });
    // Once, when the list is first drawn — never again as filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            data-calendar-landing={day.date === landing ? "" : undefined}
            // Clear of the sticky masthead and the sticky filter row.
            style={{
              scrollMarginTop:
                "calc(var(--rf-header-h) + var(--rf-calendar-controls-h, 4.5rem) + 0.5rem)",
            }}
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
      {/* A month can run long — the order guide's own button. */}
      <BackToTop />
    </div>
  );
}
