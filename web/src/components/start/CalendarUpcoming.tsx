"use client";

import Link from "next/link";

import type { CalendarItem } from "@/lib/calendar";
import { chipClass, type LayerColors } from "@/lib/calendarColors";
import { daysAfter } from "@/lib/today";

import { AgendaLine, dayLabel, WIDGET_CHIP_EDGE } from "./AgendaLine";
import { useWidgetSettings } from "./widgetSettings";

/**
 * THE CALENDAR WIDGET'S LIST (Mark, 2026-10-17: an upcoming list; entries and
 * subscribed calendars only, so nothing on the other widgets is said twice).
 *
 * The server hands over the longest window the corner menu offers (30 days)
 * and this cuts it to the widget's own day count, so changing it is instant.
 * At three columns the next seven days become a week strip, with anything
 * later listed under it.
 */
export function CalendarUpcoming({
  items,
  today,
  colors,
  shopCodes,
}: {
  /** Sorted, filtered to the working shop, today onward. */
  items: CalendarItem[];
  today: string;
  colors: LayerColors;
  shopCodes: [string, string][];
}) {
  const { days } = useWidgetSettings();
  const codes = new Map(shopCodes);
  const tomorrow = daysAfter(today, 1);
  const end = daysAfter(today, days - 1);
  const shown = items.filter((i) => i.date <= end);
  const week = Array.from({ length: 7 }, (_, n) => daysAfter(today, n));
  const weekEnd = week[6];

  if (shown.length === 0) {
    return <p className="text-sm text-muted">Nothing on the calendar in the next {days} days.</p>;
  }

  const list = (from: string) => {
    const groups = new Map<string, CalendarItem[]>();
    for (const item of shown) {
      if (item.date < from) continue;
      const g = groups.get(item.date);
      if (g) g.push(item);
      else groups.set(item.date, [item]);
    }
    return [...groups].map(([date, dayItems]) => (
      <section key={date} className="space-y-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
          {dayLabel(date, today, tomorrow)}
        </h3>
        <ul>
          {dayItems.map((item) => (
            <AgendaLine key={item.key} item={item} colors={colors} shopCodes={codes} showTime={Boolean(item.time)} />
          ))}
        </ul>
      </section>
    ));
  };

  const later = shown.some((i) => i.date > weekEnd);
  return (
    <>
      <div className="space-y-3 @4xl:hidden">{list(today)}</div>
      <div className="hidden space-y-4 @4xl:block">
        <div className="grid grid-cols-7 gap-px border border-hairline bg-hairline">
          {week.map((date) => (
            <div key={date} className="min-h-24 min-w-0 space-y-1 bg-white p-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
                {dayLabel(date, today, tomorrow)}
              </div>
              {shown
                .filter((i) => i.date === date)
                .map((item) => (
                  <Link
                    key={item.key}
                    href={item.href ?? `/calendar?view=day&date=${item.date}`}
                    title={item.title}
                    className={`block truncate rounded-[4px] px-1 text-[12px] no-underline hover:brightness-95 ${WIDGET_CHIP_EDGE} ${chipClass(item, colors)}`}
                  >
                    {item.lead ? `${item.lead}: ` : ""}
                    {item.title}
                  </Link>
                ))}
            </div>
          ))}
        </div>
        {later && <div className="space-y-3">{list(daysAfter(weekEnd, 1))}</div>}
      </div>
    </>
  );
}
