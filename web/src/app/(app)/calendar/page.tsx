import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { canManageMembers, canSetBlackouts } from "@/lib/roles";
import { readLayerColors } from "@/lib/calendarColors";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import {
  calendarLayersFor,
  gridRange,
  parseDateParam,
  parseMonthParam,
  parseShopsParam,
  type CalendarItem,
} from "@/lib/calendar";
import { monthStart } from "@/lib/dateRange";
import { fetchEntries, fetchFeeds, fetchLayerItems, staleSubscriptionIds } from "@/lib/calendarQueries";
import { CalendarScreen, type CalendarView } from "@/components/calendar/CalendarScreen";
import { FeedRefresher } from "@/components/calendar/FeedRefresher";

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
 * every layer is fetched for exactly the 42 days the grid draws.
 * `?view=day&date=2026-12-25` is one day in full, fetched for that day alone.
 * `?view=list&month=2026-12` is that month as a list, one band per day
 * (`calendar/ListView`), fetched like the month.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string; view?: string; shops?: string }>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const role = session.membership.role;

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const view: CalendarView =
    params.view === "list" ? "list" : params.view === "day" ? "day" : "month";
  // The DAY view is one date (`?view=day&date=…`), and the month it sits in is
  // what Month goes back to.
  const date = parseDateParam(params.date, today);
  const month = view === "day" ? monthStart(date) : parseMonthParam(params.month, today);
  // What every layer is fetched for: the 42 days of the grid, or the one day.
  const range = view === "day" ? { from: date, to: date } : gridRange(month);

  // ENUMERATED, so the active list (design rule 3): a closed shop is not one
  // anybody writes a blackout for.
  const locations = session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }));
  const known = new Set(locations.map((l) => l.id));
  // The Shops picker opens on ALL SHOPS; "Working location" is a choice in it
  // (`parseShopsParam`).
  const working = session.activeLocation
    ? { id: session.activeLocation.id, code: session.activeLocation.code }
    : null;
  const shops = parseShopsParam(params.shops, known, working !== null);

  const { entries, error } = await fetchEntries(supabase, range);

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

  // WHICH LAYERS THIS PERSON MAY SEE — `calendarLayersFor`, shared with the
  // start page's Today widget.
  const layers = calendarLayersFor(role, Boolean(session.activeLocation));

  let layerItems: CalendarItem[] = [];
  let layerFailures: string[] = [];
  // Subscribed calendars whose stored copy is over an hour old (migration
  // 186). Non-empty, the page mounts `FeedRefresher`, which asks for a read.
  let stale: string[] = [];
  let calendars: { id: string; name: string }[] = [];
  {
    const [fetched, feeds] = await Promise.all([
      // `session.locations`, the FULL list: a lookup, not an enumeration
      // (design rule 3), so a delivery to a since-closed shop still has a code.
      fetchLayerItems(
        supabase,
        layers,
        range,
        session.locations,
        session.activeLocation?.id ?? null,
      ),
      fetchFeeds(supabase, range),
    ]);
    layerItems = fetched.items;
    layerFailures = fetched.failed.map((f) => `${f.layer}: ${f.message}`);

    const { subscriptions } = feeds;
    if (subscriptions.length > 0) {
      layers.push("feeds");
      calendars = subscriptions
        .map((sub) => ({ id: sub.id, name: sub.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      layerItems.push(...feeds.items);
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
      key={`${view}:${view === "day" ? date : month}`}
      orgId={session.membership.org_id}
      userId={session.userId}
      view={view}
      month={month}
      date={date}
      today={today}
      entries={entries}
      layerItems={layerItems}
      layerFailures={layerFailures}
      calendars={calendars}
      layers={layers}
      locations={locations}
      shops={shops}
      workingLocation={working}
      canWrite={canEditPage(role, "/calendar")}
      canSetBlackouts={canSetBlackouts(role)}
      layerColors={readLayerColors(session.orgSettings)}
      orgSettings={canManageMembers(role) ? (session.orgSettings as Record<string, unknown>) : null}
      />
    </>
  );
}
