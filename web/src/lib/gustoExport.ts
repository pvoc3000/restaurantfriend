/**
 * The payroll export.
 *
 * A DESCRIBED format, not "the Gusto exporter" (design rule 2, and the brief's
 * own instruction): the columns and their mapping live in
 * `orgs.settings.payroll_export`, so running payroll somewhere else later is one
 * more target rather than a rewrite. FileMaker hardcoded `gGustoXMLHeader` as a
 * global and still carries a previous provider's earning codes fossilised in
 * its schema — `cE02Cost`, `cE07Bonus`.
 *
 * ---------------------------------------------------------------------------
 * THE FILE'S SHAPE, measured over Mark's real template (24 people, 34 rows)
 *
 * ONE ROW PER (EMPLOYEE, JOB TITLE), and hours genuinely split across them — 7
 * of the 34 rows are non-primary and carry hours.
 *
 * THE PRIMARY JOB IS IDENTIFIED BY SUFFIXING ITS TITLE `(Primary)`. It is not a
 * separate column. Every one of the 24 people has exactly one such row.
 *
 * EVERY NON-HOURS EARNING RIDES THE PRIMARY ROW AND ONLY THAT ROW — tips,
 * premium, commuter benefit, bonus, reimbursement. Zero exceptions in the real
 * file. A person who worked NONE of their primary job that fortnight still gets
 * a primary row, with zero hours, to carry them: Leo Almonte Mejia's own row in
 * the template reads `Sr. Donut Friend (Primary), 0.0 hours, 204.5 tips`.
 *
 * ---------------------------------------------------------------------------
 * SICK HOURS ARE DELIBERATELY OMITTED FROM THIS FILE
 *
 * Decision 7. Employees request sick time through Gusto and it is ALREADY on
 * the payroll; this module records it only so Mark's records and Gusto's can be
 * checked against each other. Including it here pays the person twice.
 *
 * This is the single most dangerous-looking line in the module — it reads
 * exactly like an oversight — so it is stated here, again at the column list,
 * and pinned by a fixture that asserts against the produced CSV HEADER STRING
 * rather than an object shape. An object assertion lets a rename pass while the
 * column quietly comes back.
 *
 * ---------------------------------------------------------------------------
 * PREMIUMS EXPORT AS HOURS
 *
 * Mark's decision, 2026-08-04, on the recommendation. Gusto has a native
 * `missed_break_hours` column, so decision 1 holds whole: no wage rate is ever
 * stored here and no dollar figure is ever computed. Gusto knows every rate
 * and does the multiplication.
 *
 * The *Ferra v. Loews* concern that made the brief hesitate — a premium is owed
 * at the REGULAR rate of compensation, which folds in nondiscretionary bonuses
 * — turns out to be largely theoretical here: 60 of the 62 premiums FileMaker
 * ever recorded equal that row's base rate exactly, no row carries an
 * `hourlyBonusRate`, and none of the 20 rate cards in use mentions a bonus. If
 * that ever changes, the fallback is `custom_earning_premium` in dollars, and
 * because this is a described format that switch is configuration.
 */

export type ExportShift = {
  employee_id: string;
  /** The bare job title this shift was worked as. 031's column. */
  wage_type: string | null;
  hours_regular: number | null;
  hours_overtime: number | null;
  hours_double_ot: number | null;
  sick_hours: number | null;
  /** Frozen or proposed — the caller decides which it is passing. */
  tip_allocation: number | null;
};

export type ExportEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  /** The bare job title. 031's column; the suffix is added here, never stored. */
  primary_wage_type: string | null;
  gusto_id: string | null;
};

/** Premium HOURS per employee, from `break_premiums` where decision = 'owed'. */
export type PremiumHours = ReadonlyMap<string, number>;

export type ExportRow = {
  last_name: string;
  first_name: string;
  title: string;
  gusto_employee_id: string;
  regular_hours: number;
  overtime_hours: number;
  double_overtime_hours: number;
  missed_break_hours: number;
  paycheck_tips: number | null;
  /** Only ever true on one row per person. */
  isPrimary: boolean;
  employee_id: string;
};

/**
 * The columns, in order, exactly as the real template has them.
 *
 * NOTE WHAT IS NOT HERE: there is no sick-hours column, and that is decision 7,
 * not an omission. Gusto already pays sick time requested through Gusto.
 */
export const GUSTO_COLUMNS = [
  "last_name",
  "first_name",
  "title",
  "gusto_employee_id",
  "regular_hours",
  "overtime_hours",
  "double_overtime_hours",
  "missed_break_hours",
  "bonus",
  "commission",
  "paycheck_tips",
  "cash_tips",
  "correction_payment",
  "custom_earning_commuter_benefit",
  "custom_earning_distributed_service_charges",
  "custom_earning_premium",
  "reimbursement",
  "personal_note",
] as const;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Build the rows.
 *
 * The primary row is CREATED if the person didn't work their primary job, so
 * the earnings always have somewhere to go — which is what makes "exactly one
 * primary row per person" true of the output rather than merely hoped for.
 */
export function buildExportRows(
  shifts: readonly ExportShift[],
  employees: readonly ExportEmployee[],
  premiums: PremiumHours
): ExportRow[] {
  const byId = new Map(employees.map((e) => [e.id, e]));

  // (employee, title) → hours
  const cells = new Map<
    string,
    { employee_id: string; title: string; regular: number; overtime: number; double_ot: number }
  >();
  const tips = new Map<string, number>();

  for (const s of shifts) {
    const emp = byId.get(s.employee_id);
    if (!emp) continue;
    // A shift with no wage type still has to be paid. Falling back to the
    // person's primary puts its hours on a row that exists rather than
    // inventing a job called "(none)" that Gusto has never heard of.
    const title = s.wage_type ?? emp.primary_wage_type ?? "";
    const key = `${s.employee_id}|${title}`;
    const cell = cells.get(key) ?? {
      employee_id: s.employee_id,
      title,
      regular: 0,
      overtime: 0,
      double_ot: 0,
    };
    cell.regular += s.hours_regular ?? 0;
    cell.overtime += s.hours_overtime ?? 0;
    cell.double_ot += s.hours_double_ot ?? 0;
    cells.set(key, cell);

    // Tips are a PERSON's, not a job's — they are pooled per shop-day across
    // whatever the person was doing.
    if (s.tip_allocation) {
      tips.set(s.employee_id, (tips.get(s.employee_id) ?? 0) + s.tip_allocation);
    }
  }

  // Everybody who appears at all: worked hours, earned tips, or is owed a
  // premium. The last is easy to forget and would silently drop a premium for
  // someone whose only shift that fortnight was on another payroll.
  const touched = new Set<string>([
    ...[...cells.values()].map((c) => c.employee_id),
    ...tips.keys(),
    ...premiums.keys(),
  ]);

  const rows: ExportRow[] = [];

  for (const employeeId of touched) {
    const emp = byId.get(employeeId);
    if (!emp) continue;
    const primaryTitle = emp.primary_wage_type ?? "";
    const own = [...cells.values()].filter((c) => c.employee_id === employeeId);

    // Guarantee the primary row exists, even with no hours on it.
    const hasPrimary = own.some((c) => c.title === primaryTitle);
    const titles = hasPrimary ? own.map((c) => c.title) : [primaryTitle, ...own.map((c) => c.title)];

    for (const title of [...new Set(titles)]) {
      const cell = own.find((c) => c.title === title);
      const isPrimary = title === primaryTitle;
      rows.push({
        employee_id: employeeId,
        last_name: emp.last_name,
        first_name: emp.first_name,
        // The suffix is added HERE and stored nowhere, so exactly one row per
        // person can ever carry it.
        title: isPrimary ? `${title} (Primary)`.trim() : title,
        gusto_employee_id: emp.gusto_id ?? "",
        regular_hours: round2(cell?.regular ?? 0),
        overtime_hours: round2(cell?.overtime ?? 0),
        double_overtime_hours: round2(cell?.double_ot ?? 0),
        // Premiums are HOURS and ride the primary row with every other earning.
        missed_break_hours: isPrimary ? round2(premiums.get(employeeId) ?? 0) : 0,
        paycheck_tips: isPrimary ? round2(tips.get(employeeId) ?? 0) || null : null,
        isPrimary,
      });
    }
  }

  // Last, first, then the PRIMARY row before the others — which is the order
  // the real template is in, and the order that reads as "here is this person,
  // and here is the rest of what they did".
  return rows.sort((a, b) => {
    if (a.last_name !== b.last_name) return a.last_name < b.last_name ? -1 : 1;
    if (a.first_name !== b.first_name) return a.first_name < b.first_name ? -1 : 1;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Hand-rolled quoting, per the brief. A name like `Almonte Mejia, Leo` or
 * `O"Brien` has to survive intact, and a payroll file is the wrong place to
 * discover a dependency's idea of an escape character.
 */
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly ExportRow[]): string {
  const header = GUSTO_COLUMNS.join(",");
  const body = rows.map((r) =>
    [
      csvCell(r.last_name),
      csvCell(r.first_name),
      csvCell(r.title),
      csvCell(r.gusto_employee_id),
      r.regular_hours.toFixed(2),
      r.overtime_hours.toFixed(2),
      r.double_overtime_hours.toFixed(2),
      r.missed_break_hours.toFixed(2),
      "", // bonus
      "", // commission
      r.paycheck_tips === null ? "" : r.paycheck_tips.toFixed(2),
      "", // cash_tips — Square card tips only, so there is no cash split
      "", // correction_payment
      "", // custom_earning_commuter_benefit
      "", // custom_earning_distributed_service_charges
      "", // custom_earning_premium — premiums go out as HOURS, above
      "", // reimbursement
      "", // personal_note
    ].join(",")
  );
  // CRLF, which is what the real template uses and what a spreadsheet expects.
  return [header, ...body].join("\r\n") + "\r\n";
}

/* -------------------------------------------------------------------------- */
/* Readiness                                                                   */
/* -------------------------------------------------------------------------- */

export type ExportCaveat = { code: string; detail: string };

/**
 * What is unresolved — named, and then LET THROUGH.
 *
 * `closeReadiness`'s posture, and for its reason: gate the export on a complete
 * set and the fortnight with one missing clock-out never exports, which is how
 * a status stops meaning anything. The confirm names the problems; the human
 * decides.
 */
export function exportReadiness(input: {
  rows: readonly ExportRow[];
  employees: readonly ExportEmployee[];
  shiftsWithoutClockOut: number;
  undecidedBreakFindings: number;
  poolsWithoutFigure: number;
  overtimeNeedingReview: number;
}): ExportCaveat[] {
  const out: ExportCaveat[] = [];
  const byId = new Map(input.employees.map((e) => [e.id, e]));

  const noGustoId = [...new Set(input.rows.map((r) => r.employee_id))].filter(
    (id) => !byId.get(id)?.gusto_id
  );
  if (noGustoId.length) {
    out.push({
      code: "no_gusto_id",
      detail: `${noGustoId.length} ${noGustoId.length === 1 ? "person has" : "people have"} no Gusto id. Their rows will import against a name, which Gusto may reject.`,
    });
  }

  const noTitle = input.rows.filter((r) => r.title.replace(/\s*\(Primary\)$/, "").trim() === "");
  if (noTitle.length) {
    out.push({
      code: "no_wage_type",
      detail: `${noTitle.length} row${noTitle.length === 1 ? " has" : "s have"} no job title. Gusto needs one to know which rate to pay.`,
    });
  }

  if (input.shiftsWithoutClockOut > 0) {
    out.push({
      code: "unfinished_shifts",
      detail: `${input.shiftsWithoutClockOut} shift${input.shiftsWithoutClockOut === 1 ? "" : "s"} never clocked out, so ${input.shiftsWithoutClockOut === 1 ? "its" : "their"} hours are not in this file.`,
    });
  }
  if (input.overtimeNeedingReview > 0) {
    out.push({
      code: "overtime_unreviewed",
      detail: `${input.overtimeNeedingReview} shift${input.overtimeNeedingReview === 1 ? "" : "s"} where our overtime recompute still differs from what the row says.`,
    });
  }
  if (input.undecidedBreakFindings > 0) {
    out.push({
      code: "breaks_undecided",
      detail: `${input.undecidedBreakFindings} meal-break finding${input.undecidedBreakFindings === 1 ? "" : "s"} with no decision recorded, so no premium is in this file for ${input.undecidedBreakFindings === 1 ? "it" : "them"}.`,
    });
  }
  if (input.poolsWithoutFigure > 0) {
    out.push({
      code: "tips_missing",
      detail: `${input.poolsWithoutFigure} shop-day${input.poolsWithoutFigure === 1 ? " has" : "s have"} no tip figure entered, so those tips are not allocated.`,
    });
  }

  return out;
}

/** `donut-friend-2026-07-20.csv` — the period, so two files never collide. */
export function exportFileName(orgName: string, periodStart: string): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "payroll"}-${periodStart}.csv`;
}
