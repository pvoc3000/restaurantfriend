// lib/timeZone — the module that decides how long an overnight shift was.
//
// The first case in this file is the one the whole payroll module exists to get
// right, and the DST pair is the one no amount of care in the UI can rescue: a
// wrong instant here is a wrong number of overtime hours on somebody's cheque,
// twice a year, always for the overnight crew.

import { test, eq, ok } from "./harness";
import {
  resolveLocal,
  instantFor,
  hoursBetween,
  localDateISO,
  localTime,
  isLocalMidnight,
  offsetAt,
  zonedParts,
} from "../../src/lib/timeZone";

const LA = "America/Los_Angeles";
/** A zone with no DST at all, to prove the arithmetic isn't DST-shaped. */
const PHX = "America/Phoenix";

const at = (dateISO: string, h: number, m: number, zone = LA) =>
  instantFor(zone, dateISO, h, m).instant;

/* -- the reason the module exists ----------------------------------------- */

test("22:00 → 06:00 is 7h across spring-forward and 9h across fall-back", () => {
  // 2026-03-08: 2am jumps to 3am, so the night is 23 hours long.
  const springIn = at("2026-03-07", 22, 0);
  const springOut = at("2026-03-08", 6, 0);
  eq(hoursBetween(springIn, springOut), 7, "spring-forward night");

  // 2026-11-01: 2am falls back to 1am, so the night is 25 hours long.
  const fallIn = at("2026-10-31", 22, 0);
  const fallOut = at("2026-11-01", 6, 0);
  eq(hoursBetween(fallIn, fallOut), 9, "fall-back night");

  // And an ordinary night is 8, so the two above are the exception and not a
  // constant offset hiding in the arithmetic.
  eq(hoursBetween(at("2026-06-01", 22, 0), at("2026-06-02", 6, 0)), 8, "ordinary night");
});

test("a wall-clock subtraction would have paid both of those wrong", () => {
  // What the naive version computes, and what makes this a pay bug rather than
  // a rounding one: it says 8 for all three nights.
  const naive = 6 + 24 - 22;
  eq(naive, 8);
  ok(hoursBetween(at("2026-03-07", 22, 0), at("2026-03-08", 6, 0)) !== naive, "spring differs");
  ok(hoursBetween(at("2026-10-31", 22, 0), at("2026-11-01", 6, 0)) !== naive, "fall differs");
});

test("a zone without DST is unaffected", () => {
  eq(hoursBetween(at("2026-03-07", 22, 0, PHX), at("2026-03-08", 6, 0, PHX)), 8);
  eq(hoursBetween(at("2026-10-31", 22, 0, PHX), at("2026-11-01", 6, 0, PHX)), 8);
});

/* -- what the module refuses to guess about -------------------------------- */

test("1:30am on fall-back is AMBIGUOUS and both instants are offered", () => {
  const r = resolveLocal(LA, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  eq(r.ambiguity, "ambiguous");
  ok(r.alternative !== null, "the other instant is named");
  // Exactly one hour apart, and that hour is somebody's overtime.
  eq(Math.abs((r.alternative as number) - r.instant) / 3_600_000, 1);
  // Default is the EARLIER (the compatible convention).
  ok(r.instant < (r.alternative as number), "defaults to the earlier");
});

test("preferring the later instant returns the other one — FileMaker's answer", () => {
  const earlier = resolveLocal(LA, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  const later = resolveLocal(LA, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "later");
  eq(later.ambiguity, "ambiguous");
  eq(later.instant, earlier.alternative);
  eq(later.alternative, earlier.instant);
  // The measured consequence on a real DF shift: 5pm → 1am on the night of
  // 2019-11-02 is 8 hours taking the earlier instant and 9 taking the later.
  // FMP stored 9. Both are defensible; neither may be chosen silently.
  const inAt = at("2019-11-02", 17, 0);
  eq(hoursBetween(inAt, resolveLocal(LA, { year: 2019, month: 11, day: 3, hour: 1, minute: 0 }).instant), 8);
  eq(
    hoursBetween(inAt, resolveLocal(LA, { year: 2019, month: 11, day: 3, hour: 1, minute: 0 }, "later").instant),
    9
  );
});

test("2:30am on spring-forward does NOT exist, and resolves FORWARD", () => {
  const r = resolveLocal(LA, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  eq(r.ambiguity, "nonexistent");
  eq(r.alternative, null);
  // 3:30am, not 1:30am — a punch must never be moved backwards in time.
  eq(localTime(LA, r.instant), "03:30");
  eq(localDateISO(LA, r.instant), "2026-03-08");
});

test("an ordinary time is unambiguous", () => {
  const r = resolveLocal(LA, { year: 2026, month: 6, day: 15, hour: 14, minute: 5 });
  eq(r.ambiguity, "none");
  eq(r.alternative, null);
  eq(localTime(LA, r.instant), "14:05");
});

/* -- round trips ----------------------------------------------------------- */

test("every hour of both transition days round-trips or is named", () => {
  for (const day of ["2026-03-08", "2026-11-01"]) {
    for (let h = 0; h < 24; h++) {
      const r = instantFor(LA, day, h, 0);
      if (r.ambiguity === "none") {
        eq(localTime(LA, r.instant), `${String(h).padStart(2, "0")}:00`, `${day} ${h}:00`);
        eq(localDateISO(LA, r.instant), day, `${day} ${h}:00 date`);
      } else {
        // The only unrepresentable hours are the two the transitions create.
        ok(
          (day === "2026-03-08" && h === 2 && r.ambiguity === "nonexistent") ||
            (day === "2026-11-01" && h === 1 && r.ambiguity === "ambiguous"),
          `${day} ${h}:00 was ${r.ambiguity}`
        );
      }
    }
  }
});

test("midnight round-trips rather than landing on the previous day", () => {
  // `hour12: false` makes some engines format midnight as 24. Unhandled, that
  // puts every midnight punch a day early — and the overnight crew starts at
  // midnight, so it would be systematic rather than rare.
  const r = instantFor(LA, "2026-08-03", 0, 0);
  eq(r.ambiguity, "none");
  eq(localDateISO(LA, r.instant), "2026-08-03");
  eq(localTime(LA, r.instant), "00:00");
  eq(zonedParts(LA, r.instant).hour, 0);
  ok(isLocalMidnight(LA, r.instant), "and is recognised as local midnight");
});

test("offsetAt tracks the real rule change, not a constant", () => {
  eq(offsetAt(LA, at("2026-01-15", 12, 0)) / 3_600_000, -8, "PST");
  eq(offsetAt(LA, at("2026-07-15", 12, 0)) / 3_600_000, -7, "PDT");
  eq(offsetAt(PHX, at("2026-07-15", 12, 0)) / 3_600_000, -7, "Phoenix never shifts");
  eq(offsetAt(PHX, at("2026-01-15", 12, 0)) / 3_600_000, -7, "Phoenix in winter");
});

/* -- the stitch test ------------------------------------------------------- */

test("isLocalMidnight is true only at midnight, and is zone-relative", () => {
  ok(isLocalMidnight(LA, at("2026-08-03", 0, 0)), "midnight");
  ok(!isLocalMidnight(LA, at("2026-08-03", 0, 1)), "one minute past");
  ok(!isLocalMidnight(LA, at("2026-08-03", 23, 0)), "11pm");
  // The same instant is NOT midnight in a different zone, which is why the
  // stitch has to name the shop's zone rather than trusting the server's.
  ok(!isLocalMidnight("America/New_York", at("2026-08-03", 0, 0)), "not midnight in NY");
});

test("a zero-gap pair at 11pm is NOT a midnight split", () => {
  // The case the narrow stitch protects: a genuine close-then-open double where
  // one segment ends exactly as the next begins. Same instant, but not
  // midnight, so it must stay two shifts.
  const boundary = at("2026-08-03", 23, 0);
  ok(!isLocalMidnight(LA, boundary), "the shared instant is not midnight");
});
