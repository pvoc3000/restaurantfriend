// `lib/calendarMarks` — what the calendar says about a day, for another screen.
//
// Checked by BREAKING: without the date test every entry marks every day; with
// the time on every day of a multi-day event a conference says "9 AM" on day
// two; and sorting by title alone puts a note above the closure it sits under.

import { test, eq, ok } from "./harness";
import { dayMarks } from "../../src/lib/calendarMarks";
import { BLACKOUT_CHIP, colorChip } from "../../src/lib/calendarColors";
import type { CalendarEntry } from "../../src/lib/blackoutDates";

function entry(patch: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: "e",
    title: "Christmas",
    starts_on: "2026-12-25",
    ends_on: "2026-12-25",
    location_ids: [],
    no_special_orders: false,
    no_standing_orders: false,
    no_production: false,
    shop_closed: false,
    note: null,
    ...patch,
  };
}

const BASE = {
  feedEvents: [],
  subscriptions: [],
  colors: {},
  locations: [{ id: "df01", code: "DF01" }],
};

test("a day gets the entries that cover it, and a day with none has no key", () => {
  const marks = dayMarks({
    ...BASE,
    dates: ["2026-12-24", "2026-12-25", "2026-12-25"],
    entries: [entry({})],
  });
  eq(Object.keys(marks), ["2026-12-25"]);
  eq(marks["2026-12-25"].length, 1, "a repeated date is one day");
});

test("a blackout says what it stops and where, in the dark chip, and leads", () => {
  const marks = dayMarks({
    ...BASE,
    dates: ["2026-12-25"],
    entries: [
      entry({ id: "n", title: "A note", note: "bring cones" }),
      entry({ id: "b", title: "Closed", no_special_orders: true, shop_closed: true, location_ids: ["df01"], color: "red" }),
    ],
  })["2026-12-25"];
  eq(marks.map((m) => m.text), [
    "Closed — No special orders · Shop closed (DF01)",
    "A note — bring cones",
  ]);
  eq(marks[0].className, BLACKOUT_CHIP, "its own colour does not recolour a blackout");
  ok(marks[0].blackout);
  eq(marks[1].className, colorChip("yellow"));
});

test("a note wears its own colour, then the organisation's for the layer", () => {
  const own = dayMarks({ ...BASE, dates: ["2026-12-25"], entries: [entry({ color: "teal" })] });
  eq(own["2026-12-25"][0].className, colorChip("teal"));
  const org = dayMarks({ ...BASE, colors: { entries: "pink" }, dates: ["2026-12-25"], entries: [entry({})] });
  eq(org["2026-12-25"][0].className, colorChip("pink"));
});

test("a subscribed event: its calendar's name and colour, the time on day one only", () => {
  const marks = dayMarks({
    ...BASE,
    dates: ["2026-12-10", "2026-12-11"],
    entries: [],
    subscriptions: [{ id: "s", name: "Mark", color: "lime" }],
    feedEvents: [
      { id: "f", subscription_id: "s", starts_on: "2026-12-10", ends_on: "2026-12-11", start_time: "09:00:00", title: "Trade show", place: null },
      { id: "g", subscription_id: "gone", starts_on: "2026-12-10", ends_on: "2026-12-10", start_time: null, title: "Orphan", place: null },
    ],
  });
  eq(marks["2026-12-10"].map((m) => m.text), ["9 AM Trade show · Mark"]);
  eq(marks["2026-12-11"].map((m) => m.text), ["Trade show · Mark"]);
  eq(marks["2026-12-10"][0].className, colorChip("lime"));
});
