// The two halves of "outside calendars" as the Settings screen and the
// calendar page read them (migrations 185, 186). Pure.

import type { CalendarItem } from "./calendar";

/** A layer a published feed may carry — `calendar_feed_by_token` has a branch
 *  for each of these and for nothing else. Never pay periods, never HR. */
export const FEED_LAYERS: readonly { key: string; label: string }[] = [
  { key: "entries", label: "Notes and blackouts" },
  { key: "special_orders", label: "Special orders" },
  { key: "deliveries", label: "Deliveries" },
  { key: "tasks", label: "Tasks and maintenance" },
];

export type FeedLink = {
  id: string;
  token: string;
  label: string;
  layers: string[];
  location_ids: string[];
  include_customer_names: boolean;
  created_at: string;
  revoked_at: string | null;
};

/** The address a calendar app subscribes to. `.ics` because some apps will
 *  not take a URL without it; the route ignores it. */
export function feedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/calendar-feed/${token}.ics`;
}

/** "Notes and blackouts · Special orders", in the menu's order. */
export function feedLayersLabel(layers: readonly string[]): string {
  const labels = FEED_LAYERS.filter((l) => layers.includes(l.key)).map((l) => l.label);
  return labels.length > 0 ? labels.join(" · ") : "Nothing";
}

export type CalendarSubscription = {
  id: string;
  name: string;
  location_ids: string[];
  is_active: boolean;
  has_url: boolean;
  last_fetched_at: string | null;
  last_error: string | null;
};

/** How stale a subscription may be before the calendar page asks for a read. */
export const SUBSCRIPTION_STALE_MS = 60 * 60 * 1000;

/**
 * Should the calendar page ask `calendar-sync` to read this one now?
 *
 * Active, has an address, and either never read or read over an hour ago. A
 * subscription whose last read FAILED waits the hour like any other: asking
 * again on every page load would be a fetch per visitor against an address
 * that is known to be broken.
 */
export function subscriptionIsStale(sub: CalendarSubscription, now: number): boolean {
  if (!sub.is_active || !sub.has_url) return false;
  if (!sub.last_fetched_at) return true;
  const last = Date.parse(sub.last_fetched_at);
  return Number.isNaN(last) || now - last > SUBSCRIPTION_STALE_MS;
}

export type SubscriptionEventRow = {
  id: string;
  subscription_id: string;
  starts_on: string;
  ends_on: string;
  start_time: string | null;
  title: string;
  place: string | null;
};

/**
 * Subscribed events as calendar items, one per day each covers within `range`.
 * Only the first day carries the time: on day two of a conference "9 AM" is
 * when it started, not when anything happens.
 */
export function subscriptionItems(
  rows: readonly SubscriptionEventRow[],
  subscriptions: readonly Pick<CalendarSubscription, "id" | "name" | "location_ids">[],
  range: { from: string; to: string },
): CalendarItem[] {
  const byId = new Map(subscriptions.map((s) => [s.id, s]));
  const items: CalendarItem[] = [];
  for (const row of rows) {
    const sub = byId.get(row.subscription_id);
    if (!sub) continue;
    const from = row.starts_on > range.from ? row.starts_on : range.from;
    const to = row.ends_on < range.to ? row.ends_on : range.to;
    for (let day = from; day <= to; day = nextDay(day)) {
      items.push({
        key: `feed:${row.id}:${day}`,
        layer: "feeds",
        date: day,
        time: day === row.starts_on && row.start_time ? row.start_time.slice(0, 5) : null,
        title: row.title,
        detail: [sub.name, row.place].filter(Boolean).join(" · "),
        locationIds: sub.location_ids,
      });
    }
  }
  return items;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
