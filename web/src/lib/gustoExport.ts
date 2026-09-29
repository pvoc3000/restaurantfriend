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
  /**
   * The SOURCE's word for the job — Homebase's `Role`, numbering stripped
   * ("Overnight Baker"). Used when `wage_type` is empty; see `shiftJobTitle`.
   * Optional so a caller that never had it is unchanged.
   */
  position?: string | null;
  /**
   * The hourly rate the SOURCE paid this shift at — Homebase's `Wage rate`,
   * kept in `source_payload`. What the rows are grouped by; see
   * `buildExportRows`. Null on FileMaker history and on hand-entered rows.
   */
  wage_rate?: number | null;
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
  /**
   * Non-hours money, keyed by the Gusto column it belongs in — flat payroll
   * benefits, from `lib/payrollBenefits`. Empty on every non-primary row.
   *
   * A plain object rather than a `Map` ON PURPOSE: the fixture harness compares
   * with `JSON.stringify`, and a `Map` stringifies to `{}`, so every assertion
   * about these figures would pass unconditionally. An assertion that cannot
   * fail is worse than no assertion.
   */
  earnings: Record<string, number>;
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

/**
 * The columns a payroll BENEFIT may be pointed at — non-hours money only.
 *
 * `paycheck_tips` is deliberately absent even though it is money: it has its own
 * typed field and its own allocator, and letting a benefit target it would add
 * silently to a figure `lib/tipPool` already owns to the cent.
 *
 * The hours columns are absent because a benefit is DOLLARS. Pointing one at
 * `regular_hours` would put $12 where 12 hours belongs and corrupt a payroll
 * file in a way nothing downstream would question — which is the whole reason
 * this list exists rather than letting `payroll_benefits.gusto_column` be free
 * text all the way to the CSV.
 */
export const EARNING_COLUMNS = [
  "bonus",
  "commission",
  "cash_tips",
  "correction_payment",
  "custom_earning_commuter_benefit",
  "custom_earning_distributed_service_charges",
  "custom_earning_premium",
  "reimbursement",
] as const;

export type GustoEarningColumn = (typeof EARNING_COLUMNS)[number];

export function isEarningColumn(column: string): column is GustoEarningColumn {
  return (EARNING_COLUMNS as readonly string[]).includes(column);
}

/**
 * A shift's job title in the file: our wage type, else the source's role, else
 * the person's primary job. FileMaker's rows carry a real `wage_type`; a
 * Homebase row carries only its `Role`, which `buildExportRows` then groups by
 * rate.
 */
export function shiftJobTitle(
  shift: { wage_type: string | null; position?: string | null },
  primaryWageType: string | null
): string {
  return shift.wage_type?.trim() || shift.position?.trim() || primaryWageType || "";
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Build the rows.
 *
 * ONE ROW PER (PERSON, PAY RATE) — Gusto's rule, found on the first Smart
 * Import (Mark, 2026-09-29): it matches each row to one of the person's jobs,
 * and each pay rate can have only one job, so two rows at one rate are refused
 * ("Each employee's job in Gusto can match to only one row"). Homebase splits by
 * ROLE, which is finer — "Overnight Baker" and "Overnight Fryer" at the same
 * $24 are one Gusto job — so the hours are consolidated by the rate Homebase
 * paid, and the row is titled with whichever role has the most hours at that
 * rate. Gusto works out which job that is and remembers it.
 *
 * A shift with no rate (FileMaker history, a hand-entered shift) joins the
 * rated row whose roles include its title, or else forms its own by title — so
 * a forgotten punch entered by hand lands on the job it names instead of
 * becoming a second row for it.
 *
 * EARNINGS RIDE A REAL ROW. Tips, premiums and benefits go on the row whose
 * title is the person's primary job, else their largest row, and that row
 * carries `(Primary)`. It used to be a SEPARATE zero-hour row titled with the
 * primary job, which Gusto refused as a second row for a job the hours rows
 * already matched. Only someone with money and no hours at all gets a row of
 * nothing but earnings.
 */
export function buildExportRows(
  shifts: readonly ExportShift[],
  employees: readonly ExportEmployee[],
  premiums: PremiumHours,
  /**
   * employee id → Gusto column → dollars, from
   * `payrollBenefits.earningsByEmployee`. Optional so every existing caller and
   * fixture is untouched by this arriving.
   */
  earnings: ReadonlyMap<string, Readonly<Record<string, number>>> = new Map()
): ExportRow[] {
  const byId = new Map(employees.map((e) => [e.id, e]));

  type Group = {
    /** Hours per title in this group — the most-worked one names the row. */
    titles: Map<string, number>;
    regular: number;
    overtime: number;
    double_ot: number;
  };
  /** employee id → group key (`r:<cents>` or `t:<title>`) → group */
  const groups = new Map<string, Map<string, Group>>();
  const tips = new Map<string, number>();

  const add = (g: Group, s: ExportShift, title: string) => {
    const reg = s.hours_regular ?? 0;
    const ot = s.hours_overtime ?? 0;
    const dbl = s.hours_double_ot ?? 0;
    g.regular += reg;
    g.overtime += ot;
    g.double_ot += dbl;
    g.titles.set(title, (g.titles.get(title) ?? 0) + reg + ot + dbl);
  };
  const empty = (): Group => ({ titles: new Map(), regular: 0, overtime: 0, double_ot: 0 });

  // Rated shifts first, so a rate-less one can look for a rated row to join.
  const ordered = [...shifts].sort(
    (a, b) => Number(a.wage_rate == null) - Number(b.wage_rate == null)
  );

  for (const s of ordered) {
    const emp = byId.get(s.employee_id);
    if (!emp) continue;

    // Tips are a PERSON's, not a job's — they are pooled per shop-day across
    // whatever the person was doing.
    if (s.tip_allocation) {
      tips.set(s.employee_id, (tips.get(s.employee_id) ?? 0) + s.tip_allocation);
    }

    // A shift that exports no hours — a sick day, whose hours Gusto already
    // pays — must not open a row of its own: an empty row for a job is still a
    // second row for that job.
    const hours = (s.hours_regular ?? 0) + (s.hours_overtime ?? 0) + (s.hours_double_ot ?? 0);
    if (hours === 0) continue;

    const title = shiftJobTitle(s, emp.primary_wage_type);
    const own = groups.get(s.employee_id) ?? new Map<string, Group>();
    groups.set(s.employee_id, own);

    let key: string;
    if (s.wage_rate != null) {
      key = `r:${Math.round(s.wage_rate * 100)}`;
    } else {
      const joined = [...own.entries()].find(([k, g]) => k.startsWith("r:") && g.titles.has(title));
      key = joined ? joined[0] : `t:${title}`;
    }
    const g = own.get(key) ?? empty();
    own.set(key, g);
    add(g, s, title);
  }

  // Everybody who appears at all: worked hours, earned tips, is owed a premium,
  // or earned a benefit. Each of the last three is easy to forget and would
  // silently drop somebody's money — a person whose only shift that fortnight
  // was on another payroll still has to get their row.
  const touched = new Set<string>([
    ...groups.keys(),
    ...tips.keys(),
    ...premiums.keys(),
    ...earnings.keys(),
  ]);

  const rows: ExportRow[] = [];

  for (const employeeId of touched) {
    const emp = byId.get(employeeId);
    if (!emp) continue;
    const primaryTitle = emp.primary_wage_type ?? "";

    const named = [...(groups.get(employeeId)?.values() ?? [])].map((g) => {
      // Most hours names it; a tie goes to the primary job, then alphabetical,
      // so the same data always writes the same file.
      const title = [...g.titles.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          Number(b[0] === primaryTitle) - Number(a[0] === primaryTitle) ||
          (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      )[0][0];
      return { title, g, total: g.regular + g.overtime + g.double_ot };
    });

    const primary =
      named.find((n) => n.title === primaryTitle) ??
      [...named].sort((a, b) => b.total - a.total)[0] ??
      null;

    const push = (title: string, g: Group | null, isPrimary: boolean) =>
      rows.push({
        employee_id: employeeId,
        last_name: emp.last_name,
        first_name: emp.first_name,
        // The suffix is added HERE and stored nowhere, so exactly one row per
        // person can ever carry it.
        title: isPrimary ? `${title} (Primary)`.trim() : title,
        gusto_employee_id: emp.gusto_id ?? "",
        regular_hours: round2(g?.regular ?? 0),
        overtime_hours: round2(g?.overtime ?? 0),
        double_overtime_hours: round2(g?.double_ot ?? 0),
        // Premiums are HOURS and ride the primary row with every other earning.
        missed_break_hours: isPrimary ? round2(premiums.get(employeeId) ?? 0) : 0,
        paycheck_tips: isPrimary ? round2(tips.get(employeeId) ?? 0) || null : null,
        // Same rule as the two above: zero violations in the real template.
        earnings: isPrimary ? { ...(earnings.get(employeeId) ?? {}) } : {},
        isPrimary,
      });

    if (named.length === 0) push(primaryTitle, null, true);
    for (const n of named) push(n.title, n.g, n === primary);
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
  const body = rows.map((r) => {
    // The columns this module types itself. Everything not named here is a
    // benefit column, filled from `earnings` — including `cash_tips` (Square
    // card tips only, so there is no cash split) and `custom_earning_premium`
    // (premiums go out as HOURS in `missed_break_hours`), both of which are
    // simply empty until somebody points a benefit at them.
    const typed: Record<string, string> = {
      last_name: csvCell(r.last_name),
      first_name: csvCell(r.first_name),
      title: csvCell(r.title),
      gusto_employee_id: csvCell(r.gusto_employee_id),
      regular_hours: r.regular_hours.toFixed(2),
      overtime_hours: r.overtime_hours.toFixed(2),
      double_overtime_hours: r.double_overtime_hours.toFixed(2),
      missed_break_hours: r.missed_break_hours.toFixed(2),
      paycheck_tips: r.paycheck_tips === null ? "" : r.paycheck_tips.toFixed(2),
      personal_note: "",
    };

    // THE COLUMN SET IS STILL THE CONSTANT. This walks GUSTO_COLUMNS and looks
    // values UP; it never walks `earnings`. So no data can add a column to this
    // file, however a benefit is configured — which is what keeps the
    // sick-hours assertion load-bearing after the eight hardcoded blanks that
    // used to sit here went away.
    return GUSTO_COLUMNS.map((column) => {
      const value = typed[column];
      if (value !== undefined) return value;
      const dollars = r.earnings[column] ?? 0;
      // Blank rather than "0.00", which is the real template's shape.
      return dollars ? dollars.toFixed(2) : "";
    }).join(",");
  });
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
  /**
   * Homebase shifts with no pay rate on file — imported before 2026-09-29,
   * when the importer started reading it. They are grouped by role instead of
   * rate, which is the file Gusto refused. Re-importing the period fills it.
   */
  homebaseShiftsWithoutRate?: number;
  /**
   * Benefits pointed at a column this file does not have, with what they came
   * to. The UI picks from `EARNING_COLUMNS` so this cannot happen from a
   * screen — it is the safety net for a value written in the SQL editor.
   */
  unknownEarningColumns?: readonly { name: string; column: string; dollars: number }[];
}): ExportCaveat[] {
  const out: ExportCaveat[] = [];
  const byId = new Map(input.employees.map((e) => [e.id, e]));

  const noGustoId = [...new Set(input.rows.map((r) => r.employee_id))].filter(
    (id) => !byId.get(id)?.gusto_id
  );
  if (noGustoId.length) {
    out.push({
      // The CODE keeps the column's own name, like the column does. Only the
      // sentence is vendor-neutral — it names the field the way the employee
      // record labels it, so the two screens are talking about one thing.
      code: "no_gusto_id",
      detail: `${noGustoId.length} ${noGustoId.length === 1 ? "person has" : "people have"} no payroll id. Their rows will import against a name, which Gusto may reject.`,
    });
  }

  const noTitle = input.rows.filter((r) => r.title.replace(/\s*\(Primary\)$/, "").trim() === "");
  if (noTitle.length) {
    out.push({
      code: "no_wage_type",
      detail: `${noTitle.length} row${noTitle.length === 1 ? " has" : "s have"} no job title. Gusto needs one to know which rate to pay.`,
    });
  }

  if ((input.homebaseShiftsWithoutRate ?? 0) > 0) {
    const n = input.homebaseShiftsWithoutRate ?? 0;
    out.push({
      code: "no_wage_rate",
      detail: `${n} Homebase shift${n === 1 ? " has" : "s have"} no pay rate on file, so ${n === 1 ? "it is" : "they are"} grouped by role rather than by rate. Import this period's Homebase files again to fill it in.`,
    });
  }

  // One job title on two rows for one person: the same role at two rates — a
  // raise partway through the period. Gusto matches each row to one job and
  // refuses the second, so it has to be settled in Gusto by hand.
  const seen = new Map<string, number>();
  for (const r of input.rows) {
    const k = `${r.employee_id}|${r.title.replace(/\s*\(Primary\)$/, "")}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const twice = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => {
    const [id, title] = k.split("|");
    const e = byId.get(id);
    return `${e ? `${e.first_name} ${e.last_name}` : id} (${title})`;
  });
  if (twice.length) {
    out.push({
      code: "title_at_two_rates",
      detail: `The same job at two pay rates: ${twice.join(", ")}. Gusto takes one row per job, so one of them will need moving in Gusto.`,
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

  for (const bad of input.unknownEarningColumns ?? []) {
    out.push({
      code: "unknown_earning_column",
      // NAME THE MONEY IT DROPPED. A caveat that says only "misconfigured" is
      // one you skim; a caveat that says $432 is one you fix.
      detail: `${bad.name} writes to “${bad.column}”, which is not a column in this file, so its ${formatDollars(bad.dollars)} is not in it.`,
    });
  }

  return out;
}

function formatDollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** `donut-friend-2026-07-20.csv` — the period, so two files never collide. */
export function exportFileName(orgName: string, periodStart: string): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "payroll"}-${periodStart}.csv`;
}
