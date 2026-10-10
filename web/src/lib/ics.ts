// AN iCALENDAR FILE (RFC 5545) — what `/calendar-feed/[token]` serves.
//
// Pure, so every rule a calendar app is strict about is pinned by a fixture:
//
//   * CRLF line ends, and no line over 75 OCTETS — folded with CRLF + a space,
//     counted in UTF-8 bytes and never splitting a character, or Apple Calendar
//     shows mojibake where an em dash straddled the fold;
//   * `\`, `;`, `,` and newlines escaped in text, or a title with a comma in it
//     is read as two values;
//   * an all-day event is `VALUE=DATE` with an EXCLUSIVE end — Christmas Day is
//     DTSTART 25th, DTEND 26th — where every date in this app is inclusive;
//   * a timed event is written in UTC, converted from the org's wall clock by
//     `lib/timeZone`, so no VTIMEZONE block has to be shipped and kept right;
//   * a UID that is the same every time the feed is fetched, or the calendar
//     app sees 400 new events an hour and keeps the old ones.

import { instantFor } from "./timeZone";
import { daysAfter } from "./today";

export type FeedItem = {
  /** Stable across fetches: "order-<uuid>". */
  uid: string;
  /** `YYYY-MM-DD`, the first (or only) day. */
  date: string;
  /** INCLUSIVE last day; omit or repeat `date` for one day. */
  end_date?: string | null;
  /** `HH:MM` on the org's wall clock, or null for an all-day event. */
  time?: string | null;
  title: string;
  detail?: string | null;
  /** A route in the app — `/special-orders/<id>` — made absolute with `origin`. */
  path?: string | null;
};

/** How long a timed event is drawn for. An order has a time, not a duration. */
const TIMED_MINUTES = 30;

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold one content line to 75 octets (RFC 5545 §3.1).
 *
 * The first line holds 75 bytes and each continuation 74 plus its leading
 * space. Walked by CODE POINT, so a multi-byte character is never cut in half.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");

/** `20261225T223000Z` from an instant in ms. */
function utcStamp(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function eventLines(
  item: FeedItem,
  opts: { timeZone: string; stamp: string; origin: string; host: string },
): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${item.uid}@${opts.host}`, `DTSTAMP:${opts.stamp}`];

  const time = item.time && /^\d{2}:\d{2}/.test(item.time) ? item.time : null;
  if (time) {
    const start = instantFor(
      opts.timeZone,
      item.date,
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
    ).instant;
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + TIMED_MINUTES * 60_000)}`);
  } else {
    const last = item.end_date && item.end_date > item.date ? item.end_date : item.date;
    lines.push(
      `DTSTART;VALUE=DATE:${compact(item.date)}`,
      // EXCLUSIVE: the day after the last one.
      `DTEND;VALUE=DATE:${compact(daysAfter(last, 1))}`,
    );
  }

  lines.push(`SUMMARY:${icsText(item.title)}`);
  if (item.detail) lines.push(`DESCRIPTION:${icsText(item.detail)}`);
  if (item.path && opts.origin) lines.push(`URL:${opts.origin}${item.path}`);
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/**
 * The whole file.
 *
 * `now` is passed in (an instant in ms) so the output is a function of its
 * arguments and a fixture can compare it whole. `origin` is the app's own
 * `https://host`, for each event's link back to its record.
 */
export function buildCalendar(input: {
  name: string;
  timeZone: string;
  items: readonly FeedItem[];
  now: number;
  origin: string;
}): string {
  // A FIXED host in the UID, never the request's: the same feed reached by
  // two domains (the Vercel address and a custom one) must be the same events.
  const opts = {
    timeZone: input.timeZone,
    stamp: utcStamp(input.now),
    origin: input.origin,
    host: "restaurantfriend",
  };

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//restaurantfriend//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(input.name)}`,
    `X-WR-TIMEZONE:${input.timeZone}`,
    // Ask to be re-read hourly. Apple honours it; Google reads on its own
    // schedule (roughly twice a day) whatever a feed says.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...input.items.flatMap((item) => eventLines(item, opts)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Read `calendar_feed_by_token`'s jsonb defensively. Null when it is not a feed. */
export function readFeed(
  data: unknown,
): { label: string; timeZone: string; items: FeedItem[] } | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as { label?: unknown; timezone?: unknown; items?: unknown };
  if (typeof raw.label !== "string") return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((i): FeedItem[] => {
    const r = (i ?? {}) as Record<string, unknown>;
    if (typeof r.uid !== "string" || typeof r.date !== "string" || typeof r.title !== "string") {
      return [];
    }
    return [
      {
        uid: r.uid,
        date: r.date,
        end_date: typeof r.end_date === "string" ? r.end_date : null,
        time: typeof r.time === "string" ? r.time : null,
        title: r.title,
        detail: typeof r.detail === "string" ? r.detail : null,
        path: typeof r.path === "string" ? r.path : null,
      },
    ];
  });
  return {
    label: raw.label,
    timeZone: typeof raw.timezone === "string" && raw.timezone ? raw.timezone : "UTC",
    items,
  };
}
