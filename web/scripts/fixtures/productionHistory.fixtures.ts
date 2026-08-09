// lib/productionHistory — the item record's two-week made/leftover block.
//
// Every case below is a rule that reads as a detail and isn't. The window is
// off by one or shifted a day by a timezone; a fortnight collapses to the two
// days that have rows; two shops on one night become two nights; an average
// over five counted nights is quietly divided by fourteen. Each one produces a
// number that looks entirely reasonable and is wrong.

import { test, eq, ok, no } from "./harness";
import {
  historyWindow,
  addDays,
  bucketByDay,
  summarise,
  historyDate,
  type HistoryLine,
} from "../../src/lib/productionHistory";

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function line(over: Partial<HistoryLine> & { schedule_date: string }): HistoryLine {
  return {
    location_id: DF01,
    par: 18,
    made: null,
    leftover: null,
    sold: null,
    ...over,
  };
}

/* -- the window ---------------------------------------------------------- */

test("historyWindow is 14 dates INCLUSIVE, oldest first, ending on today", () => {
  const w = historyWindow("2026-08-09");
  eq(w.dates.length, 14);
  eq(w.from, "2026-07-27");
  eq(w.to, "2026-08-09");
  eq(w.dates[0], "2026-07-27");
  eq(w.dates[13], "2026-08-09");
});

test("historyWindow crosses a month boundary correctly", () => {
  eq(historyWindow("2026-09-05").from, "2026-08-23");
});

test("historyWindow crosses a YEAR boundary correctly", () => {
  eq(historyWindow("2026-01-03").from, "2025-12-21");
});

test("addDays crosses a leap day", () => {
  // 2028 is a leap year; 2027 is not. A rule written with 365s gets this wrong.
  eq(addDays("2028-02-28", 1), "2028-02-29");
  eq(addDays("2027-02-28", 1), "2027-03-01");
});

test("the window does not shift west of Greenwich", () => {
  // `new Date("2026-08-09")` is UTC midnight, which is the 8th in Los Angeles.
  // The whole module works in string arithmetic through a UTC anchor so the
  // answer cannot depend on where the server is.
  const before = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  eq(historyWindow("2026-08-09").from, "2026-07-27");
  eq(historyDate("2026-08-09"), "Sun 8/9");
  process.env.TZ = before;
});

/* -- the buckets --------------------------------------------------------- */

test("bucketByDay returns a DENSE fortnight, not just the days with rows", () => {
  const { dates } = historyWindow("2026-08-09");
  const days = bucketByDay([line({ schedule_date: "2026-08-09", made: 18 })], dates);
  // Filtering to the rows that exist would give 1.
  eq(days.length, 14);
  eq(days[13].date, "2026-08-09");
});

test("not scheduled and not counted are DIFFERENT sentences", () => {
  const { dates } = historyWindow("2026-08-09");
  const days = bucketByDay(
    [
      line({ schedule_date: "2026-08-08" }), // scheduled, nobody counted
      line({ schedule_date: "2026-08-09", made: 18, leftover: 2, sold: 16 }),
    ],
    dates
  );
  const nothing = days[11]; // 2026-08-07 — no schedule at all
  const uncounted = days[12]; // 2026-08-08
  const done = days[13];

  no(nothing.scheduled, "no schedule that day");
  no(nothing.counted);

  ok(uncounted.scheduled, "it WAS on a schedule");
  no(uncounted.counted, "and nobody wrote down what came back");
  eq(uncounted.par, 18, "the ask is still known");
  eq(uncounted.made, null, "but the answer is null, NOT zero");

  ok(done.counted);
  eq(done.sold, 16);
});

test("two shops on one night are ONE day, and their pars SUM", () => {
  const { dates } = historyWindow("2026-08-09");
  const days = bucketByDay(
    [
      line({ schedule_date: "2026-08-09", location_id: DF01, par: 18, made: 18, leftover: 2, sold: 16 }),
      line({ schedule_date: "2026-08-09", location_id: DF02, par: 12, made: 12, leftover: 0, sold: 12 }),
    ],
    dates
  );
  // Keying on (date, location) would give 15 buckets for a 14-day window.
  eq(days.length, 14);
  const d = days[13];
  eq(d.shops, 2);
  eq(d.par, 30);
  eq(d.made, 30);
  eq(d.sold, 28);
});

test("a shop that counted and one that didn't total over the one that did", () => {
  const { dates } = historyWindow("2026-08-09");
  const d = bucketByDay(
    [
      line({ schedule_date: "2026-08-09", location_id: DF01, made: 18, leftover: 2, sold: 16 }),
      line({ schedule_date: "2026-08-09", location_id: DF02, par: 12 }),
    ],
    dates
  )[13];
  eq(d.shops, 2, "both carried it");
  eq(d.par, 30, "and both asked for some");
  eq(d.made, 18, "but only one counted");
  eq(d.sold, 16);
});

test("sold is READ, never recomputed — a negative one survives", () => {
  // More back than made: yesterday's carryover counted into today's leftovers.
  // The view computes this and the module must not clamp or re-derive it.
  const { dates } = historyWindow("2026-08-09");
  const d = bucketByDay(
    [line({ schedule_date: "2026-08-09", made: 10, leftover: 14, sold: -4 })],
    dates
  )[13];
  eq(d.sold, -4);
});

test("rows outside the window are ignored rather than folded into an edge", () => {
  const { dates } = historyWindow("2026-08-09");
  const days = bucketByDay(
    [line({ schedule_date: "2026-06-01", made: 999, sold: 999 })],
    dates
  );
  eq(days.filter((d) => d.scheduled).length, 0);
  eq(summarise(days).sold, 0);
});

/* -- the summary --------------------------------------------------------- */

test("the average divides by nights COUNTED, not by the window", () => {
  const { dates } = historyWindow("2026-08-09");
  const lines: HistoryLine[] = [];
  // Five counted nights of 20 sold, and nine nights nobody touched.
  for (let i = 0; i < 5; i++) {
    lines.push(
      line({ schedule_date: dates[9 + i], made: 24, leftover: 4, sold: 20 })
    );
  }
  const s = summarise(bucketByDay(lines, dates));
  eq(s.daysCounted, 5);
  eq(s.sold, 100);
  // Dividing by 14 gives 7.14 — plausible, and wrong by a factor of nearly three.
  eq(s.soldPerNight, 20);
});

test("a scheduled-but-uncounted night raises daysScheduled and not daysCounted", () => {
  const { dates } = historyWindow("2026-08-09");
  const s = summarise(
    bucketByDay(
      [
        line({ schedule_date: dates[12] }),
        line({ schedule_date: dates[13], made: 24, leftover: 4, sold: 20 }),
      ],
      dates
    )
  );
  eq(s.daysScheduled, 2);
  eq(s.daysCounted, 1);
  eq(s.soldPerNight, 20, "the uncounted night must not drag the average down");
});

test("nothing counted at all gives a NULL average, never zero and never NaN", () => {
  const { dates } = historyWindow("2026-08-09");
  const s = summarise(bucketByDay([line({ schedule_date: dates[13] })], dates));
  eq(s.daysCounted, 0);
  eq(s.soldPerNight, null);
  eq(s.sold, 0);
});

test("a cleared count stops being counted", () => {
  // 044's function nulls made and leftover together and clears the author with
  // them. A day in that state is one nobody counted, and must leave the divisor.
  const { dates } = historyWindow("2026-08-09");
  const s = summarise(
    bucketByDay([line({ schedule_date: dates[13], made: null, leftover: null, sold: null })], dates)
  );
  eq(s.daysCounted, 0);
  eq(s.soldPerNight, null);
});

test("historyDate names the weekday", () => {
  eq(historyDate("2026-08-10"), "Mon 8/10");
  eq(historyDate("2026-08-09"), "Sun 8/9");
});
