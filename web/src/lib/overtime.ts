/**
 * California overtime, recomputed from the punches.
 *
 * Decision 2: overtime is imported and VERIFIED, never silently overridden.
 * This module is the "verified" half — it produces a PROPOSAL, the screen shows
 * it beside what the source said, and a human decides. Nothing here writes
 * anything, and `ot_decision` on the row records who won and why.
 *
 * ---------------------------------------------------------------------------
 * THE RULES, AND WHERE THEY COME FROM
 *
 *   Daily      hours over 8 in a workday at 1.5×; hours over 12 at 2×.
 *   Weekly     hours over 40 in a workweek at 1.5×.
 *   Seventh    working all seven days of one workweek makes the seventh day
 *              1.5× for its first 8 hours and 2× beyond that.
 *
 * DAILY AND WEEKLY DO NOT STACK, and that is the rule most likely to be lost in
 * a rewrite. Five 9-hour days is 45 hours: 5 hours of daily overtime and 40
 * regular. The weekly rule then adds NOTHING, because only 40 hours were ever
 * counted as regular. Applying both would pay 10 overtime hours for 45 worked.
 * The implementation is what enforces this — the weekly test looks at the
 * REGULAR hours left after the daily pass, never at total hours.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not decide anything. It does not read or write the database. It does
 * not know about pay periods — overtime is per WORKWEEK, which is why 028 gives
 * every row its own `workweek_start` rather than deriving one from the
 * fortnight.
 *
 * It also does not handle a seventh consecutive day that SPANS two workweeks.
 * California's rule is written per workweek ("the seventh day of work in any one
 * workweek"), so per-workweek is the correct reading, and Donut Friend's
 * workweek and pay period share a Monday anchor. Documented, not built.
 *
 * *These are our reading of the rules, not advice — worth confirming with
 * whoever handles compliance before the arithmetic is trusted with money.*
 */

const DAILY_OT_AFTER = 8;
const DAILY_DOUBLE_AFTER = 12;
const WEEKLY_OT_AFTER = 40;
const SEVENTH_DAY_DOUBLE_AFTER = 8;
const DAYS_IN_WORKWEEK = 7;

export type ShiftHours = {
  id: string;
  employee_id: string;
  workday: string;
  workweek_start: string;
  /** Worked hours — clock to clock, minus the unpaid meal. Sick hours are NOT
   *  worked hours and must not appear here: you weren't on the floor, and
   *  counting them would manufacture overtime out of paid leave. */
  hours: number;
};

export type Split = { regular: number; overtime: number; double_ot: number };

export type ShiftProposal = Split & {
  id: string;
  /** Why this shift got overtime at all — for the screen, so a proposal can be
   *  argued with rather than merely accepted. */
  reasons: OvertimeReason[];
};

export type OvertimeReason = "daily_over_8" | "daily_over_12" | "weekly_over_40" | "seventh_day";

export const REASON_LABEL: Record<OvertimeReason, string> = {
  daily_over_8: "over 8 hours in the day",
  daily_over_12: "over 12 hours in the day",
  weekly_over_40: "over 40 hours in the week",
  seventh_day: "seventh consecutive day worked",
};

/** Two decimal places, matching numeric(8,2), and never -0. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100 + 0;
}

/**
 * The split for ONE workday's total hours, before the weekly rule.
 *
 * The seventh-day variant is a different rule, not a modifier: there is no
 * regular time at all on a seventh consecutive day.
 */
function splitDay(hours: number, isSeventhDay: boolean): { split: Split; reasons: OvertimeReason[] } {
  if (hours <= 0) return { split: { regular: 0, overtime: 0, double_ot: 0 }, reasons: [] };

  if (isSeventhDay) {
    return {
      split: {
        regular: 0,
        overtime: Math.min(hours, SEVENTH_DAY_DOUBLE_AFTER),
        double_ot: Math.max(0, hours - SEVENTH_DAY_DOUBLE_AFTER),
      },
      reasons: ["seventh_day"],
    };
  }

  const reasons: OvertimeReason[] = [];
  const regular = Math.min(hours, DAILY_OT_AFTER);
  const overtime = Math.max(0, Math.min(hours, DAILY_DOUBLE_AFTER) - DAILY_OT_AFTER);
  const double_ot = Math.max(0, hours - DAILY_DOUBLE_AFTER);
  if (overtime > 0) reasons.push("daily_over_8");
  if (double_ot > 0) reasons.push("daily_over_12");
  return { split: { regular, overtime, double_ot }, reasons };
}

/**
 * Pour a day's decided split back over its individual shifts, chronologically.
 *
 * A workday can hold more than one shift (a split shift, or a double at two
 * shops), and overtime belongs to the DAY, not to either shift. Filling regular
 * first and then overtime is what a payroll system does, and it puts the
 * overtime on the shift that actually ran late.
 */
function pourOverShifts(
  shifts: ShiftHours[],
  split: Split,
  reasons: OvertimeReason[]
): ShiftProposal[] {
  let regularLeft = split.regular;
  let otLeft = split.overtime;
  let dotLeft = split.double_ot;

  return shifts.map((s) => {
    let left = s.hours;
    const regular = Math.min(left, regularLeft);
    left -= regular;
    regularLeft -= regular;
    const overtime = Math.min(left, otLeft);
    left -= overtime;
    otLeft -= overtime;
    const double_ot = Math.min(left, dotLeft);
    dotLeft -= double_ot;

    return {
      id: s.id,
      regular: round2(regular),
      overtime: round2(overtime),
      double_ot: round2(double_ot),
      // Only name a reason on a shift that actually carries the hours it
      // explains — otherwise every shift on a long day claims the overtime.
      reasons: reasons.filter(
        (r) =>
          (r === "daily_over_8" && overtime > 0) ||
          (r === "daily_over_12" && double_ot > 0) ||
          (r === "weekly_over_40" && overtime > 0) ||
          (r === "seventh_day" && (overtime > 0 || double_ot > 0))
      ),
    };
  });
}

/**
 * Recompute overtime for a set of shifts.
 *
 * Shifts may span any number of employees and workweeks; they are grouped
 * internally, so a caller can hand over a whole fortnight. Returns one proposal
 * per input shift, keyed by id.
 */
export function proposeOvertime(shifts: readonly ShiftHours[]): Map<string, ShiftProposal> {
  const out = new Map<string, ShiftProposal>();

  // employee + workweek is the unit the weekly and seventh-day rules apply to.
  const weeks = new Map<string, ShiftHours[]>();
  for (const s of shifts) {
    const key = `${s.employee_id}|${s.workweek_start}`;
    const list = weeks.get(key);
    if (list) list.push(s);
    else weeks.set(key, [s]);
  }

  for (const week of weeks.values()) {
    const days = new Map<string, ShiftHours[]>();
    for (const s of week) {
      const list = days.get(s.workday);
      if (list) list.push(s);
      else days.set(s.workday, [s]);
    }

    // Chronological, so "the seventh day" and "the hours after the 40th" both
    // mean what they say.
    const orderedDays = [...days.keys()].sort();
    // A day with no worked hours is not a day WORKED — someone who clocked in
    // and straight out again hasn't triggered the seventh-day rule.
    const workedDays = orderedDays.filter((d) =>
      (days.get(d) ?? []).reduce((n, s) => n + s.hours, 0) > 0
    );
    const seventhDay =
      workedDays.length >= DAYS_IN_WORKWEEK ? workedDays[DAYS_IN_WORKWEEK - 1] : null;

    // --- pass 1: the daily rule, per day ---
    const perDay = new Map<string, { split: Split; reasons: OvertimeReason[] }>();
    for (const day of orderedDays) {
      const total = (days.get(day) ?? []).reduce((n, s) => n + s.hours, 0);
      perDay.set(day, splitDay(total, day === seventhDay));
    }

    // --- pass 2: the weekly rule, over what is STILL regular ---
    // This is the non-stacking guarantee. Hours already promoted to overtime by
    // the daily rule are invisible here, so they cannot be promoted twice.
    let regularSoFar = 0;
    for (const day of orderedDays) {
      const entry = perDay.get(day);
      if (!entry) continue;
      const before = regularSoFar;
      regularSoFar += entry.split.regular;
      if (regularSoFar <= WEEKLY_OT_AFTER) continue;

      // The hours over 40 are the ones worked AFTER the 40th, so they come off
      // the later days — which is also where a reader expects to see them.
      const overBy = Math.min(entry.split.regular, regularSoFar - WEEKLY_OT_AFTER);
      const alreadyOver = Math.max(0, before - WEEKLY_OT_AFTER);
      const move = overBy - alreadyOver;
      if (move <= 0) continue;

      entry.split = {
        regular: entry.split.regular - move,
        overtime: entry.split.overtime + move,
        double_ot: entry.split.double_ot,
      };
      if (!entry.reasons.includes("weekly_over_40")) entry.reasons.push("weekly_over_40");
    }

    // --- pour each day's answer back over its shifts ---
    for (const day of orderedDays) {
      const entry = perDay.get(day);
      const dayShifts = (days.get(day) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!entry) continue;
      for (const p of pourOverShifts(dayShifts, entry.split, entry.reasons)) out.set(p.id, p);
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Comparing our answer with the source's                                      */
/* -------------------------------------------------------------------------- */

export type OvertimeComparison = {
  id: string;
  proposed: Split;
  source: Split;
  reasons: OvertimeReason[];
  /** True when the two splits differ by at least a cent-scale amount. */
  differs: boolean;
};

/**
 * MORE THAN ONE CENT, and the threshold is a measurement rather than a taste.
 *
 * Our hours come from instants (7.46666…h) and the source's come from its own
 * rounded decimal (7.46), so the two legitimately disagree by a cent on a shift
 * neither side has any argument about. Measured over all 44,537 real shifts:
 *
 *   at 0.005  4,388 rows flagged (9.9%)
 *   at 0.011    267 rows flagged (0.6%)   ← everything above is one-cent drift
 *   at 0.02     255 rows flagged (0.6%)
 *
 * So 4,121 of those 4,388 were rounding convention. Flagging them would put a
 * 9.9% disagreement rate in front of a human, which is the same as flagging
 * nothing — nobody audits one row in ten to find that nine are noise. At this
 * threshold the queue is 267 rows, 239 of which are a real movement between the
 * regular and overtime buckets.
 *
 * This tolerance is for the COMPARISON only. Nothing is rounded away in what is
 * stored, and adopting a proposal writes our figure, not the source's.
 */
const EPSILON = 0.015;

export function compareToSource(
  proposal: ShiftProposal,
  source: { regular: number | null; overtime: number | null; double_ot: number | null }
): OvertimeComparison {
  const src: Split = {
    regular: source.regular ?? 0,
    overtime: source.overtime ?? 0,
    double_ot: source.double_ot ?? 0,
  };
  const proposed: Split = {
    regular: proposal.regular,
    overtime: proposal.overtime,
    double_ot: proposal.double_ot,
  };
  const differs =
    Math.abs(proposed.regular - src.regular) >= EPSILON ||
    Math.abs(proposed.overtime - src.overtime) >= EPSILON ||
    Math.abs(proposed.double_ot - src.double_ot) >= EPSILON;

  return { id: proposal.id, proposed, source: src, reasons: proposal.reasons, differs };
}

/** Total hours in a split — what must not change when only the SPLIT moves. */
export function splitTotal(s: Split): number {
  return round2(s.regular + s.overtime + s.double_ot);
}
