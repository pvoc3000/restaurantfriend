// lib/workday — where a person's California workday begins.
//
// The cases that matter are the identity (no boundary must change nothing, or
// every front-of-house shift and every existing row moves), the exact pair from
// the bug that prompted this, and the rollovers — because the day arithmetic is
// the one place a `new Date(iso)` would land a shift on the wrong date for
// anyone west of Greenwich.

import { test, eq } from "./harness";
import {
  MIN_WORKDAY_START,
  parseWorkdayStart,
  formatWorkdayStart,
  workdayFor,
  punchDateFor,
} from "../../src/lib/workday";
import { proposeOvertime } from "../../src/lib/overtime";

const TWO_PM = 14 * 60; // 840

/* -- parsing -------------------------------------------------------------- */

test("a time column reads back as HH:MM:SS and parses to minutes", () => {
  eq(parseWorkdayStart("14:00:00"), TWO_PM, "with seconds");
  eq(parseWorkdayStart("14:00"), TWO_PM, "without");
  eq(parseWorkdayStart("14:30:00"), 14 * 60 + 30, "half past");
  eq(parseWorkdayStart("23:59:00"), 23 * 60 + 59, "last minute of the day");
  eq(parseWorkdayStart("12:00:00"), MIN_WORKDAY_START, "the floor itself is allowed");
});

test("absent, malformed or out-of-range reads as midnight rather than throwing", () => {
  // This parses a value out of the database. A column that somehow held junk
  // should degrade to today's behaviour, not take a payroll screen down.
  eq(parseWorkdayStart(null), null, "null");
  eq(parseWorkdayStart(undefined), null, "undefined");
  eq(parseWorkdayStart(""), null, "empty");
  eq(parseWorkdayStart("2pm"), null, "prose");
  eq(parseWorkdayStart("14"), null, "hour alone");
  eq(parseWorkdayStart("25:00"), null, "no such hour");
  eq(parseWorkdayStart("14:70"), null, "no such minute");
});

test("a morning value is refused, not inverted", () => {
  // 061's CHECK should stop these ever being stored, but the rule "a workday is
  // named for the date it ENDS on" is total only above noon — below it the same
  // arithmetic means the opposite thing. Reading one as unset is the safe
  // degradation; silently applying it is the bug this guards.
  eq(parseWorkdayStart("03:00:00"), null, "3am");
  eq(parseWorkdayStart("00:00:00"), null, "midnight is the default, not a value");
  eq(parseWorkdayStart("11:59:00"), null, "one minute under the floor");
});

test("formatting is for a read-only cell", () => {
  eq(formatWorkdayStart("14:00:00"), "2:00 PM", "afternoon");
  eq(formatWorkdayStart("22:30:00"), "10:30 PM", "evening");
  eq(formatWorkdayStart("12:00:00"), "12:00 PM", "noon is 12, not 0");
  eq(formatWorkdayStart(null), null, "unset");
});

/* -- the identity, which is what protects everyone else -------------------- */

test("no boundary changes nothing, at any hour of the day", () => {
  for (const minutes of [0, 13, 6 * 60, 12 * 60, 18 * 60, 23 * 60 + 59]) {
    eq(workdayFor("2026-08-13", minutes, null), "2026-08-13", `minute ${minutes}`);
    eq(punchDateFor("2026-08-13", minutes, null), "2026-08-13", `inverse, minute ${minutes}`);
  }
});

/* -- the boundary --------------------------------------------------------- */

test("a punch at or after the boundary belongs to the next day's workday", () => {
  eq(workdayFor("2026-08-13", 13 * 60 + 59, TWO_PM), "2026-08-13", "13:59 stays");
  eq(workdayFor("2026-08-13", TWO_PM, TWO_PM), "2026-08-14", "14:00 exactly moves");
  eq(workdayFor("2026-08-13", 22 * 60, TWO_PM), "2026-08-14", "22:00 moves");
  eq(workdayFor("2026-08-13", 0, TWO_PM), "2026-08-13", "midnight stays");
  eq(workdayFor("2026-08-13", 3 * 60, TWO_PM), "2026-08-13", "the 3am AB stays");
});

test("Angelica Castellanos, 2026-08-13 — the pair that prompted all of this", () => {
  // 00:13 → 09:13, then 23:21 → 07:17 the same calendar date. Homebase summed
  // them to 15.91h and billed 8 regular / 4 OT / 3.91 double, with fourteen
  // hours of rest in the middle. Under a 14:00 workday they are two days.
  eq(workdayFor("2026-08-13", 13, TWO_PM), "2026-08-13", "the 00:13 shift");
  eq(workdayFor("2026-08-13", 23 * 60 + 21, TWO_PM), "2026-08-14", "the 23:21 shift");
});

test("Eddy Salazar's ordinary week does not stack either", () => {
  // 00:16 Sunday, then 22:23 Sunday — the same shape, every week.
  eq(workdayFor("2026-06-28", 16, TWO_PM), "2026-06-28", "the 00:16 shift");
  eq(workdayFor("2026-06-28", 22 * 60 + 23, TWO_PM), "2026-06-29", "the 22:23 shift");
});

test("the whole of one production night is one workday", () => {
  // The 18:00 start, the 22:00 start, the 00:15 start and the 03:00 AB all
  // belong to the night that produces Thursday's donuts. That is the sentence
  // the boundary exists to make true.
  eq(workdayFor("2026-08-12", 18 * 60, TWO_PM), "2026-08-13", "18:00 Wednesday");
  eq(workdayFor("2026-08-12", 22 * 60, TWO_PM), "2026-08-13", "22:00 Wednesday");
  eq(workdayFor("2026-08-13", 15, TWO_PM), "2026-08-13", "00:15 Thursday");
  eq(workdayFor("2026-08-13", 3 * 60, TWO_PM), "2026-08-13", "03:00 Thursday");
});

/* -- day arithmetic ------------------------------------------------------- */

test("month and year roll over", () => {
  eq(workdayFor("2026-08-31", 22 * 60, TWO_PM), "2026-09-01", "August into September");
  eq(workdayFor("2026-12-31", 22 * 60, TWO_PM), "2027-01-01", "into the new year");
  eq(workdayFor("2028-02-28", 22 * 60, TWO_PM), "2028-02-29", "into a leap day");
  eq(punchDateFor("2026-09-01", 22 * 60, TWO_PM), "2026-08-31", "and back");
  eq(punchDateFor("2027-01-01", 22 * 60, TWO_PM), "2026-12-31", "and back over the year");
});

test("the workday only ever moves FORWARD", () => {
  // This is what makes a re-import safe: a shift can never land in an older
  // pay period, so it can never be pushed into one that is already closed.
  for (const minutes of [0, 13, TWO_PM, 22 * 60, 23 * 60 + 59]) {
    const out = workdayFor("2026-08-13", minutes, TWO_PM);
    eq(out >= "2026-08-13", true, `minute ${minutes} did not move backwards`);
  }
});

test("punchDateFor is the inverse of workdayFor", () => {
  for (const minutes of [0, 13, 3 * 60, 13 * 60 + 59, TWO_PM, 22 * 60, 23 * 60 + 21]) {
    const punchDate = "2026-08-13";
    const workday = workdayFor(punchDate, minutes, TWO_PM);
    eq(punchDateFor(workday, minutes, TWO_PM), punchDate, `round trip at minute ${minutes}`);
  }
});

/* -- end to end: what the boundary actually buys -------------------------- */

test("Angelica's day, through the real overtime engine, before and after", () => {
  // The two shifts as they really were: 8.48h from 00:13, then 7.43h from
  // 23:21 with fourteen hours of rest between them.
  const shift = (id: string, punchMinutes: number, hours: number, start: number | null) => ({
    id,
    employee_id: "angelica",
    workday: workdayFor("2026-08-13", punchMinutes, start),
    // Both shifts are inside one workweek either way, so the weekly rule is
    // not what is being tested here.
    workweek_start: "2026-08-10",
    hours,
    starts_at: `2026-08-13T${String(Math.floor(punchMinutes / 60)).padStart(2, "0")}:00:00Z`,
  });

  // --- midnight (what Homebase billed, and what we recomputed identically) ---
  const before = proposeOvertime([
    shift("early", 13, 8.48, null),
    shift("late", 23 * 60 + 21, 7.43, null),
  ]);
  const beforePremium =
    (before.get("early")?.overtime ?? 0) + (before.get("early")?.double_ot ?? 0) +
    (before.get("late")?.overtime ?? 0) + (before.get("late")?.double_ot ?? 0);
  eq(Math.round(beforePremium * 100) / 100, 7.91, "premium hours on one stacked day");
  eq(before.get("late")?.regular, 0, "the late shift was entirely premium");

  // --- 14:00 (two nights, which is what they were) ---
  const after = proposeOvertime([
    shift("early", 13, 8.48, TWO_PM),
    shift("late", 23 * 60 + 21, 7.43, TWO_PM),
  ]);
  const afterPremium =
    (after.get("early")?.overtime ?? 0) + (after.get("early")?.double_ot ?? 0) +
    (after.get("late")?.overtime ?? 0) + (after.get("late")?.double_ot ?? 0);
  // Only the half-hour the early shift genuinely ran past eight survives.
  eq(Math.round(afterPremium * 100) / 100, 0.48, "premium hours once the nights are separate");
  eq(after.get("late")?.regular, 7.43, "the late shift is now all regular");
  eq(after.get("late")?.double_ot, 0, "and carries no double time at all");
});
