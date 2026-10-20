import Link from "next/link";

import { CALENDAR_LAYERS, clockTime, type CalendarItem } from "@/lib/calendar";
import { chipClass, type LayerColors } from "@/lib/calendarColors";

// Built here rather than imported from `calendar/ItemLine`: that module is
// "use client", and a plain object from one is only a reference on the server.
const LAYER_LABEL: Record<string, string> = Object.fromEntries(CALENDAR_LAYERS.map((l) => [l.key, l.label]));

/**
 * A hairline round a calendar chip on a widget. A widget can wear a tint, and
 * the calendar's palette has a chip of nearly every tint — a Deliveries chip
 * (sky) on a Sky widget vanished (seen 2026-10-20). The calendar itself has no
 * tinted ground, so it does without.
 */
export const WIDGET_CHIP_EDGE = "ring-1 ring-inset ring-black/15";

/**
 * ONE CALENDAR ITEM ON A START-PAGE WIDGET — the Calendar's upcoming list and
 * the Today timeline. The calendar's own chip (`chipClass`, so an entry wears
 * the colour it wears on `/calendar`), its time in a column when it has one,
 * and from two columns its second phrase and its shops.
 *
 * A tap goes where the item goes on the calendar; an ENTRY, which opens a
 * dialog there, opens its day on the calendar instead — the dialog belongs to
 * that screen.
 */
export function AgendaLine({
  item,
  colors,
  shopCodes,
  showTime = true,
}: {
  item: CalendarItem;
  colors: LayerColors;
  /** id → code, every shop. */
  shopCodes: ReadonlyMap<string, string>;
  showTime?: boolean;
}) {
  const href = item.href ?? `/calendar?view=day&date=${item.date}`;
  const shops = item.locationIds.map((id) => shopCodes.get(id)).filter(Boolean).join(", ");
  return (
    <li>
      <Link href={href} className="flex w-full min-w-0 items-baseline gap-3 py-1 no-underline hover:bg-neutral-100">
        {showTime && (
          <span className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums">
            {item.time ? clockTime(item.time) : ""}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`rounded-[4px] px-1.5 py-0.5 text-[13px] font-medium ${WIDGET_CHIP_EDGE} ${chipClass(item, colors)}`}>
            {item.lead ? `${item.lead}: ` : ""}
            {item.title}
          </span>
          {item.detail && <span className="mt-0.5 hidden truncate text-[13px] text-muted @xl:block">{item.detail}</span>}
        </span>
        <span className="hidden shrink-0 text-[11px] uppercase tracking-[0.08em] text-subtle @xl:inline">
          {[shops, item.blackout ? "Blackout" : item.private ? "Private" : LAYER_LABEL[item.layer]].filter(Boolean).join(" · ")}
        </span>
      </Link>
    </li>
  );
}

/** "Today", "Tomorrow", or "Wed 10/22". */
export function dayLabel(iso: string, today: string, tomorrow: string): string {
  if (iso === today) return "Today";
  if (iso === tomorrow) return "Tomorrow";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
