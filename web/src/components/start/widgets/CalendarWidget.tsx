import { compareItems, entryItems, visibleItems } from "@/lib/calendar";
import { readLayerColors } from "@/lib/calendarColors";
import { fetchEntries, fetchFeeds } from "@/lib/calendarQueries";
import { CALENDAR_DAYS } from "@/lib/startLayout";
import { daysAfter } from "@/lib/today";

import { CalendarUpcoming } from "../CalendarUpcoming";
import type { StartContext } from "./shared";

/**
 * CALENDAR — what is coming up at this shop (Mark, 2026-10-17: an upcoming
 * list, "entries + subscribed feeds"). The calendar's own notes, events and
 * closures and the subscribed calendars; NOT its orders, deliveries or tasks,
 * which have their own widgets and the Today widget. An every-shop entry is
 * true of this shop too, so it stays (`visibleItems`).
 *
 * Fetched for the LONGEST day count the corner menu offers; the client cuts it
 * to the widget's own, so changing it needs no trip here.
 */
export async function CalendarWidget(ctx: StartContext) {
  const range = { from: ctx.today, to: daysAfter(ctx.today, Math.max(...CALENDAR_DAYS) - 1) };
  const [{ entries, error }, feeds] = await Promise.all([fetchEntries(ctx.supabase, range), fetchFeeds(ctx.supabase, range)]);
  if (error) return <p className="text-sm text-accent">Could not load the calendar: {error}</p>;

  const items = visibleItems([...entryItems(entries, range, ctx.session.locations), ...feeds.items], {
    hiddenLayers: new Set(),
    shops: [ctx.shop.id],
  }).sort((a, b) => a.date.localeCompare(b.date) || compareItems(a, b));

  return (
    <CalendarUpcoming
      items={items}
      today={ctx.today}
      colors={readLayerColors(ctx.session.orgSettings)}
      shopCodes={ctx.session.locations.map((l) => [l.id, l.code])}
    />
  );
}
