// `lib/ics` — the iCalendar file a calendar app subscribes to.
//
// Checked by BREAKING each rule: folding by characters instead of bytes puts a
// line over 75 octets as soon as a title holds an em dash; an inclusive DTEND
// makes Christmas a zero-length event that Google drops; skipping `icsText`
// lets "Smith, Jones" become two values; writing the wall clock as if it were
// UTC moves every order by the zone's offset; and a UID that changes between
// fetches duplicates the whole calendar hourly.

import { test, eq, ok } from "./harness";
import { buildCalendar, foldLine, icsText, readFeed, type FeedItem } from "../../src/lib/ics";

const NOW = Date.UTC(2026, 9, 9, 18, 0, 0);
const BASE = { name: "Donut Friend", timeZone: "America/Los_Angeles", now: NOW, origin: "https://rf.example" };

function lines(items: FeedItem[]): string[] {
  return buildCalendar({ ...BASE, items }).split("\r\n");
}

test("text is escaped: backslash, semicolon, comma, newline", () => {
  eq(icsText("Smith, Jones; 6 doz\nring back\\"), "Smith\\, Jones\; 6 doz\\nring back\\\\");
});

test("a line folds at 75 OCTETS, never through a character", () => {
  const encoder = new TextEncoder();
  const long = "SUMMARY:" + "Closed — ".repeat(20);
  const folded = foldLine(long).split("\r\n");
  ok(folded.length > 1, "it folded");
  for (const [i, line] of folded.entries()) {
    ok(encoder.encode(line).length <= 75, `line ${i} is ${encoder.encode(line).length} octets`);
    if (i > 0) ok(line.startsWith(" "), "a continuation starts with a space");
  }
  // Unfolding gives the original back exactly — nothing lost at a fold.
  eq(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join(""), long);
  eq(foldLine("SUMMARY:short"), "SUMMARY:short");
});

test("an all-day event has an EXCLUSIVE end", () => {
  const out = lines([{ uid: "entry-1", date: "2026-12-25", title: "Christmas" }]);
  ok(out.includes("DTSTART;VALUE=DATE:20261225"));
  ok(out.includes("DTEND;VALUE=DATE:20261226"));
});

test("a span ends the day after its last day, across a year end", () => {
  const out = lines([{ uid: "entry-2", date: "2026-12-30", end_date: "2026-12-31", title: "Closed" }]);
  ok(out.includes("DTSTART;VALUE=DATE:20261230"));
  ok(out.includes("DTEND;VALUE=DATE:20270101"));
});

test("a timed event is the org's wall clock, written in UTC", () => {
  // 2:30 PM Pacific on Dec 18 is standard time, UTC-8.
  const winter = lines([{ uid: "order-1", date: "2026-12-18", time: "14:30", title: "SO-1" }]);
  ok(winter.includes("DTSTART:20261218T223000Z"));
  ok(winter.includes("DTEND:20261218T230000Z"));
  // …and on Jul 3 it is daylight time, UTC-7.
  const summer = lines([{ uid: "order-2", date: "2026-07-03", time: "14:30", title: "SO-2" }]);
  ok(summer.includes("DTSTART:20260703T213000Z"));
});

test("the UID is stable, and the event links back to its record", () => {
  const item = { uid: "order-abc", date: "2026-12-18", title: "SO-1", path: "/special-orders/abc", detail: "Pickup" };
  const a = lines([item]);
  const b = buildCalendar({ ...BASE, now: NOW + 3_600_000, items: [item] }).split("\r\n");
  const uid = (ls: string[]) => ls.find((l) => l.startsWith("UID:"));
  eq(uid(a), "UID:order-abc@restaurantfriend");
  const elsewhere = buildCalendar({ ...BASE, origin: "https://other.example", items: [item] }).split("\r\n");
  eq(uid(a), uid(elsewhere), "the same from another domain");
  eq(uid(a), uid(b), "the same an hour later");
  ok(a.includes("URL:https://rf.example/special-orders/abc"));
  ok(a.includes("DESCRIPTION:Pickup"));
  ok(a.includes("DTSTAMP:20261009T180000Z"));
});

test("the file is a well-formed VCALENDAR with CRLF ends", () => {
  const text = buildCalendar({ ...BASE, items: [{ uid: "e", date: "2026-12-25", title: "A, B" }] });
  ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  ok(text.endsWith("END:VCALENDAR\r\n"));
  ok(!/[^\r]\n/.test(text), "no bare LF");
  ok(text.includes("X-WR-CALNAME:Donut Friend"));
  ok(text.includes("SUMMARY:A\\, B"));
  eq((text.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  eq(buildCalendar({ ...BASE, items: [] }).includes("VEVENT"), false, "an empty feed is still a calendar");
});

test("readFeed: null when it is not a feed, and malformed items are dropped", () => {
  eq(readFeed(null), null);
  eq(readFeed({ items: [] }), null, "no label");
  eq(
    readFeed({
      label: "Mine",
      timezone: "America/Los_Angeles",
      items: [{ uid: "e", date: "2026-12-25", title: "X", time: null }, { uid: 3 }, null],
    }),
    {
      label: "Mine",
      timeZone: "America/Los_Angeles",
      items: [{ uid: "e", date: "2026-12-25", end_date: null, time: null, title: "X", detail: null, path: null }],
    },
  );
});
