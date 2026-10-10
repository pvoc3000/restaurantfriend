// Reading an OUTSIDE calendar (Google, iCloud, anything that publishes iCal)
// into rows the calendar page can draw — `calendar-sync`'s two pure halves.
//
//   safeFeedUrl   which URLs the function is willing to fetch at all
//   expandFeed    the file's events, repeating ones written out day by day,
//                 as dates and times on the ORG's wall clock
//
// THE LIBRARY IS PASSED IN (`ICAL`, the `ical.js` module) rather than imported
// here, so this file has no `npm:` specifier and runs unchanged under Node,
// which is how it is tested. Repeating events are the whole reason a library
// is used at all: RRULE, EXDATE, a moved occurrence (RECURRENCE-ID) and the
// file's own VTIMEZONE blocks are each a place a hand-rolled reader is wrong.
//
// WHAT IS KEPT is the title, the dates, the time and the place. Descriptions,
// attendees and organisers are never read out of the file: a subscribed
// calendar is somebody's diary, and the app has no use for the rest of it.

/** The subset of `ical.js` this file calls. Typed loosely on purpose. */
// deno-lint-ignore no-explicit-any
type Ical = any;

export type FeedOccurrence = {
  uid: string;
  /** `YYYY-MM-DD`, on the org's wall clock. */
  starts_on: string;
  /** Inclusive. Equal to `starts_on` for a one-day event. */
  ends_on: string;
  /** `HH:MM`, or null for an all-day event. */
  start_time: string | null;
  title: string;
  place: string | null;
};

/**
 * The URL to fetch, or null if it is one we will not.
 *
 * `webcal://` is what calendar apps hand out and means https. Anything that is
 * not https, that names a bare IP address or a local-looking host, or that
 * carries a username is refused: the function runs with the service role and
 * must not be talked into fetching something inside a network.
 */
export function safeFeedUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return null;
  if (!host.includes(".")) return null; // a bare intranet name
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4 literal
  if (host.includes(":") || host.startsWith("[")) return null; // IPv6 literal
  return url.toString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock date and time of an instant in `timeZone`. */
function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
function occurrence(start: any, end: any, uid: string, title: string, place: string | null, timeZone: string): FeedOccurrence {
  if (start.isDate) {
    // ALL-DAY. The file's end is EXCLUSIVE — Christmas Day ends on the 26th —
    // and every date in this app is inclusive.
    const first = `${start.year}-${pad(start.month)}-${pad(start.day)}`;
    const after = end ? `${end.year}-${pad(end.month)}-${pad(end.day)}` : first;
    const last = after > first ? addDays(after, -1) : first;
    return { uid, starts_on: first, ends_on: last, start_time: null, title, place };
  }
  const from = localParts(start.toJSDate(), timeZone);
  // One millisecond before the end, so a party that ends at midnight ends on
  // the day it was held and not on the next one.
  const endInstant = end ? end.toJSDate() : start.toJSDate();
  const to = localParts(new Date(Math.max(start.toJSDate().getTime(), endInstant.getTime() - 1)), timeZone);
  return {
    uid,
    starts_on: from.date,
    ends_on: to.date < from.date ? from.date : to.date,
    start_time: from.time,
    title,
    place,
  };
}

/**
 * Every occurrence in the file that touches `from`…`to` (inclusive ISO dates).
 *
 * `truncated` is true when `max` occurrences were reached — said to the person
 * who subscribed rather than silently showing part of a calendar.
 *
 * THROWS if the text is not a calendar. The caller turns that into the
 * subscription's `last_error`.
 */
export function expandFeed(
  ICAL: Ical,
  text: string,
  window: { from: string; to: string; timeZone: string; max?: number },
): { occurrences: FeedOccurrence[]; truncated: boolean } {
  const max = window.max ?? 2000;
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== "vcalendar") throw new Error("That address did not return a calendar.");

  // The file's own timezone definitions, so "9am America/Chicago" is read as
  // Chicago's nine and not the server's.
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(tz);
  }

  // A moved or edited occurrence of a repeating event is its own VEVENT with
  // the same UID and a RECURRENCE-ID. They are handed to their master, which
  // then reports the moved one in place of the original.
  const masters = new Map<string, Ical>();
  const exceptions: Ical[] = [];
  const singles: Ical[] = [];
  for (const component of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(component);
    if (!event.uid || !event.startDate) continue;
    if (String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (event.isRecurring()) masters.set(event.uid, event);
    else singles.push(event);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else singles.push(ex); // its master is not in the file: show it as it stands
  }

  const out: FeedOccurrence[] = [];
  let truncated = false;
  const keep = (o: FeedOccurrence) => {
    if (o.ends_on < window.from || o.starts_on > window.to) return;
    if (out.length >= max) {
      truncated = true;
      return;
    }
    out.push(o);
  };
  const text_ = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

  for (const event of singles) {
    keep(occurrence(event.startDate, event.endDate, event.uid, text_(event.summary) ?? "(no title)", text_(event.location), window.timeZone));
  }

  // A day past the window in the file's own terms, so an event that starts
  // late on the last day in another timezone is not cut off.
  const stopAfter = addDays(window.to, 2);
  for (const event of masters.values()) {
    const iterator = event.iterator();
    // A daily event begun years ago walks every day since. Bounded, so a
    // malformed rule cannot spin the function until it is killed.
    for (let i = 0; i < 20000 && !truncated; i += 1) {
      const next = iterator.next();
      if (!next) break;
      const day = `${next.year}-${pad(next.month)}-${pad(next.day)}`;
      if (day > stopAfter) break;
      if (day < addDays(window.from, -31)) continue; // long before the window
      const details = event.getOccurrenceDetails(next);
      const item = details.item;
      keep(
        occurrence(
          details.startDate,
          details.endDate,
          `${event.uid}:${day}`,
          text_(item.summary) ?? "(no title)",
          text_(item.location),
          window.timeZone,
        ),
      );
    }
  }

  out.sort((a, b) => a.starts_on.localeCompare(b.starts_on) || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  return { occurrences: out, truncated };
}
