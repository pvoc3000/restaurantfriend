/**
 * California meal-break rules, assessed over one employee's WORKDAY.
 *
 * Decision 3: a violation is DERIVED and never stored — FileMaker's own
 * `cTimeSheetError` was an unstored calculation and was right to be, because a
 * flag about a punch goes stale the moment the punch is corrected. What gets
 * stored is the premium DECISION, in 029's `break_premiums`.
 *
 * ---------------------------------------------------------------------------
 * THE FUNCTION'S SHAPE IS THE CALIFORNIA CAP
 *
 * `assessWorkday` takes ALL of one employee's shifts on one workday and returns
 * AT MOST ONE meal finding. That is not a convenience — it is the rule. The law
 * caps the premium at one per employee per day however many shifts they worked,
 * so a per-shift function would let two shifts each produce one and pay twice.
 * 029's `unique (org_id, employee_id, workday, kind)` is the same rule again at
 * the other end.
 *
 * ---------------------------------------------------------------------------
 * REST BREAKS ARE NOT ASSESSED HERE, DELIBERATELY
 *
 * A rest break is PAID, so it produces no punch. There is nothing to derive
 * from but shift length, which would flag nearly every shift and teach everyone
 * to ignore the flag. Rest premiums are entered by hand and labelled as such —
 * the screen must not imply it checked something it cannot see.
 *
 * ---------------------------------------------------------------------------
 * *This is our reading of the rules, not advice. `cTimeSheetError` is populated
 * on 10,143 rows of the real history, which makes it a reference to diff
 * against — see `scripts/fixtures` and the audit in the phase-5 commit.*
 */

const MEAL_REQUIRED_AFTER_HOURS = 5;
const MEAL_WAIVABLE_UP_TO_HOURS = 6;
const SECOND_MEAL_REQUIRED_AFTER_HOURS = 10;
const SECOND_MEAL_WAIVABLE_UP_TO_HOURS = 12;
const MEAL_MINUTES = 30;
/**
 * The meal must BEGIN within five hours of clocking in.
 *
 * NOT SIX, and the number is worth defending because the usual phrasing invites
 * exactly one misreading. *Brinker v. Superior Court* (2012) puts the first meal
 * period "no later than the end of the employee's fifth hour of work", and the
 * fifth hour of work RUNS FROM the four-hour mark TO the five-hour mark — so it
 * ends at 5h00 elapsed, not 6h00. Read as ordinary English, "before the end of
 * the fifth hour" sounds like it means 6h00, which is how the old wording of
 * this rule was read (Mark, 2026-08-05, on breaks starting 5h32m in: "these
 * breaks are being improperly flagged as a violation when they are not").
 *
 * FileMaker settles it empirically, and it is the better evidence than any
 * phrasing: measured over 28,385 real shifts carrying both a clock-in and a
 * meal punch, `cTimeSheetError` says "Late Break" on 0 of the 18,314 breaks
 * beginning before 5h00, and on 93–95% of those beginning after it — including
 * 3,135 of 3,371 in the 5h00–5h30 band and 3,380 of 3,564 in 5h30–6h00. The
 * threshold that system has enforced for thirteen years is exactly 5h00.
 *
 * So the rule was right and its SENTENCE was wrong. Every message below now
 * says "within 5 hours" and never "the fifth hour".
 */
const MEAL_MUST_START_WITHIN_MINUTES = 5 * 60;

export type BreakShift = {
  id: string;
  /** Worked hours for this shift — clock to clock, minus the unpaid meal. */
  hours: number;
  /**
   * Minutes from clock-in to the start of the recorded meal, or null when no
   * meal was recorded. Normalised by the caller, so this module stays pure over
   * plain numbers and never has to know how a given source spells a time.
   */
  mealStartAfterMinutes: number | null;
  /** Length of the recorded unpaid meal in minutes, or null. */
  mealMinutes: number | null;
};

export type MealCode = "no_meal" | "short_meal" | "late_meal" | "no_second_meal";

export type BreakFinding = {
  kind: "meal";
  code: MealCode;
  /** A sentence for the screen — the finding has to argue its own case. */
  detail: string;
  /**
   * True when a signed meal-break waiver would cover this. The waiver only
   * reaches a SHORT day: you may waive the meal on a day of six hours or less,
   * and the second meal on a day of twelve or less.
   */
  waivable: boolean;
};

export const MEAL_CODE_LABEL: Record<MealCode, string> = {
  no_meal: "No meal break recorded",
  short_meal: "Meal break under 30 minutes",
  late_meal: "Meal break started more than 5 hours in",
  no_second_meal: "No second meal break on a day over 10 hours",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Assess one employee's workday.
 *
 * `hasMealWaiver` is whether a signed waiver is on file — `employee_documents`
 * holds 51 of them across 445 people, which is a nice payoff from a module
 * already built. It changes the ANSWER, not merely the presentation: a waived
 * meal on a six-hour day owes nothing at all.
 */
export function assessWorkday(
  shifts: readonly BreakShift[],
  opts: { hasMealWaiver: boolean } = { hasMealWaiver: false }
): BreakFinding[] {
  const totalHours = round2(shifts.reduce((n, s) => n + s.hours, 0));
  if (totalHours <= MEAL_REQUIRED_AFTER_HOURS) return [];

  // The day's meal is whatever meal was recorded on it. Taking the LONGEST
  // rather than the first is deliberate: someone who took ten minutes at 11am
  // and a proper half hour at 1pm had their meal, and picking the first would
  // report a short-meal violation that didn't happen.
  const withMeal = shifts.filter((s) => (s.mealMinutes ?? 0) > 0);
  const meal = withMeal.reduce<BreakShift | null>(
    (best, s) => (best === null || (s.mealMinutes ?? 0) > (best.mealMinutes ?? 0) ? s : best),
    null
  );

  const findings: BreakFinding[] = [];

  if (meal === null) {
    findings.push({
      kind: "meal",
      code: "no_meal",
      detail: `${totalHours.toFixed(2)} hours worked with no meal break recorded.`,
      waivable: totalHours <= MEAL_WAIVABLE_UP_TO_HOURS,
    });
  } else if ((meal.mealMinutes ?? 0) < MEAL_MINUTES) {
    findings.push({
      kind: "meal",
      code: "short_meal",
      detail: `Meal break was ${meal.mealMinutes} minutes; ${MEAL_MINUTES} are required.`,
      // A short meal is not the same as no meal: the waiver waives TAKING one,
      // not taking a truncated one.
      waivable: false,
    });
  } else if (
    meal.mealStartAfterMinutes !== null &&
    meal.mealStartAfterMinutes > MEAL_MUST_START_WITHIN_MINUTES
  ) {
    const h = Math.floor(meal.mealStartAfterMinutes / 60);
    const m = meal.mealStartAfterMinutes % 60;
    findings.push({
      kind: "meal",
      code: "late_meal",
      detail: `Meal break began ${h}h ${m}m into the shift; California requires it to start within 5 hours of clocking in.`,
      waivable: false,
    });
  } else if (totalHours > SECOND_MEAL_REQUIRED_AFTER_HOURS && withMeal.length < 2) {
    // Only reachable when the FIRST meal was fine, which is why it is the last
    // branch: one premium per day, so a day that already owes one for a missed
    // first meal does not also owe one for the second.
    findings.push({
      kind: "meal",
      code: "no_second_meal",
      detail: `${totalHours.toFixed(2)} hours worked with only one meal break recorded.`,
      waivable: totalHours <= SECOND_MEAL_WAIVABLE_UP_TO_HOURS,
    });
  }

  // The waiver removes the finding entirely rather than marking it — a waived
  // meal on a short day is not a violation anybody needs to see. What the
  // SCREEN needs is elsewhere: `break_premiums.decision = 'waived'` is how a
  // human records that they considered it.
  return findings.filter((f) => !(f.waivable && opts.hasMealWaiver));
}

/**
 * Does this workday owe a meal premium?
 *
 * A convenience over `assessWorkday` for the screen's count, and the place the
 * one-per-day cap reads most plainly: a day owes at most one.
 */
export function owesMealPremium(
  shifts: readonly BreakShift[],
  opts: { hasMealWaiver: boolean } = { hasMealWaiver: false }
): boolean {
  return assessWorkday(shifts, opts).length > 0;
}
