import { calendarLayersFor, entryItems, visibleItems, type CalendarLayer } from "@/lib/calendar";
import { readLayerColors } from "@/lib/calendarColors";
import { fetchEntries, fetchFeeds, fetchLayerItems } from "@/lib/calendarQueries";
import { canReachPage } from "@/lib/pageAccess";
import { todayTimeline, type TodaySchedule } from "@/lib/startPage";

import { AgendaLine } from "../AgendaLine";
import type { StartContext } from "./shared";

/** The calendar's layers that say what is HAPPENING today at a shop. Pay
 *  periods and HR are about people, not the day's work, and stay off. */
const TODAY_LAYERS: readonly CalendarLayer[] = [
  "menu_plan",
  "orders_paid",
  "orders_unpaid",
  "standing_orders",
  "deliveries",
  "tasks",
];

/**
 * TODAY — the day at this shop in one place (Mark, 2026-10-17): deliveries
 * due, special-order pickups and deliveries with their times, standing-order
 * days, tasks, the calendar's entries and closures, subscribed calendars, and
 * what production is making — a schedule if one was committed, otherwise the
 * menu plan (`todayTimeline`).
 *
 * The calendar's own queries and items (`fetchLayerItems`, gated by
 * `calendarLayersFor` exactly as `/calendar` is), so a line here and its chip
 * on the calendar are the same line. Sold here or made here both count, as on
 * the Special Orders widget. Wider, it says more: the detail line and shops
 * from two columns, "All day" beside "By time" at three.
 */
export async function TodayWidget(ctx: StartContext) {
  const day = { from: ctx.today, to: ctx.today };
  const layers = calendarLayersFor(ctx.role, true).filter((l) => TODAY_LAYERS.includes(l));
  const maySchedules = canReachPage(ctx.role, "/schedules");

  const [layered, { entries, error }, feeds, schedules] = await Promise.all([
    fetchLayerItems(ctx.supabase, layers, day, ctx.session.locations, ctx.shop.id),
    fetchEntries(ctx.supabase, day),
    fetchFeeds(ctx.supabase, day),
    maySchedules
      ? ctx.supabase
          .from("production_schedules")
          .select("id, title, location_id, kitchen_location_id, source")
          .eq("schedule_date", ctx.today)
          .or(`location_id.eq.${ctx.shop.id},kitchen_location_id.eq.${ctx.shop.id}`)
          .order("id")
      : null,
  ]);

  const items = visibleItems([...layered.items, ...entryItems(entries, day, ctx.session.locations), ...feeds.items], {
    hiddenLayers: new Set(),
    shops: [ctx.shop.id],
  });
  const codes = new Map(ctx.session.locations.map((l) => [l.id, l.code]));
  const { banners, timed } = todayTimeline(items, (schedules?.data ?? []) as TodaySchedule[], ctx.today, codes);
  const colors = readLayerColors(ctx.session.orgSettings);
  const failures = [
    ...layered.failed.map((f) => f.layer),
    ...(error ? ["entries"] : []),
    ...(schedules?.error ? ["schedules"] : []),
  ];

  return (
    <div className="space-y-3">
      {failures.length > 0 && <p className="text-sm text-accent">Could not load: {failures.join(", ")}.</p>}
      {banners.length === 0 && timed.length === 0 ? (
        <p className="text-sm text-muted">Nothing on today.</p>
      ) : (
        <div className="grid gap-4 @4xl:grid-cols-2 @4xl:items-start">
          {banners.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">All day</h3>
              <ul>
                {banners.map((item) => (
                  <AgendaLine key={item.key} item={item} colors={colors} shopCodes={codes} showTime={false} />
                ))}
              </ul>
            </section>
          )}
          {timed.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">By time</h3>
              <ul>
                {timed.map((item) => (
                  <AgendaLine key={item.key} item={item} colors={colors} shopCodes={codes} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
