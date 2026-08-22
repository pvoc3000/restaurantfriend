/**
 * Reading a Homebase timesheet export.
 *
 * Pure: a string in, a plan out. Nothing here touches the database, which is
 * what lets `npm run fixtures` pin it against the real files and what makes
 * "drop → plan → commit, with nothing written before Commit" honest rather than
 * merely intended.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FILE ACTUALLY IS — measured, not guessed
 *
 * Mark's 2026-08-04 exports (DF01 and DF02, the 07/20–08/02 fortnight):
 *
 *   line 1   the shop:            `DF01 HP`  /  `DF02 DTLA`
 *   line 2   `Payroll Period,07/20/2026 To 08/02/2026`
 *   line 3   blank
 *   line 4   the header, 34 columns
 *   then     per-employee blocks, each ending in a `Totals for <name>` row
 *            followed by an all-hyphen separator row
 *
 * `-` means NULL in every column, including Name and Payroll ID. The header
 * repeats between blocks in some exports. Both must be skipped, or the import
 * gains a person called "-" with eighteen shifts — which is exactly what a
 * first pass produced.
 *
 * ---------------------------------------------------------------------------
 * THE TWO FINDINGS THAT SHAPED THIS
 *
 * `Payroll ID` IS `employees.legacy_id`: 18 of 18 people at DF01 and 11 of 11
 * at DF02 matched on it. So the importer joins on an id and never guesses from
 * a name — a name match pays the wrong Sanchez.
 *
 * HOMEBASE DOES NOT SPLIT SHIFTS AT MIDNIGHT. `Clock in date` and
 * `Clock out date` are separate columns, an overnight shift arrives whole, and
 * Homebase's own California overtime on it is correct (a 13.15h shift billed as
 * 8 regular + 4 OT + 1.15 double). Zero adjacent-at-local-midnight pairs across
 * both shops. The brief's central premise — that Homebase splits and thereby
 * under-counts daily overtime — does not hold for this export format. The
 * stitcher below is therefore a SAFETY NET for a source that might, not the
 * main path, and it says so when it fires.
 */

export type HomebaseRow = {
  /** 1-based line number in the file, for naming a refusal precisely. */
  line: number;
  name: string;
  payrollId: string | null;
  clockInDate: string | null;
  clockInTime: string | null;
  clockOutDate: string | null;
  clockOutTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  breakMinutes: number | null;
  /**
   * The "Unpaid breaks" column, in MINUTES — the total Homebase actually
   * deducted, which is NOT the "Break length" beside the punch pair.
   *
   * Homebase records at most one Break start / Break end pair per row, but it
   * totals every unpaid break in this column. On a long overnight a second meal
   * is taken and deducted while the punch columns still show only the first, so
   * the two disagree: Gaspar López, 2026-07-23, punched 6:01pm → 8:10am with
   * "Break length" 30 min and "Unpaid breaks" 1.00 — and 14.15 − 1.00 is exactly
   * the 13.15 Homebase paid (Mark, 2026-08-05).
   *
   * Measured over both real exports, 159 punched rows: span − "Unpaid breaks"
   * equals Homebase's own "Actual hours" on 159 of 159, where span − "Break
   * length" matches on 153. So this is the authority for HOURS WORKED, and
   * `breakMinutes` stays the authority for how long the recorded MEAL was —
   * which is what the meal rule needs, and a figure the total can't give.
   */
  unpaidBreakMinutes: number | null;
  role: string | null;
  regularHours: number | null;
  overtimeHours: number | null;
  doubleOtHours: number | null;
  totalPaidHours: number | null;
  scheduledHours: number | null;
  employeeNote: string | null;
  managerNote: string | null;
};

export type ParsedShift = {
  line: number;
  name: string;
  payrollId: string | null;
  /**
   * The calendar date the clock-in fell on — Homebase's own "Clock in date".
   *
   * NOT the workday. Until 2026-08-22 this field was called `workday` and the
   * two were the same thing, because the workday was always midnight to
   * midnight. Migration 061 lets an employee's workday start at another hour,
   * so the workday is now derived from this plus the person's boundary — and
   * that derivation belongs to the CALLER, since this module parses a CSV and
   * has no idea who anyone is. See `lib/workday`.
   *
   * Two things must keep reading this rather than the workday: the INSTANTS
   * (a shift happened when it happened, whatever day it is attributed to), and
   * `source_row_key`, which is the upsert's conflict target — keying it on a
   * value that can move would silently duplicate rows on re-import instead of
   * updating them.
   */
  punchDate: string;
  /** Local wall times, resolved to instants by the caller with the org's zone. */
  clockInMinutes: number;
  clockOutDate: string | null;
  clockOutMinutes: number | null;
  breakStartMinutes: number | null;
  breakMinutes: number | null;
  /** Total unpaid break to deduct from the clock span. See HomebaseRow. */
  unpaidBreakMinutes: number | null;
  role: string | null;
  source: HomebaseRow;
  /** True when this row was reassembled from two segments. */
  stitched: boolean;
};

export type Refusal = { line: number; name: string; why: string };

/**
 * A row that is perfectly readable and simply holds no punch — a scheduled day
 * nobody clocked in for, which Homebase still prints. Ten of them in the real
 * DF01 fortnight, mostly salaried people who never punch.
 *
 * Kept apart from `refused` because calling these "rows this cannot read" is a
 * false accusation about the file, and it buries the rows that genuinely are
 * unreadable among rows that are fine.
 */
export type Skipped = { line: number; name: string; punchDate: string | null; why: string };

export type ImportPlan = {
  /** From line 1 — "DF01 HP" yields "DF01". */
  locationCode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  shifts: ParsedShift[];
  refused: Refusal[];
  skipped: Skipped[];
  /** Distinct people in the file, with the id to match them on. */
  people: { name: string; payrollId: string | null; shifts: number }[];
  stitchedCount: number;
  crossingCount: number;
};

/* -------------------------------------------------------------------------- */
/* Parsing primitives                                                          */
/* -------------------------------------------------------------------------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** `-` is Homebase's null, and it appears in every column including the name. */
function cell(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" || t === "-" ? null : t;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** `July 23 2026` → `2026-07-23`. Also accepts `07/23/2026`. */
export function parseHomebaseDate(v: string | null): string | null {
  if (!v) return null;
  const named = /^([A-Za-z]+)\s+(\d{1,2})[,]?\s+(\d{4})$/.exec(v.trim());
  if (named) {
    const m = MONTHS[named[1].toLowerCase()];
    if (!m) return null;
    return iso(Number(named[3]), m, Number(named[2]));
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (slash) return iso(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  return null;
}

/** A round trip, never the regex alone — `new Date("2026-02-31")` rolls over. */
function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** `12:15am` → minutes since midnight. */
export function parseHomebaseTime(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})\s?(am|pm)$/i.exec(v.trim());
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }
  const h24 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (h24) return Number(h24[1]) * 60 + Number(h24[2]);
  return null;
}

/** `$24.00` / `7.72` / `-` → a number or null. Currency is parsed but never stored. */
function num(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** `30 min` → 30. */
function breakLength(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d+)\s*min/i.exec(v.trim());
  return m ? Number(m[1]) : null;
}

/**
 * `DF01 HP` → `DF01`. The shop code is the first token of line 1, which is how
 * Donut Friend names them; anything else is returned whole so the screen can
 * say what it found rather than silently picking a shop.
 */
export function parseLocationCode(line1: string | undefined): string | null {
  const t = (line1 ?? "").trim();
  if (!t) return null;
  const m = /^([A-Za-z]+\d+)\b/.exec(t);
  return m ? m[1].toUpperCase() : t;
}

/** `Payroll Period,07/20/2026 To 08/02/2026` */
export function parsePeriod(cells: string[]): { start: string | null; end: string | null } {
  const joined = cells.join(" ");
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:To|-|–)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(joined);
  if (!m) return { start: null, end: null };
  return { start: parseHomebaseDate(m[1]), end: parseHomebaseDate(m[2]) };
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

const HEADER_FIRST_CELL = "name";

export function planImport(text: string): ImportPlan {
  const rows = parseCsv(text);
  const locationCode = parseLocationCode(rows[0]?.[0]);

  let period = { start: null as string | null, end: null as string | null };
  for (const r of rows.slice(0, 5)) {
    if (/payroll period/i.test(r[0] ?? "")) period = parsePeriod(r);
  }

  const headerIndex = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === HEADER_FIRST_CELL);
  if (headerIndex === -1) {
    return {
      locationCode,
      periodStart: period.start,
      periodEnd: period.end,
      shifts: [],
      refused: [{ line: 0, name: "", why: "No header row — this does not look like a Homebase timesheet export." }],
      skipped: [],
      people: [],
      stitchedCount: 0,
      crossingCount: 0,
    };
  }

  const header = rows[headerIndex].map((h) => h.trim());
  const at = (name: string): number => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cols = {
    name: at("Name"),
    inDate: at("Clock in date"),
    inTime: at("Clock in time"),
    outDate: at("Clock out date"),
    outTime: at("Clock out time"),
    breakStart: at("Break start"),
    breakEnd: at("Break end"),
    breakLength: at("Break length"),
    // NOT the same column as "Break length" — see `unpaidBreakMinutes`.
    unpaidBreaks: at("Unpaid breaks"),
    payrollId: at("Payroll ID"),
    role: at("Role"),
    regular: at("Regular hours"),
    ot: at("OT hours"),
    dot: at("Double OT"),
    paid: at("Total paid hours"),
    scheduled: at("Scheduled hours"),
    empNote: at("Employee note"),
    mgrNote: at("Manager note"),
  };

  const refused: Refusal[] = [];
  const skipped: Skipped[] = [];
  const parsed: ParsedShift[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const first = (r[cols.name] ?? "").trim();

    // The three kinds of row that are not a shift. Each has bitten:
    // the repeated header, the per-employee total, and the all-hyphen separator
    // that a first pass imported as a person called "-" with eighteen shifts.
    if (!first) continue;
    if (first.toLowerCase() === HEADER_FIRST_CELL) continue;
    // "Totals for <name>" ends each block AND a bare "Totals" ends the file.
    // The first pass only caught the former, so the grand total was reported as
    // an unreadable row — which is a true statement about a row that was never
    // a shift.
    if (/^totals\b/i.test(first)) continue;
    if (first === "-") continue;

    const row: HomebaseRow = {
      line,
      name: first,
      payrollId: cell(r[cols.payrollId]),
      clockInDate: cell(r[cols.inDate]),
      clockInTime: cell(r[cols.inTime]),
      clockOutDate: cell(r[cols.outDate]),
      clockOutTime: cell(r[cols.outTime]),
      breakStart: cell(r[cols.breakStart]),
      breakEnd: cell(r[cols.breakEnd]),
      breakMinutes: breakLength(cell(r[cols.breakLength])),
      // HOURS in the file — 1.00, 0.52 — where "Break length" is "30 min".
      unpaidBreakMinutes: (() => {
        const h = num(cell(r[cols.unpaidBreaks]));
        return h === null ? null : Math.round(h * 60);
      })(),
      role: cell(r[cols.role]),
      regularHours: num(cell(r[cols.regular])),
      overtimeHours: num(cell(r[cols.ot])),
      doubleOtHours: num(cell(r[cols.dot])),
      totalPaidHours: num(cell(r[cols.paid])),
      scheduledHours: num(cell(r[cols.scheduled])),
      employeeNote: cell(r[cols.empNote]),
      managerNote: cell(r[cols.mgrNote]),
    };

    const punchDate = parseHomebaseDate(row.clockInDate);
    const inMin = parseHomebaseTime(row.clockInTime);
    if (!punchDate) {
      refused.push({ line, name: row.name, why: `Unreadable clock-in date ${JSON.stringify(row.clockInDate)}` });
      continue;
    }
    if (inMin === null) {
      if (row.clockInTime === null) {
        // A date with no time at all: nothing happened, so there is nothing to
        // import. Not a failure.
        skipped.push({ line, name: row.name, punchDate, why: "No punches on this row" });
      } else {
        refused.push({ line, name: row.name, why: `Unreadable clock-in time ${JSON.stringify(row.clockInTime)}` });
      }
      continue;
    }

    const outDate = parseHomebaseDate(row.clockOutDate);
    const outMin = parseHomebaseTime(row.clockOutTime);
    if (row.clockOutTime && outMin === null) {
      refused.push({ line, name: row.name, why: `Unreadable clock-out time ${JSON.stringify(row.clockOutTime)}` });
      continue;
    }

    const breakStartMin = parseHomebaseTime(row.breakStart);
    const breakEndMin = parseHomebaseTime(row.breakEnd);
    let breakMinutes = row.breakMinutes;
    if (breakMinutes === null && breakStartMin !== null && breakEndMin !== null) {
      let d = breakEndMin - breakStartMin;
      if (d < 0) d += 1440;
      breakMinutes = d;
    }

    parsed.push({
      line,
      name: row.name,
      payrollId: row.payrollId,
      punchDate,
      clockInMinutes: inMin,
      // The clock-out DATE is Homebase's own, not inferred. Where it is absent
      // and the times wrap, the day is inferred — the same rule the FileMaker
      // transform settled on after trusting a date column produced a
      // 30.58-hour shift.
      clockOutDate: outMin === null ? null : (outDate ?? (outMin < inMin ? addDay(punchDate) : punchDate)),
      clockOutMinutes: outMin,
      breakStartMinutes:
        breakStartMin === null ? null : (breakStartMin - inMin + 1440) % 1440,
      breakMinutes,
      // Falls back to the recorded meal when the column is absent, which is
      // what every export before this one effectively meant.
      unpaidBreakMinutes: row.unpaidBreakMinutes ?? breakMinutes,
      role: row.role,
      source: row,
      stitched: false,
    });
  }

  const stitched = stitchMidnightSplits(parsed);

  const peopleMap = new Map<string, { name: string; payrollId: string | null; shifts: number }>();
  for (const s of stitched.shifts) {
    const key = s.payrollId ?? s.name;
    const e = peopleMap.get(key);
    if (e) e.shifts += 1;
    else peopleMap.set(key, { name: s.name, payrollId: s.payrollId, shifts: 1 });
  }

  const crossingCount = stitched.shifts.filter(
    (s) => s.clockOutDate !== null && s.clockOutDate !== s.punchDate
  ).length;

  return {
    locationCode,
    periodStart: period.start,
    periodEnd: period.end,
    shifts: stitched.shifts,
    refused: [...refused, ...stitched.refused],
    skipped,
    people: [...peopleMap.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    stitchedCount: stitched.count,
    crossingCount,
  };
}

function addDay(iso10: string): string {
  return new Date(new Date(`${iso10}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * The safety net. Two segments become one shift when they belong to the same
 * person and the first ENDS at exactly the instant the second BEGINS, and that
 * instant is local midnight.
 *
 * Strictly narrower than "zero gap", which is the point: a genuine
 * close-then-open double at 3pm shares an instant too, and merging those would
 * invent a twelve-hour shift out of two six-hour ones. Working in wall-clock
 * midnight is safe here because a split, if it happens, is BY the local day
 * boundary — the thing being detected is the source's own convention.
 *
 * A chain of three segments is a shift over 24 hours, which is a data error:
 * refused and reported, never guessed at.
 *
 * Measured on both real files: this fires ZERO times. Homebase keeps crossing
 * shifts whole. It exists for a source that doesn't.
 */
function stitchMidnightSplits(shifts: ParsedShift[]): {
  shifts: ParsedShift[];
  refused: Refusal[];
  count: number;
} {
  const refused: Refusal[] = [];
  const byPerson = new Map<string, ParsedShift[]>();
  for (const s of shifts) {
    const key = s.payrollId ?? s.name;
    const list = byPerson.get(key);
    if (list) list.push(s);
    else byPerson.set(key, [s]);
  }

  const merged = new Set<ParsedShift>();
  let count = 0;

  for (const list of byPerson.values()) {
    for (const a of list) {
      if (merged.has(a)) continue;
      // `a` must END at local midnight.
      if (a.clockOutDate === null || a.clockOutMinutes !== 0) continue;
      const b = list.find(
        (x) =>
          x !== a &&
          !merged.has(x) &&
          // `b` must BEGIN at that same instant: midnight of a's clock-out day.
          x.clockInMinutes === 0 &&
          x.punchDate === a.clockOutDate
      );
      if (!b) continue;

      // A third segment continuing the chain means >24 hours.
      const c = list.find(
        (x) => x !== a && x !== b && !merged.has(x) && x.clockInMinutes === 0 && x.punchDate === b.clockOutDate
      );
      if (c) {
        refused.push({
          line: a.line,
          name: a.name,
          why: "Three segments join at midnight — that is a shift over 24 hours, which is a data error.",
        });
        continue;
      }

      a.clockOutDate = b.clockOutDate;
      a.clockOutMinutes = b.clockOutMinutes;
      a.stitched = true;
      // The second segment's meal is the shift's meal if the first had none.
      if (a.breakMinutes === null && b.breakMinutes !== null) {
        a.breakMinutes = b.breakMinutes;
        a.breakStartMinutes =
          b.breakStartMinutes === null ? null : b.breakStartMinutes + (1440 - a.clockInMinutes);
      }
      // The unpaid TOTAL adds, though — both halves were deducted, and the
      // stitched shift has to carry the whole deduction or its hours come out
      // long by whatever the other segment gave up.
      if (a.unpaidBreakMinutes !== null || b.unpaidBreakMinutes !== null) {
        a.unpaidBreakMinutes = (a.unpaidBreakMinutes ?? 0) + (b.unpaidBreakMinutes ?? 0);
      }
      merged.add(b);
      count += 1;
    }
  }

  return { shifts: shifts.filter((s) => !merged.has(s)), refused, count };
}

/* -------------------------------------------------------------------------- */
/* Why a commit is refused                                                     */
/* -------------------------------------------------------------------------- */

export type CommitState = {
  shiftCount: number;
  /** False when the file names a shop code this org does not have. */
  hasLocation: boolean;
  /** Periods this file touches that are closed or exported. */
  blockedPeriodCount: number;
  /** Periods that DO cover some of these workdays. */
  targetPeriodCount: number;
  /** Workdays no pay period covers — see `uncoveredDays` on the import screen. */
  uncoveredDays: readonly string[];
  uncoveredShiftCount: number;
};

/**
 * The sentence a refused Import button owes the reader, or null when it can run.
 *
 * PURE AND EXPORTED so the reason and the `disabled` cannot drift: the screen
 * derives both from this, and a fixture can hold it to the case that made it
 * necessary. Until 2026-08-22 the button was bare `disabled`, which explains
 * itself only on hover — and there is no hover on the iPad this app is used on.
 * Mark dropped a real export, could not press Import, and reasonably read the
 * unchanged data as the feature not working at all.
 *
 * The ORDER is the order a reader can act on: something wrong with the file,
 * then something wrong with the calendar, then the one 061 introduced.
 */
export function whyCommitIsBlocked(s: CommitState): string | null {
  if (s.shiftCount === 0) return "This file holds no shifts to import.";
  if (!s.hasLocation)
    return "No location in this org has that code, so there is nowhere to file these shifts.";
  if (s.blockedPeriodCount > 0)
    return "One of the pay periods this file covers is no longer open.";
  if (s.uncoveredDays.length > 0)
    return (
      `${s.uncoveredShiftCount} shift${s.uncoveredShiftCount === 1 ? "" : "s"} belong to ` +
      `${s.uncoveredDays.join(", ")}, which no pay period covers — open it above first.`
    );
  if (s.targetPeriodCount === 0) return "No pay period covers these dates.";
  return null;
}
