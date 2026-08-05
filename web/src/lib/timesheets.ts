/**
 * Timesheets — the pure half. Migration 028's table.
 *
 * No Supabase client and no React, so `npm run fixtures` can pin the parts that
 * decide what someone is paid.
 */

import { hoursBetween } from "./timeZone";

export type OtDecision = "source" | "recomputed" | "manual";
export type TimesheetKind = "shift" | "adjustment";

export type Timesheet = {
  id: string;
  employee_id: string;
  location_id: string | null;
  pay_period_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  workday: string;
  business_date: string;
  workweek_start: string;
  source_hours_regular: number | null;
  source_hours_overtime: number | null;
  source_hours_double_ot: number | null;
  source_hours_paid: number | null;
  source_break_minutes: number | null;
  hours_regular: number | null;
  hours_overtime: number | null;
  hours_double_ot: number | null;
  ot_decision: OtDecision;
  ot_reason: string | null;
  unpaid_break_minutes: number | null;
  sick_hours: number | null;
  exclude_tips: boolean | null;
  tip_hours: number | null;
  tip_allocation: number | null;
  source: string;
  source_row_key: string | null;
  source_payload: Record<string, unknown> | null;
  stitched: boolean;
  kind: TimesheetKind;
  employee_note: string | null;
  manager_note: string | null;
  scheduled_hours: number | null;
  position: string | null;
};

export const OT_DECISION_LABEL: Record<OtDecision, string> = {
  source: "As imported",
  recomputed: "Recomputed",
  manual: "Set by hand",
};

/**
 * Clock-to-clock, minus the unpaid meal. Both ends are INSTANTS, so this is
 * DST-correct for free — 22:00 → 06:00 is 7 hours across spring-forward and 9
 * across fall-back, and neither needs a special case here. See `lib/timeZone`.
 *
 * Null when the shift is unfinished, which is a real state (184 rows in the
 * FileMaker history have no clock-out) and not an error to paper over with 0.
 */
export function workedHours(t: Pick<Timesheet, "clock_in" | "clock_out" | "unpaid_break_minutes">): number | null {
  if (!t.clock_in || !t.clock_out) return null;
  const span = hoursBetween(new Date(t.clock_in).getTime(), new Date(t.clock_out).getTime());
  return span - (t.unpaid_break_minutes ?? 0) / 60;
}

/** The six hours fields, which is all the comparisons below actually read. A
 *  narrow parameter so a screen's own row type can be passed without carrying
 *  columns it has no reason to select. */
export type HoursFacts = Pick<
  Timesheet,
  | "source_hours_regular"
  | "source_hours_overtime"
  | "source_hours_double_ot"
  | "hours_regular"
  | "hours_overtime"
  | "hours_double_ot"
>;

/** Total hours we are standing behind, whatever their split. */
export function decidedHours(t: HoursFacts): number {
  return (t.hours_regular ?? 0) + (t.hours_overtime ?? 0) + (t.hours_double_ot ?? 0);
}

/** Total hours the SOURCE claimed. */
export function sourceHours(t: HoursFacts): number {
  return (t.source_hours_regular ?? 0) + (t.source_hours_overtime ?? 0) + (t.source_hours_double_ot ?? 0);
}

export type Disagreement = {
  field: "regular" | "overtime" | "double_ot";
  label: string;
  source: number;
  decided: number;
};

/**
 * Where our decision differs from what the source said — decision 2's whole
 * point. Storing one number would make this unrepresentable, and this
 * disagreement is what the module adds over exporting Homebase straight to
 * Gusto.
 *
 * A null on either side is treated as 0 for the COMPARISON only: a source that
 * sent no overtime figure and a source that sent 0.00 are making the same claim
 * about overtime. Nulls are preserved in the columns themselves.
 */
export function otDisagreements(t: HoursFacts): Disagreement[] {
  const pairs: [Disagreement["field"], string, number | null, number | null][] = [
    ["regular", "Regular", t.source_hours_regular, t.hours_regular],
    ["overtime", "Overtime", t.source_hours_overtime, t.hours_overtime],
    ["double_ot", "Double time", t.source_hours_double_ot, t.hours_double_ot],
  ];
  const out: Disagreement[] = [];
  for (const [field, label, source, decided] of pairs) {
    const s = source ?? 0;
    const d = decided ?? 0;
    // A cent-scale epsilon: these are numeric(8,2), so anything at or above
    // 0.005 is a real difference and not float noise.
    if (Math.abs(s - d) >= 0.005) out.push({ field, label, source: s, decided: d });
  }
  return out;
}

/**
 * Decision 4's tri-state, resolved.
 *
 * `shiftFlag` is `exclude_tips` on the timesheet: null inherit, true excluded
 * for this shift, false INCLUDED despite the person-level default. That third
 * state is the reason the column is nullable rather than a boolean — without it
 * you re-tick the same people every fortnight and still have no way to say "the
 * manager actually worked the floor on Saturday".
 */
export function effectiveExclusion(shiftFlag: boolean | null, personDefault: boolean): boolean {
  return shiftFlag ?? personDefault;
}

/** `1:23` from 1.383 hours — how long a shift reads, not a decimal. */
export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  const sign = hours < 0 ? "-" : "";
  const total = Math.round(Math.abs(hours) * 60);
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The decimal form payroll files use. Two places, matching numeric(8,2). */
export function formatDecimalHours(hours: number | null): string {
  return hours === null || !Number.isFinite(hours) ? "—" : hours.toFixed(2);
}
