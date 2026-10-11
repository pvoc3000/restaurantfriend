// `lib/calendarMarks` — what the calendar says about a day, for another screen.
//
// Checked by BREAKING: without the date test every entry marks every day; with
// the time on every day of a multi-day event a conference says "9 AM" on day
// two; and sorting by title alone puts a note above the closure it sits under.

import { test, eq, ok } from "./harness";
import { dayMarks, gapDates, markedDates, visibleMarks } from "../../src/lib/calendarMarks";
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

/* -- days with no order on them ------------------------------------------ */
// Checked by BREAKING: an inclusive bound draws a second band for a day that
// already has orders; ignoring `dir` lists a descending list's empty days
// backwards; and an unclamped walk of a year-long entry returns 365 days.

test("markedDates: every day something touches, inside the span", () => {
  eq(
    markedDates(
      [{ starts_on: "2026-12-24", ends_on: "2026-12-26" }, { starts_on: "2026-01-01", ends_on: "2026-12-31" }],
      [{ starts_on: "2026-12-30", ends_on: "2026-12-30" }],
      { from: "2026-12-25", to: "2026-12-27" },
    ),
    ["2026-12-25", "2026-12-26", "2026-12-27"],
  );
  eq(markedDates([], [], { from: "2026-12-01", to: "2026-12-31" }), []);
});

test("gapDates: strictly between the neighbours, in the list's direction", () => {
  const marked = ["2026-12-20", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"];
  eq(gapDates(marked, "2026-12-24", "2026-12-26", "asc"), ["2026-12-25"], "the neighbours have their own bands");
  eq(gapDates(marked, null, "2026-12-24", "asc"), ["2026-12-20"], "before the first row");
  eq(gapDates(marked, "2026-12-26", null, "asc"), ["2026-12-31"], "after the last");
  eq(gapDates(marked, "2026-12-26", "2026-12-20", "desc"), ["2026-12-25", "2026-12-24"], "descending");
  eq(gapDates(marked, null, "2026-12-26", "desc"), ["2026-12-31"]);
  eq(gapDates(marked, "2026-12-24", "2026-12-25", "asc"), []);
});

/* -- hiding a kind ------------------------------------------------------- */

test("hiding a kind drops its marks, and a day left with none stops being a day", () => {
  const marks = dayMarks({
    ...BASE,
    dates: ["2026-12-24", "2026-12-25"],
    entries: [
      entry({ id: "b", title: "Closed", shop_closed: true }),
      entry({ id: "n", title: "Note", starts_on: "2026-12-24", ends_on: "2026-12-25" }),
    ],
  });
  eq(marks["2026-12-25"].map((m) => m.kind), ["blackout", "note"]);
  eq(Object.keys(visibleMarks(marks, [])).sort(), ["2026-12-24", "2026-12-25"]);
  const noNotes = visibleMarks(marks, ["note"]);
  eq(Object.keys(noNotes), ["2026-12-25"], "the 24th had only the note");
  eq(noNotes["2026-12-25"].map((m) => m.kind), ["blackout"]);
  eq(visibleMarks(marks, ["note", "blackout", "feed"]), {});
});
