import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage, canReachPage } from "@/lib/pageAccess";
import { canReadHr, canSetBlackouts } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { gridRange, parseMonthParam, type CalendarItem, type CalendarLayer } from "@/lib/calendar";
import { fetchEntries, fetchLayerItems, staleSubscriptionIds } from "@/lib/calendarQueries";
import { CalendarScreen, type CalendarView } from "@/components/calendar/CalendarScreen";
import { FeedRefresher } from "@/components/calendar/FeedRefresher";
import {
  subscriptionItems,
  type CalendarSubscription,
  type SubscriptionEventRow,
} from "@/lib/calendarFeeds";

/**
 * The calendar — build step 4s.
 *
 * Blackout dates, notes and events are typed here (`calendar_entries`,
 * migration 181), and what the rest of the app knows is coming is drawn on the
 * same month. It is a RECORD screen in design rule 3's sense, not an
 * operational one: it shows every shop and filters by a set of them, because
 * the question "what is on the 25th" is usually asked about all of them.
 *
 * `?month=2026-12` picks the month and is why changing it is a navigation —
 * every layer is fetched for exactly the 42 days the grid draws. `?view=list`
 * is the entries as a table, which loads all of them and no layers.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; shops?: string }>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const role = session.membership.role;

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const view: CalendarView = params.view === "list" ? "list" : "month";
  const month = parseMonthParam(params.month, today);
  const range = gridRange(month);

  // ENUMERATED, so the active list (design rule 3): a closed shop is not one
  // anybody writes a blackout for.
  const locations = session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }));
  const known = new Set(locations.map((l) => l.id));
  const shops = (params.shops ?? "").split(",").filter((id) => known.has(id));

  const { entries, error } = await fetchEntries(supabase, view === "list" ? {} : range);

  if (error) {
    // Before 181 is applied this names the missing table rather than drawing
    // an empty month, which would read as "nothing is planned".
    return (
      <p className="text-sm text-accent">
        Could not load the calendar: {error}
        {/calendar_entries/.test(error) ? " — migration 181 has not been applied yet." : ""}
      </p>
    );
  }

  // WHICH LAYERS THIS PERSON MAY SEE is the Page Permissions sheet's answer for
  // the screen each one comes from: if you may not open Purchase Orders you are
  // not shown deliveries here. RLS refuses the rows regardless; this is what
  // keeps a layer that would always be empty out of the menu.
  const layers: CalendarLayer[] = ["entries"];
  if (canReachPage(role, "/special-orders")) layers.push("orders_paid", "orders_unpaid");
  if (canReachPage(role, "/purchase-orders")) layers.push("deliveries");
  if (canReachPage(role, "/tasks")) layers.push("tasks");
  if (canReachPage(role, "/pay-periods")) layers.push("pay_periods");
  if (canReadHr(role)) layers.push("hr", "hr_events");

  let layerItems: CalendarItem[] = [];
  let layerFailures: string[] = [];
  // Subscribed calendars whose stored copy is over an hour old (migration
  // 186). Non-empty, the page mounts `FeedRefresher`, which asks for a read.
  let stale: string[] = [];
  if (view === "month") {
    const [fetched, subs, feedEvents] = await Promise.all([
      fetchLayerItems(supabase, layers, range),
      supabase
        .from("calendar_subscriptions")
        .select("id, name, location_ids, is_active, has_url, last_fetched_at, last_error")
        .eq("is_active", true)
        .order("created_at"),
      supabase
        .from("calendar_subscription_events")
        .select("id, subscription_id, starts_on, ends_on, start_time, title, place")
        .gte("ends_on", range.from)
        .lte("starts_on", range.to)
        .order("starts_on")
        .order("id")
        .limit(1000),
    ]);
    layerItems = fetched.items;
    layerFailures = fetched.failed.map((f) => `${f.layer}: ${f.message}`);

    // A missing table (186 not applied) is no subscriptions, not a broken page.
    const subscriptions = ((subs.data ?? []) as CalendarSubscription[]).map((sub) => ({
      ...sub,
      location_ids: sub.location_ids ?? [],
    }));
    if (subscriptions.length > 0) {
      layers.push("feeds");
      layerItems.push(
        ...subscriptionItems((feedEvents.data ?? []) as SubscriptionEventRow[], subscriptions, range),
      );
      // Said by name, where the calendar is looked at: a subscription that
      // stopped working otherwise just looks like an empty week.
      layerFailures.push(
        ...subscriptions.filter((sub) => sub.last_error).map((sub) => `${sub.name}: ${sub.last_error}`),
      );
      stale = staleSubscriptionIds(subscriptions);
    }
  }

  return (
    <>
      {stale.length > 0 && <FeedRefresher staleKey={stale.join(",")} />}
      <CalendarScreen
      // Keyed by what the server chose, so the screen's own state (the shop
      // filter it seeds from the URL) follows a navigation.
      key={`${view}:${month}`}
      orgId={session.membership.org_id}
      view={view}
      month={month}
      today={today}
      entries={entries}
      layerItems={layerItems}
      layerFailures={layerFailures}
      layers={layers}
      locations={locations}
      shops={shops}
      canWrite={canEditPage(role, "/calendar")}
      canSetBlackouts={canSetBlackouts(role)}
      />
    </>
  );
}
