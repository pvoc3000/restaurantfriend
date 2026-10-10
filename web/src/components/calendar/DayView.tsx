"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CALENDAR_LAYERS, clockTime, dayAgenda, type CalendarItem } from "@/lib/calendar";
import { chipClass, type LayerColors } from "@/lib/calendarColors";

const LAYER_LABEL = Object.fromEntries(CALENDAR_LAYERS.map((l) => [l.key, l.label]));

/**
 * ONE DAY IN FULL (Mark, 2026-10-10: "timeline list, combined list, go to day
 * view instead of popup panel") — everything a month cell squeezes into a chip,
 * with room to read it.
 *
 * Three bands, top to bottom, from `lib/calendar.dayAgenda`:
 *
 *   · BANNERS — the menu plan and any blackout, full width. They are facts
 *     about the whole day and are read before anything on it.
 *   · ALL DAY — what has no time: notes, deliveries, tasks, a pay period, HR.
 *   · BY TIME — what has one, in time order, every shop together.
 *
 * A TIMELINE LIST, NOT AN HOUR GRID. A day here has a handful of timed things,
 * all of them orders; a grid of hours would be mostly white, and a list says
 * more about each one. The cost — gaps and crunches are not drawn as space —
 * was weighed and accepted.
 *
 * Each line is the item's chip, its second phrase, and on the right the shops
 * and the layer it belongs to. It opens the record, or the entry's dialog.
 */
export function DayView({
  items,
  shopCodes,
  colors,
  onEntry,
}: {
  /** The day's items, already filtered (`visibleItems`). */
  items: readonly CalendarItem[];
  /** location id → code, to say which shop a line is about. */
  shopCodes: ReadonlyMap<string, string>;
  colors: LayerColors;
  onEntry: (entryId: string) => void;
}) {
  const { banners, allDay, timed } = dayAgenda(items);

  if (items.length === 0) {
    return <p className="border border-hairline px-4 py-8 text-center text-sm text-muted">Nothing on this day.</p>;
  }

  const open = (item: CalendarItem, className: string, children: ReactNode) =>
    item.entryId ? (
      <button type="button" onClick={() => onEntry(item.entryId!)} className={`${className} text-left`}>
        {children}
      </button>
    ) : item.href ? (
      <Link href={item.href} className={className}>
        {children}
      </Link>
    ) : (
      <div className={className}>{children}</div>
    );

  const line = (item: CalendarItem, withTime: boolean) => {
    const shops = item.locationIds
      .map((id) => shopCodes.get(id))
      .filter((code): code is string => Boolean(code))
      .join(", ");
    return (
      <li key={item.key}>
        {open(
          item,
          "flex w-full items-baseline gap-4 px-3 py-2.5 hover:bg-neutral-100",
          <>
            {withTime && (
              <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                {item.time ? clockTime(item.time) : ""}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`rounded-[4px] px-1.5 py-0.5 text-sm font-medium ${chipClass(item, colors)}`}>
                {item.lead ? `${item.lead}: ` : ""}
                {item.title}
              </span>
              {item.detail && <span className="mt-1 block text-sm text-muted">{item.detail}</span>}
            </span>
            <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-subtle">
              {[shops, LAYER_LABEL[item.layer]].filter(Boolean).join(" · ")}
            </span>
          </>,
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {banners.length > 0 && (
        <ul className="space-y-1">
          {banners.map((item) => (
            <li key={item.key}>
              {open(
                item,
                `flex w-full items-baseline justify-between gap-4 rounded-[4px] px-3 py-1.5 text-sm font-medium hover:brightness-95 ${chipClass(item, colors)}`,
                <>
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="shrink-0 text-[11px] font-normal uppercase tracking-[0.08em] opacity-80">
                    {item.blackout ? item.detail || "Blackout" : LAYER_LABEL[item.layer]}
                  </span>
                </>,
              )}
            </li>
          ))}
        </ul>
      )}

      {allDay.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-subtle">All day</h2>
          <ul className="divide-y divide-neutral-200 border border-ink bg-white">{allDay.map((i) => line(i, false))}</ul>
        </section>
      )}

      {timed.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-subtle">By time</h2>
          <ul className="divide-y divide-neutral-200 border border-ink bg-white">{timed.map((i) => line(i, true))}</ul>
        </section>
      )}
    </div>
  );
}
