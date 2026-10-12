"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CALENDAR_LAYERS, clockTime, type CalendarItem } from "@/lib/calendar";
import { chipClass, type LayerColors } from "@/lib/calendarColors";

export const LAYER_LABEL = Object.fromEntries(CALENDAR_LAYERS.map((l) => [l.key, l.label]));

/** An item as the thing it opens: the entry's dialog, its record, or nothing. */
export function openItem(
  item: CalendarItem,
  className: string,
  children: ReactNode,
  onEntry: (entryId: string) => void,
): ReactNode {
  return item.entryId ? (
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
}

/** The codes of the shops an item is about: "DF01, DF02", or "". */
export function itemShops(item: CalendarItem, shopCodes: ReadonlyMap<string, string>): string {
  return item.locationIds
    .map((id) => shopCodes.get(id))
    .filter((code): code is string => Boolean(code))
    .join(", ");
}

/**
 * The `ul` around a run of `ItemLine`s: the dividing lines start at the
 * SECOND column (Mark, 2026-10-11) — past the line's 12px pad, the 80px time
 * column and the 16px gap — so the times read as one clear column.
 */
export const ITEM_LINES_CLASS =
  "[&>li+li]:relative [&>li+li]:before:absolute [&>li+li]:before:top-0 [&>li+li]:before:right-0 [&>li+li]:before:left-[6.75rem] [&>li+li]:before:border-t [&>li+li]:before:border-neutral-200 [&>li+li]:before:content-['']";

/**
 * ONE ITEM ON ONE LINE, as the day view's timed list and the list view both
 * draw it: the time in a column (empty for an item that has none), the item's
 * chip with its second phrase under it, and on the right its shops and layer.
 */
export function ItemLine({
  item,
  shopCodes,
  colors,
  onEntry,
}: {
  item: CalendarItem;
  shopCodes: ReadonlyMap<string, string>;
  colors: LayerColors;
  onEntry: (entryId: string) => void;
}) {
  return (
    <li>
      {openItem(
        item,
        "flex w-full items-baseline gap-4 px-3 py-2.5 hover:bg-neutral-100",
        <>
          <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
            {item.time ? clockTime(item.time) : ""}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`rounded-[4px] px-1.5 py-0.5 text-sm font-medium ${chipClass(item, colors)}`}>
              {item.lead ? `${item.lead}: ` : ""}
              {item.title}
            </span>
            {item.detail && <span className="mt-1 block text-sm text-muted">{item.detail}</span>}
          </span>
          <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-subtle">
            {[
              itemShops(item, shopCodes),
              item.blackout ? "Blackout" : LAYER_LABEL[item.layer],
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>,
        onEntry,
      )}
    </li>
  );
}
