"use client";

import type { ReactNode } from "react";
import { dayAgenda, type CalendarItem } from "@/lib/calendar";
import { chipClass, type LayerColors } from "@/lib/calendarColors";
import { ITEM_LINES_CLASS, ItemLine, LAYER_LABEL, PrivateMark, itemShops, openItem } from "@/components/calendar/ItemLine";

/**
 * ONE DAY IN FULL (Mark, 2026-10-10: "timeline list, combined list, go to day
 * view instead of popup panel") — everything a month cell squeezes into a chip,
 * with room to read it.
 *
 * Two bands, top to bottom, from `lib/calendar.dayAgenda`:
 *
 *   · BANNERS — everything with no time, full width: the menu plan and any
 *     blackout first, then notes, deliveries, tasks, a pay period, HR. One
 *     band of banners in a box headed "All day" (Mark, 2026-10-11).
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
  const { banners, timed } = dayAgenda(items);

  if (items.length === 0) {
    return <p className="border border-hairline px-4 py-8 text-center text-sm text-muted">Nothing on this day.</p>;
  }

  const open = (item: CalendarItem, className: string, children: ReactNode) =>
    openItem(item, className, children, onEntry);
  const shopsOf = (item: CalendarItem) => itemShops(item, shopCodes);

  return (
    <div className="space-y-6">
      {banners.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-subtle">All day</h2>
          {/* No box round either list (Mark, 2026-10-11) — the headings are
              what separate them. */}
          <ul className="space-y-2">
            {banners.map((item) => (
              <li key={item.key}>
                {open(
                  item,
                  `flex w-full items-baseline justify-between gap-4 rounded-[4px] px-3 py-1.5 text-sm font-medium hover:brightness-95 ${chipClass(item, colors)}`,
                  <>
                    <span className="min-w-0 truncate">
                      <PrivateMark item={item} />
                      {item.lead ? `${item.lead}: ` : ""}
                      {item.title}
                      {!item.blackout && item.detail && (
                        <span className="font-normal opacity-80"> — {item.detail}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] font-normal uppercase tracking-[0.08em] opacity-80">
                      {item.blackout
                        ? item.detail || "Blackout"
                        : [shopsOf(item), item.private ? "Private" : LAYER_LABEL[item.layer]].filter(Boolean).join(" · ")}
                    </span>
                  </>,
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {timed.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-subtle">By time</h2>
          <ul className={ITEM_LINES_CLASS}>
            {timed.map((item) => (
              <ItemLine key={item.key} item={item} shopCodes={shopCodes} colors={colors} onEntry={onEntry} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
