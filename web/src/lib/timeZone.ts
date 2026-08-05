/**
 * Wall clock ⇄ instant, for one IANA time zone. No dependency — two `Intl`
 * passes and `Date.UTC` are enough, and a date library would be a large thing
 * to add for arithmetic this small.
 *
 * WHY THIS MODULE EXISTS AT ALL
 *
 * A punch is recorded as a wall time ("10:07pm") on a date, and stored as a
 * `timestamptz` — a real instant. Converting between the two is the one place
 * daylight saving can silently change somebody's pay:
 *
 *   22:00 → 06:00 across spring-forward is SEVEN hours, not eight.
 *   22:00 → 06:00 across fall-back is NINE.
 *
 * Any arithmetic that subtracts wall-clock times pays the wrong number twice a
 * year, and always to the same people — the overnight crew, who are the only
 * ones working at 2am. Once both ends are instants, `hoursBetween` is a plain
 * subtraction and is DST-correct for free. That is the whole design: resolve
 * ONCE at the edge, then never think about zones again.
 *
 * WHAT THIS MODULE CANNOT ANSWER, AND SAYS SO
 *
 * Two local times a year are not a single instant, and no function can make
 * them one. `resolveLocal` returns which case it hit rather than guessing
 * quietly:
 *
 *   NONEXISTENT — 2:30am on spring-forward never happens; the clock jumps
 *     1:59:59 → 3:00:00. A punch claiming it is a clock that was wrong, or a
 *     hand-typed correction. Resolved forward by the size of the gap (so 2:30
 *     becomes 3:30), which is the ECMAScript/Temporal "compatible" convention.
 *
 *   AMBIGUOUS — 1:30am on fall-back happens TWICE, an hour apart, and the
 *     overnight crew clocks out in exactly that window. Both instants are real
 *     and they differ by an hour of pay. Defaults to the EARLIER (again the
 *     compatible convention), and reports the other so a caller can offer it.
 *
 * Measured in Donut Friend's own history: of the 133 rows where FileMaker's
 * stored hours disagree with clock-out minus clock-in, 37 fall on a DST
 * transition day and every one of those differs by exactly one hour. FileMaker
 * resolved fall-back to the LATER instant. We default to the earlier and flag
 * it, because a silent choice here is a silent hour of overtime.
 */

export type WallTime = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  second?: number;
};

export type Ambiguity = "none" | "ambiguous" | "nonexistent";

export type LocalResolution = {
  /** Epoch ms. Always a real instant, whatever the ambiguity. */
  instant: number;
  ambiguity: Ambiguity;
  /**
   * For `ambiguous`, the OTHER instant that wall time also names — an hour
   * away, and a different answer to "how long was this shift". Null otherwise.
   */
  alternative: number | null;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// One formatter per zone, cached: `Intl.DateTimeFormat` construction is the
// expensive part, and reassembling a fortnight of punches asks the same zone
// thousands of times.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** What a clock in `zone` reads at `instant`. */
export function zonedParts(zone: string, instant: number): WallTime {
  const parts = formatter(zone).formatToParts(new Date(instant));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // `hour12: false` makes some engines format midnight as 24 rather than 0.
  // Left unhandled this puts every midnight punch on the wrong day.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** A wall time read as though it were UTC. Not an instant — an intermediate. */
function asIfUTC(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    (a.second ?? 0) === (b.second ?? 0)
  );
}

/**
 * The zone's UTC offset in ms at `instant` (negative west of Greenwich).
 * Derived by formatting rather than tabulated, so it is right for every zone
 * and every historical rule change the platform's tzdata knows about.
 */
export function offsetAt(zone: string, instant: number): number {
  return asIfUTC(zonedParts(zone, instant)) - instant;
}

/**
 * The instant a wall time names in `zone`.
 *
 * The offsets are probed a DAY EITHER SIDE of the wall time, not at the wall
 * time itself, and that is the whole trick. The obvious two-pass version —
 * look up the offset at the guess, correct, look it up again — CONVERGES, so
 * on a fall-back night it finds one instant and confidently reports no
 * ambiguity. (It did, and two fixtures caught it.) An ambiguous wall time is
 * precisely one that BOTH the pre-transition and the post-transition offset map
 * onto validly, so you have to generate a candidate from each and check them.
 *
 * Each candidate is then verified by formatting back, which is what separates
 * the three cases: two survive (ambiguous), one survives (ordinary), none
 * survives (the wall time does not exist).
 */
export function resolveLocal(
  zone: string,
  wall: WallTime,
  prefer: "earlier" | "later" = "earlier"
): LocalResolution {
  const guess = asIfUTC(wall);

  // A day either side brackets any single transition, and the middle probe
  // costs nothing and covers a zone whose rule changed within the day.
  const offsets = [
    offsetAt(zone, guess - DAY_MS),
    offsetAt(zone, guess),
    offsetAt(zone, guess + DAY_MS),
  ];

  const candidates: number[] = [];
  for (const o of offsets) {
    const c = guess - o;
    if (!candidates.includes(c)) candidates.push(c);
  }

  const valid = candidates.filter((c) => sameWall(zonedParts(zone, c), wall));

  if (valid.length === 1) {
    return { instant: valid[0], ambiguity: "none", alternative: null };
  }

  if (valid.length > 1) {
    const earlier = Math.min(...valid);
    const later = Math.max(...valid);
    return {
      instant: prefer === "later" ? later : earlier,
      ambiguity: "ambiguous",
      alternative: prefer === "later" ? earlier : later,
    };
  }

  // Nothing round-tripped: this wall time is inside a spring-forward gap.
  // Reading it with the offset in force BEFORE the gap carries it forward past
  // the jump — 2:30am becomes 3:30am — which is the compatible convention and,
  // more importantly, never moves a punch BACKWARDS in time.
  return { instant: guess - offsets[0], ambiguity: "nonexistent", alternative: null };
}

/** Convenience: the instant for a `YYYY-MM-DD` date and an `HH:MM` wall time. */
export function instantFor(
  zone: string,
  dateISO: string,
  hour: number,
  minute: number,
  prefer: "earlier" | "later" = "earlier"
): LocalResolution {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) throw new Error(`Not an ISO date: ${dateISO}`);
  return resolveLocal(
    zone,
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour, minute },
    prefer
  );
}

/**
 * Hours between two instants. A plain subtraction, and correct across DST
 * BECAUSE both ends are instants — which is the entire reason `clock_in` and
 * `clock_out` are `timestamptz` and not a date plus two wall-clock times.
 */
export function hoursBetween(startInstant: number, endInstant: number): number {
  return (endInstant - startInstant) / HOUR_MS;
}

/** The local calendar date at an instant, as `YYYY-MM-DD`. */
export function localDateISO(zone: string, instant: number): string {
  const w = zonedParts(zone, instant);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(
    w.day
  ).padStart(2, "0")}`;
}

/** The local wall time at an instant, as `HH:MM`. */
export function localTime(zone: string, instant: number): string {
  const w = zonedParts(zone, instant);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/**
 * Is this instant exactly local midnight?
 *
 * The stitch test for a shift Homebase split at a day boundary: two segments
 * belong to one shift when the first ends at the same INSTANT the second
 * begins AND that instant is local midnight. Working in instants collapses
 * "ends at midnight and the next begins at midnight" into a single equality,
 * and it is strictly narrower than "zero gap" — so a genuine close-then-open
 * double at 3pm can never be merged.
 *
 * Note this is only needed for sources that split. Both files measured so far
 * keep a crossing shift WHOLE: FileMaker fills `ts_Date_End` (1,148 of 1,148
 * crossing rows), and the Homebase CSV has separate clock-in and clock-out date
 * columns with zero adjacent-at-midnight pairs across two shops. The stitcher
 * is a safety net, not the common path.
 */
export function isLocalMidnight(zone: string, instant: number): boolean {
  const w = zonedParts(zone, instant);
  return w.hour === 0 && w.minute === 0 && (w.second ?? 0) === 0;
}
