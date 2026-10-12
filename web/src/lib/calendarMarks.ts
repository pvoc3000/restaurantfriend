// WHAT THE CALENDAR SAYS ABOUT A DAY, for another screen to draw under that
// day's heading (Mark, 2026-10-10: notes, blackouts and subscribed calendars
// on the special orders page, "the same colors as in the calendar as solid
// bands for each day … just under the day header").
//
// Pure. The caller hands in the days it is showing, and gets back, per day, a
// short list of marks: the words and the calendar's own chip classes. Only
// TYPED ENTRIES and SUBSCRIBED EVENTS — the things an orders list cannot know
// by itself. An order, a delivery or a task is not a mark: one of them is what
// the list already is, and the others have their own screens.

import {
  blackoutLabels,
  entryCoversDate,
  entryShops,
  entryTitle,
  isBlackout,
  type CalendarEntry,
} from "./blackoutDates";
import { clockTime } from "./calendar";
import { daysAfter } from "./today";
import { chipClass, type LayerColors } from "./calendarColors";
import type { CalendarSubscription, SubscriptionEventRow } from "./calendarFeeds";

/** What a mark IS — the three things the orders list's eye can hide. */
export type DayMarkKind = "blackout" | "note" | "feed";

/** In the order the eye lists them. */
export const DAY_MARK_KINDS: readonly { key: DayMarkKind; label: string }[] = [
  { key: "blackout", label: "Blackout dates" },
  { key: "note", label: "Notes" },
  { key: "feed", label: "Subscribed calendars" },
];

/**
 * The marks left after some kinds are hidden — days with none left are
 * dropped, so a day shown only for a hidden note stops being a day at all.
 *
 * `hidden` holds kinds ("feed" hides every subscribed calendar) and single
 * calendars (`feedMarkKey`), which is how one busy calendar is taken off the
 * list without losing the others.
 */
export function visibleMarks(
  marks: Readonly<Record<string, DayMark[]>>,
  hidden: readonly string[],
): Record<string, DayMark[]> {
  if (hidden.length === 0) return { ...marks };
  const out: Record<string, DayMark[]> = {};
  for (const [date, list] of Object.entries(marks)) {
    const kept = list.filter(
      (m) => !hidden.includes(m.kind) && !(m.source && hidden.includes(feedMarkKey(m.source))),
    );
    if (kept.length > 0) out[date] = kept;
  }
  return out;
}

/** The hidden-set key for ONE subscribed calendar, beside the kinds' own. */
export function feedMarkKey(subscriptionId: string): string {
  return `feed:${subscriptionId}`;
}

export type DayMark = {
  key: string;
  kind: DayMarkKind;
  /** For a `feed` mark, the subscribed calendar it came from. */
  source?: string;
  /** "Closed for Christmas — No special orders · Shop closed (DF01)". */
  text: string;
  /** The calendar's chip for it: fill and type together. */
  className: string;
  blackout: boolean;
};

/**
 * Every date in `span` that an entry or a subscribed event touches — the days
 * that HAVE something to say, whether or not anything else is on them. This is
 * what lets a closed day with no orders still appear in an orders list.
 */
export function markedDates(
  entries: readonly Pick<CalendarEntry, "starts_on" | "ends_on">[],
  feedEvents: readonly Pick<SubscriptionEventRow, "starts_on" | "ends_on">[],
  span: { from: string; to: string },
): string[] {
  const dates = new Set<string>();
  for (const thing of [...entries, ...feedEvents]) {
    const from = thing.starts_on > span.from ? thing.starts_on : span.from;
    const to = thing.ends_on < span.to ? thing.ends_on : span.to;
    for (let day = from; day <= to; day = daysAfter(day, 1)) dates.add(day);
  }
  return [...dates].sort();
}

/**
 * The marked days that fall strictly BETWEEN two neighbouring rows of a list
 * sorted by date, in the list's own direction — the empty days to draw a band
 * for. `prev`/`next` are the dates either side; null is the list's edge (or a
 * row with no date), which is unbounded on that side.
 */
export function gapDates(
  marked: readonly string[],
  prev: string | null,
  next: string | null,
  dir: "asc" | "desc",
): string[] {
  const lo = dir === "asc" ? prev : next;
  const hi = dir === "asc" ? next : prev;
  const between = marked.filter((d) => (lo === null || d > lo) && (hi === null || d < hi));
  return dir === "asc" ? between : between.reverse();
}

/**
 * The marks for each of `dates`, keyed by date. A day with none has no key.
 *
 * Blackouts first — they are the ones that change what an order on that day
 * means — then notes, then subscribed events in time order.
 */
export function dayMarks(input: {
  dates: readonly string[];
  entries: readonly CalendarEntry[];
  feedEvents: readonly SubscriptionEventRow[];
  subscriptions: readonly Pick<CalendarSubscription, "id" | "name" | "color">[];
  colors: LayerColors;
  /** Every shop, for the codes beside a one-shop entry. */
  locations: readonly { id: string; code: string }[];
}): Record<string, DayMark[]> {
  const subs = new Map(input.subscriptions.map((s) => [s.id, s]));
  const out: Record<string, DayMark[]> = {};

  for (const date of new Set(input.dates)) {
    const marks: (DayMark & { order: string })[] = [];

    for (const entry of input.entries) {
      if (!entryCoversDate(entry, date)) continue;
      const blackout = isBlackout(entry);
      // A blackout's shops follow its TITLE, as on the calendar (`entryTitle`);
      // a note's still close the line.
      const where =
        blackout || entry.location_ids.length === 0 ? "" : ` (${entryShops(entry, input.locations)})`;
      const what = blackout ? blackoutLabels(entry).join(" · ") : entry.note?.trim() || "";
      marks.push({
        key: `entry:${entry.id}`,
        text: `${entryTitle(entry, input.locations)}${what ? ` — ${what}` : ""}${where}${entry.is_private ? " · Private" : ""}`,
        className: chipClass({ layer: "entries", blackout, color: entry.color }, input.colors),
        blackout,
        kind: blackout ? "blackout" : "note",
        order: `${blackout ? "0" : "1"}:${entry.title}`,
      });
    }

    for (const event of input.feedEvents) {
      if (!(date >= event.starts_on && date <= event.ends_on)) continue;
      const sub = subs.get(event.subscription_id);
      if (!sub) continue;
      // The time only on the day it starts, as on the calendar.
      const time = date === event.starts_on && event.start_time ? event.start_time.slice(0, 5) : null;
      marks.push({
        key: `feed:${event.id}`,
        text: `${time ? `${clockTime(time)} ` : ""}${event.title} · ${sub.name}`,
        className: chipClass({ layer: "feeds", color: sub.color }, input.colors),
        blackout: false,
        kind: "feed",
        source: sub.id,
        order: `2:${time ?? "99:99"}:${event.title}`,
      });
    }

    if (marks.length > 0) {
      marks.sort((a, b) => a.order.localeCompare(b.order, undefined, { numeric: true }));
      out[date] = marks.map(({ key, kind, source, text, className, blackout }) => ({
        key,
        kind,
        ...(source ? { source } : {}),
        text,
        className,
        blackout,
      }));
    }
  }
  return out;
}
