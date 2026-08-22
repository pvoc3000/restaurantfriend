/**
 * Where a person's California workday begins.
 *
 * Daily overtime is per WORKDAY, and the default workday is midnight to
 * midnight. For the overnight kitchen crew that is the wrong 24 hours: a baker
 * who finishes at 09:13 and clocks in again at 23:21 has both shifts land on
 * one calendar date, which sums to nearly sixteen hours and manufactures four
 * hours of overtime and four of double time out of a night's rest.
 *
 * Migration 061 puts a nullable `workday_starts_at` on `employees`. Null means
 * midnight — the default, and what front of house uses. The kitchen uses 14:00.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: A WORKDAY IS NAMED FOR THE DATE IT ENDS ON.
 *
 * With a 14:00 start, the workday runs 14:00 Wednesday → 14:00 Thursday and is
 * called THURSDAY. So a punch at 22:00 Wednesday, one at 00:15 Thursday and one
 * at 03:00 Thursday are all one workday — which is exactly the night that
 * produces Thursday's donuts, and is why this is explicable to the person
 * working it rather than being an arbitrary hour.
 *
 * That rule is total only for an afternoon or evening boundary, which is what
 * 061's CHECK enforces. A morning value would compute something and mean the
 * opposite (a punch BEFORE it belonging to the previous date). Measured over
 * seven years, every morning boundary scores far worse than doing nothing, so
 * nothing is lost by refusing them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT TOUCH
 *
 * The INSTANTS. A shift's `clock_in` and `clock_out` are when it physically
 * happened and never move; only the day the hours are attributed to does. And
 * `business_date` — which day's tip pool and shift report a shift belongs to —
 * stays the calendar date of the punch. Migration 028 separated `workday` from
 * `business_date` for exactly this, and this is the first time they diverge.
 *
 * Everything here is pure: no dates parsed through `new Date(iso)`, because
 * `new Date("2026-08-13")` is UTC midnight and would land on the 12th for
 * anyone west of Greenwich. `lib/productionPlans` makes the same point.
 */

/** Mirrors 061's `check (workday_starts_at is null or … >= time '12:00')`. */
export const MIN_WORKDAY_START = 12 * 60;

/**
 * `"14:00:00"` or `"14:00"` → 840. Anything else → null, which reads as
 * midnight everywhere below.
 *
 * Tolerant rather than throwing: this parses a value out of the database, and a
 * column that somehow held junk should degrade to today's behaviour rather than
 * take a payroll screen down.
 */
export function parseWorkdayStart(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const total = hour * 60 + minute;
  // Below the CHECK's floor the rule above is not total, so treat it as unset
  // rather than silently applying the inverse meaning.
  return total < MIN_WORKDAY_START ? null : total;
}

/** `840` → `"2:00 PM"`, for a read-only cell. Null → null. */
export function formatWorkdayStart(value: string | null | undefined): string | null {
  const minutes = parseWorkdayStart(value);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** `("2026-08-31", 1)` → `"2026-09-01"`. Built from numbers in UTC, never parsed. */
function shiftDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
}

/**
 * The workday a punch belongs to.
 *
 * @param punchDateISO  the calendar date the clock-in fell on, `YYYY-MM-DD`
 * @param punchMinutes  the clock-in's local wall time, minutes since midnight
 * @param startMinutes  this person's boundary, or null for midnight
 *
 * With no boundary this is the identity, which is why every existing row and
 * every front-of-house shift is untouched.
 */
export function workdayFor(
  punchDateISO: string,
  punchMinutes: number,
  startMinutes: number | null
): string {
  if (startMinutes === null || punchMinutes < startMinutes) return punchDateISO;
  return shiftDate(punchDateISO, 1);
}

/**
 * The inverse: given a workday and a wall time, which calendar date was the
 * punch actually on?
 *
 * `NewTimesheet` needs this — it asks for a workday and two times and has to
 * build real instants from them. Under a 14:00 boundary a Thursday workday
 * holds a 22:00 punch that happened on WEDNESDAY, and assuming otherwise puts
 * the shift a day out.
 */
export function punchDateFor(
  workdayISO: string,
  punchMinutes: number,
  startMinutes: number | null
): string {
  if (startMinutes === null || punchMinutes < startMinutes) return workdayISO;
  return shiftDate(workdayISO, -1);
}
