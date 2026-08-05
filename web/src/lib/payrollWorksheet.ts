/**
 * The payroll worksheet — one fortnight, assembled.
 *
 * Pure: plain rows in, plain rows out. It joins what 028, 029 and the four rule
 * modules each know about a pay period into the three things a human needs to
 * look at before payroll runs:
 *
 *   1. per-employee hours, so the totals can be eyeballed
 *   2. the meal-break findings that have no decision recorded yet
 *   3. each shop-day's tip pool, its rate, and its residual
 *
 * Nothing here writes, and nothing here decides. `assessWorkday` proposes a
 * finding; a human records a `break_premiums` row. `allocateTips` proposes a
 * division; `freeze_pay_period` commits it.
 */

import { assessWorkday, type BreakFinding, type BreakShift } from "./breakRules";
import { allocateTips, type PoolResult, type TipShift } from "./tipPool";
import { workedHours } from "./timesheets";

export type WorksheetShift = {
  id: string;
  employee_id: string;
  location_id: string | null;
  workday: string;
  business_date: string;
  clock_in: string | null;
  clock_out: string | null;
  unpaid_break_minutes: number | null;
  hours_regular: number | null;
  hours_overtime: number | null;
  hours_double_ot: number | null;
  sick_hours: number | null;
  exclude_tips: boolean | null;
  /** Raw source row, for the recorded meal punches. */
  source_payload: Record<string, unknown> | null;
};

export type WorksheetEmployee = {
  employee_id: string;
  name: string;
  excludes_tips: boolean;
  regular: number;
  overtime: number;
  double_ot: number;
  sick: number;
  worked: number;
  shifts: number;
  /** Days with a meal finding and no decision on file yet. */
  openFindings: number;
  premiumHours: number;
};

export type WorkdayFinding = {
  employee_id: string;
  employeeName: string;
  workday: string;
  location_id: string | null;
  finding: BreakFinding;
  /** True when a `break_premiums` row already exists for this day and kind. */
  decided: boolean;
  decision: string | null;
};

export type DayPool = {
  location_id: string;
  locationCode: string;
  business_date: string;
  poolId: string | null;
  reportedCents: number | null;
  correctedCents: number | null;
  /** The figure actually divided: corrected if there is one, else reported. */
  effectiveCents: number | null;
  result: PoolResult | null;
  people: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** `10:07pm` → minutes since midnight, across the three formats in the data. */
function wallMinutes(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim();
  let m = /^(\d{1,2}):(\d{2})\s?(am|pm)$/i.exec(t);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/**
 * The first of these keys that holds a readable wall time.
 *
 * TWO SOURCES SPELL THE SAME PUNCH DIFFERENTLY, and reading only one spelling
 * is a bug that hides itself. `transform-timesheets.mjs` writes FileMaker's
 * punches as `break_start` / `break_end` / `time_in`; the Homebase importer
 * spreads its own row shape, which spells them `breakStart` / `breakEnd` /
 * `clockInTime`. Until 2026-08-05 this function read the snake_case names only,
 * so on every IMPORTED shift the meal punches read as null and it fell through
 * to `unpaid_break_minutes` — which meant `late_meal` could never fire on
 * Homebase data at all, and a missed meal was detected only by the absence of a
 * deduction (Mark, 2026-08-05: "missed break not flagged by app… what about
 * late breaks?").
 *
 * The importer now writes the canonical snake_case names as well, so new
 * imports need none of this. Reading both is what makes the fortnight ALREADY
 * imported work without a backfill or a re-import.
 */
function firstWallMinutes(p: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const m = wallMinutes(p[k]);
    if (m !== null) return m;
  }
  return null;
}

/** The five fields a break assessment actually reads. A narrow parameter so the
 *  timesheet list can pass its own row type — which carries a location CODE
 *  rather than an id — without either screen inventing a conversion. */
export type BreakShiftFacts = Pick<
  WorksheetShift,
  "id" | "clock_in" | "clock_out" | "unpaid_break_minutes" | "source_payload"
>;

/**
 * The recorded meal, normalised out of whatever the source stored.
 *
 * FileMaker keeps break punches as wall-clock strings in `source_payload`;
 * `unpaid_break_minutes` is the fallback when there is a deduction but no
 * punches. Doing this here keeps `breakRules` pure over plain numbers rather
 * than teaching it every source's spelling.
 */
export function toBreakShift(s: BreakShiftFacts): BreakShift {
  const p = s.source_payload ?? {};
  const start = firstWallMinutes(p, ["break_start", "breakStart"]);
  const end = firstWallMinutes(p, ["break_end", "breakEnd"]);
  const clockIn = firstWallMinutes(p, ["time_in", "clockInTime"]);

  let mealMinutes: number | null = null;
  let mealStartAfterMinutes: number | null = null;

  if (start !== null && end !== null) {
    let d = end - start;
    if (d < 0) d += 1440; // a meal taken across midnight
    mealMinutes = d;
    if (clockIn !== null) {
      let a = start - clockIn;
      if (a < 0) a += 1440;
      mealStartAfterMinutes = a;
    }
  } else if (s.unpaid_break_minutes) {
    // A deduction with no punches says a meal was taken but not WHEN, so the
    // late test cannot run on it. Null rather than 0: 0 would assert the meal
    // began the moment they clocked in.
    mealMinutes = s.unpaid_break_minutes;
  }

  return {
    id: s.id,
    hours: workedHours(s) ?? 0,
    mealMinutes,
    mealStartAfterMinutes,
  };
}

export function buildEmployeeRollup(
  shifts: readonly WorksheetShift[],
  employees: ReadonlyMap<string, { name: string; excludes_tips: boolean }>,
  findings: readonly WorkdayFinding[],
  premiumHoursByEmployee: ReadonlyMap<string, number>
): WorksheetEmployee[] {
  const byEmployee = new Map<string, WorksheetEmployee>();

  for (const s of shifts) {
    const emp = employees.get(s.employee_id);
    let row = byEmployee.get(s.employee_id);
    if (!row) {
      row = {
        employee_id: s.employee_id,
        name: emp?.name ?? "(unknown)",
        excludes_tips: emp?.excludes_tips ?? false,
        regular: 0, overtime: 0, double_ot: 0, sick: 0, worked: 0,
        shifts: 0, openFindings: 0, premiumHours: 0,
      };
      byEmployee.set(s.employee_id, row);
    }
    row.regular += s.hours_regular ?? 0;
    row.overtime += s.hours_overtime ?? 0;
    row.double_ot += s.hours_double_ot ?? 0;
    row.sick += s.sick_hours ?? 0;
    row.worked += workedHours(s) ?? 0;
    row.shifts += 1;
  }

  for (const f of findings) {
    if (f.decided) continue;
    const row = byEmployee.get(f.employee_id);
    if (row) row.openFindings += 1;
  }

  for (const row of byEmployee.values()) {
    row.regular = round2(row.regular);
    row.overtime = round2(row.overtime);
    row.double_ot = round2(row.double_ot);
    row.sick = round2(row.sick);
    row.worked = round2(row.worked);
    row.premiumHours = round2(premiumHoursByEmployee.get(row.employee_id) ?? 0);
  }

  return [...byEmployee.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Every meal finding in the period, with whether a decision is already on file.
 *
 * Grouped by (employee, workday) because that is the grain the rule works at
 * and the grain 029's unique index enforces.
 */
export function buildFindings(
  shifts: readonly WorksheetShift[],
  employees: ReadonlyMap<string, { name: string; excludes_tips: boolean }>,
  waiverEmployeeIds: ReadonlySet<string>,
  existing: ReadonlyMap<string, { decision: string }>
): WorkdayFinding[] {
  const days = new Map<string, WorksheetShift[]>();
  for (const s of shifts) {
    const key = `${s.employee_id}|${s.workday}`;
    const list = days.get(key);
    if (list) list.push(s);
    else days.set(key, [s]);
  }

  const out: WorkdayFinding[] = [];
  for (const [key, dayShifts] of days) {
    const [employee_id, workday] = key.split("|");
    const found = assessWorkday(dayShifts.map(toBreakShift), {
      hasMealWaiver: waiverEmployeeIds.has(employee_id),
    });
    for (const finding of found) {
      const decided = existing.get(`${employee_id}|${workday}|${finding.kind}`);
      out.push({
        employee_id,
        employeeName: employees.get(employee_id)?.name ?? "(unknown)",
        workday,
        location_id: dayShifts[0]?.location_id ?? null,
        finding,
        decided: decided !== undefined,
        decision: decided?.decision ?? null,
      });
    }
  }

  return out.sort((a, b) =>
    a.workday !== b.workday
      ? a.workday < b.workday ? -1 : 1
      : a.employeeName < b.employeeName ? -1 : 1
  );
}

/**
 * Each shop-day's pool, divided.
 *
 * The figure divided is the CORRECTED one where a correction exists, else the
 * reported one — which is decision 5's "store both, never one" made operable.
 * A day with no figure at all still appears, with a null result, because the
 * missing number is the thing someone has to go and find.
 */
export function buildPools(
  shifts: readonly WorksheetShift[],
  employees: ReadonlyMap<string, { name: string; excludes_tips: boolean }>,
  locationCodes: ReadonlyMap<string, string>,
  pools: ReadonlyMap<string, { id: string; reported_cents: number | null; corrected_cents: number | null }>
): DayPool[] {
  const days = new Map<string, WorksheetShift[]>();
  for (const s of shifts) {
    if (!s.location_id) continue;
    const key = `${s.location_id}|${s.business_date}`;
    const list = days.get(key);
    if (list) list.push(s);
    else days.set(key, [s]);
  }

  const out: DayPool[] = [];
  for (const [key, dayShifts] of days) {
    const [location_id, business_date] = key.split("|");
    const pool = pools.get(key);
    const effective = pool ? (pool.corrected_cents ?? pool.reported_cents) : null;

    const tipShifts: TipShift[] = dayShifts.map((s) => ({
      id: s.id,
      // Tip hours are hours WORKED. Sick hours are excluded by construction:
      // they are a separate column and never enter this sum.
      hours: workedHours(s) ?? 0,
      excludeShift: s.exclude_tips,
      excludePerson: employees.get(s.employee_id)?.excludes_tips ?? false,
    }));

    out.push({
      location_id,
      locationCode: locationCodes.get(location_id) ?? "—",
      business_date,
      poolId: pool?.id ?? null,
      reportedCents: pool?.reported_cents ?? null,
      correctedCents: pool?.corrected_cents ?? null,
      effectiveCents: effective,
      result: effective === null ? null : allocateTips(effective, tipShifts),
      people: new Set(dayShifts.map((s) => s.employee_id)).size,
    });
  }

  return out.sort((a, b) =>
    a.business_date !== b.business_date
      ? a.business_date < b.business_date ? -1 : 1
      : a.locationCode < b.locationCode ? -1 : 1
  );
}
