// `lib/calendarFeeds` — the published link's address, and a subscription's
// staleness and items.
//
// Checked by BREAKING: a stale rule that ignores `has_url` asks the function
// to read a subscription with no address on every page load; one that treats a
// failed read as stale asks again for every visitor; and putting the time on
// every day of a multi-day event says "9 AM" on a day nothing starts.

import { test, eq, ok, no } from "./harness";
import {
  feedLayersLabel,
  feedUrl,
  subscriptionIsStale,
  subscriptionItems,
  SUBSCRIPTION_STALE_MS,
  type CalendarSubscription,
} from "../../src/lib/calendarFeeds";

const NOW = Date.parse("2026-10-09T18:00:00Z");

function sub(patch: Partial<CalendarSubscription> = {}): CalendarSubscription {
  return {
    id: "s1",
    name: "Mark",
    location_ids: [],
    is_active: true,
    has_url: true,
    last_fetched_at: null,
    last_error: null,
    ...patch,
  };
}

test("feedUrl ends in .ics and survives a trailing slash on the origin", () => {
  eq(feedUrl("https://rf.example/", "abc"), "https://rf.example/calendar-feed/abc.ics");
  eq(feedUrl("https://rf.example", "abc"), "https://rf.example/calendar-feed/abc.ics");
});

test("feedLayersLabel is in the menu's order and ignores what a feed cannot carry", () => {
  eq(feedLayersLabel(["special_orders", "entries"]), "Notes and blackouts · Special orders");
  eq(feedLayersLabel(["hr", "pay_periods"]), "Nothing");
});

test("stale: never read, or read over an hour ago", () => {
  ok(subscriptionIsStale(sub(), NOW), "never read");
  ok(subscriptionIsStale(sub({ last_fetched_at: new Date(NOW - SUBSCRIPTION_STALE_MS - 1000).toISOString() }), NOW));
  no(subscriptionIsStale(sub({ last_fetched_at: new Date(NOW - 60_000).toISOString() }), NOW), "a minute ago");
});

test("stale: not when inactive, not without an address, and a failure waits its hour", () => {
  no(subscriptionIsStale(sub({ is_active: false }), NOW));
  no(subscriptionIsStale(sub({ has_url: false }), NOW));
  no(
    subscriptionIsStale(
      sub({ last_error: "The calendar could not be reached.", last_fetched_at: new Date(NOW - 60_000).toISOString() }),
      NOW,
    ),
  );
});

test("subscribed events: one item per day, the time on the first day only", () => {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  const items = subscriptionItems(
    [
      { id: "e1", subscription_id: "s1", starts_on: "2026-12-10", ends_on: "2026-12-11", start_time: "09:00:00", title: "Trade show", place: "Anaheim" },
      { id: "e2", subscription_id: "gone", starts_on: "2026-12-10", ends_on: "2026-12-10", start_time: null, title: "Orphan", place: null },
    ],
    [{ id: "s1", name: "Mark", location_ids: ["df01"] }],
    range,
  );
  eq(items.map((i) => `${i.date} ${i.time ?? "-"} ${i.title}`), ["2026-12-10 09:00 Trade show", "2026-12-11 - Trade show"]);
  eq(items[0].layer, "feeds");
  eq(items[0].detail, "Mark · Anaheim");
  eq(items[0].locationIds, ["df01"]);
  eq(items[0].href, undefined, "nothing to open");
});

test("subscribed events are clamped to the days on screen", () => {
  const items = subscriptionItems(
    [{ id: "e", subscription_id: "s1", starts_on: "2026-11-01", ends_on: "2026-12-01", start_time: null, title: "Leave", place: null }],
    [{ id: "s1", name: "Mark", location_ids: [] }],
    { from: "2026-11-29", to: "2027-01-09" },
  );
  eq(items.map((i) => i.date), ["2026-11-29", "2026-11-30", "2026-12-01"]);
});
