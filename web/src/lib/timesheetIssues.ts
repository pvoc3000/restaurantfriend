// What is wrong with a timesheet, for the Issues filter on /timesheets.
//
// Pure, so the rule is one thing both the counts and the filter read, and so
// it can be fixture-tested. The component derives the three facts it needs
// that cost a whole pay period to compute — the break finding, the tip pool —
// and passes them in.

import type { MealCode } from "./breakRules";

export type TimesheetIssue =
  | "late_meal"
  | "no_meal"
  | "no_title"
  | "tips"
  | "no_clock_out"
  | "no_payroll_id"
  | "no_shop"
  | "ambiguous_time";

/** In the order the picker offers them: Mark's four, then the rest. */
export const TIMESHEET_ISSUES: TimesheetIssue[] = [
  "late_meal",
  "no_meal",
  "no_title",
  "tips",
  "no_clock_out",
  "no_payroll_id",
  "no_shop",
  "ambiguous_time",
];

export const TIMESHEET_ISSUE_LABEL: Record<TimesheetIssue, string> = {
  late_meal: "Late meal",
  no_meal: "No meal",
  no_title: "No Payroll Title",
  tips: "Tips",
  no_clock_out: "No clock-out",
  no_payroll_id: "No payroll ID",
  no_shop: "No shop",
  ambiguous_time: "Ambiguous clock time",
};

export type IssueFacts = {
  /** The workday's meal finding, already net of any waiver on file. */
  mealCode: MealCode | null;
  /** A premium decision is already on file for that workday's meal. */
  mealDecided: boolean;
  /** The shift's own title, else the person's primary one — what the export uses. */
  title: string | null;
  kind: "shift" | "adjustment";
  clockIn: string | null;
  clockOut: string | null;
  gustoId: string | null;
  locationId: string | null;
  /** Hours this shift puts toward a tip pool. */
  workedHours: number | null;
  excludedFromTips: boolean;
  /** Whether the shop-day has a reported or corrected tip figure. */
  poolHasFigure: boolean;
  /** Cents on the shop-day that could not go to anybody. */
  poolUnallocatedCents: number;
  ambiguousTime: boolean;
};

/**
 * Every issue a row carries.
 *
 * LATE AGAINST EVERYTHING ELSE is the worksheet's split: a late meal was taken
 * at the wrong time, while a short meal and a missing second meal are meals
 * that did not happen as the law counts them — §512 wants thirty minutes — so
 * they file under No meal. The two sum to every finding.
 *
 * A TIP ISSUE is a shift that should share in a pool and cannot: its shop-day
 * has no figure, or has a figure nobody was eligible to receive. An excluded
 * shift, or one with no hours, has no tip question to be wrong about.
 */
export function timesheetIssues(f: IssueFacts): Set<TimesheetIssue> {
  const out = new Set<TimesheetIssue>();

  // A finding somebody has already decided (owed, waived, not owed) is not an
  // issue any more — only the undecided ones are work (Mark, 2026-09-15).
  if (!f.mealDecided) {
    if (f.mealCode === "late_meal") out.add("late_meal");
    else if (f.mealCode !== null) out.add("no_meal");
  }

  if ((f.title ?? "").trim() === "") out.add("no_title");

  if (f.locationId === null) {
    out.add("no_shop");
  } else if (!f.excludedFromTips && (f.workedHours ?? 0) > 0) {
    if (!f.poolHasFigure || f.poolUnallocatedCents > 0) out.add("tips");
  }

  // Only a shift can be unfinished — an adjustment has no punches by design.
  if (f.kind === "shift" && f.clockIn !== null && f.clockOut === null) out.add("no_clock_out");

  if ((f.gustoId ?? "").trim() === "") out.add("no_payroll_id");
  if (f.ambiguousTime) out.add("ambiguous_time");

  return out;
}
