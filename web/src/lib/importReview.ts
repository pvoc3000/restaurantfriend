/**
 * What a re-import would do to each shift — the Homebase importer's checklist.
 *
 * WHY THIS EXISTS (Mark, 2026-10-27). Re-importing a fortnight was all or
 * nothing: the upsert puts every row back to what Homebase said, so fixing one
 * shift's pay rate (Skymarie Baiza's 10/23, $19 where she earns $21) meant
 * resetting every overtime split, break and note anyone had decided in the app
 * since. The importer already shows the file before it writes, so each shift
 * now gets a checkbox and one of four answers:
 *
 *   new        nothing in the app has this shift's key yet
 *   unchanged  already imported, and Homebase still says the same thing
 *   changed    already imported, and Homebase now says something different
 *   edited     someone changed it in the app since it was imported
 *
 * `edited` WINS over `changed`, because it is the one that loses work: an
 * edited row starts UNTICKED (Mark's rule) even when Homebase has also moved,
 * and `alsoChanged` says so, so the reader can decide.
 *
 * WHAT COUNTS AS AN EDIT is exactly the set of columns the importer's upsert
 * overwrites and the timesheets screen lets you change: the three hours
 * columns (and any overtime decision, even one that landed back on the
 * source's figures), the unpaid break, and the two notes. `sick_hours` is
 * neither written by the import nor counted here. The workday is not an edit
 * either — it is recomputed from the person's boundary on both paths.
 *
 * Pure, so `npm run fixtures` covers it.
 */

export type ImportStatus = "new" | "unchanged" | "changed" | "edited";

export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  new: "New",
  unchanged: "Unchanged",
  changed: "Changed in Homebase",
  edited: "Edited here",
};

/** The same words inside a sentence ("3 new · 1 changed in Homebase"). */
export const IMPORT_STATUS_COUNT_LABEL: Record<ImportStatus, string> = {
  new: "new",
  unchanged: "unchanged",
  changed: "changed in Homebase",
  edited: "edited here",
};

/** Ticked when the file is read. Only an edit is left for a person to choose. */
export function selectedByDefault(status: ImportStatus): boolean {
  return status !== "edited";
}

/** What the file says now — the same fields the upsert writes from it. */
export type IncomingShift = {
  regular: number | null;
  overtime: number | null;
  double_ot: number | null;
  paid: number | null;
  breakMinutes: number | null;
  /** The clock-out instant, ISO; null for a shift still open. */
  clockOut: string | null;
  position: string | null;
  wageRate: number | null;
  employeeNote: string | null;
  managerNote: string | null;
};

/** The row already in `timesheets`. PostgREST returns `numeric` as a string. */
export type StoredShift = {
  source_hours_regular: number | string | null;
  source_hours_overtime: number | string | null;
  source_hours_double_ot: number | string | null;
  source_hours_paid: number | string | null;
  source_break_minutes: number | null;
  hours_regular: number | string | null;
  hours_overtime: number | string | null;
  hours_double_ot: number | string | null;
  ot_decision: string | null;
  unpaid_break_minutes: number | null;
  clock_out: string | null;
  position: string | null;
  employee_note: string | null;
  manager_note: string | null;
  source_payload: Record<string, unknown> | null;
};

export type ShiftReview = {
  status: ImportStatus;
  /** An edited row whose Homebase figures have ALSO moved. */
  alsoChanged: boolean;
  /** What differs, in words, for the screen — Homebase's side or ours. */
  changed: string[];
  edited: string[];
};

/** Half a cent: `numeric(8,2)` round-trips, so anything closer is the same. */
const EPSILON = 0.005;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameNumber(a: unknown, b: unknown): boolean {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) < EPSILON;
}

/** Notes compare as text, with nothing and blank the same. */
function sameText(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return norm(a) === norm(b);
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * The note Homebase sent at the last import. The payload keeps the raw row's
 * camelCase names (`...s.source`), which is where the original is.
 */
function sourceNote(payload: Record<string, unknown> | null, key: "employeeNote" | "managerNote") {
  return payload ? payload[key] : null;
}

export function reviewShift(incoming: IncomingShift, stored: StoredShift | null): ShiftReview {
  if (stored === null) return { status: "new", alsoChanged: false, changed: [], edited: [] };

  const payload = stored.source_payload;

  // Homebase's side: what the file says now against what it said last time.
  const changed: string[] = [];
  if (
    !sameNumber(incoming.regular, stored.source_hours_regular) ||
    !sameNumber(incoming.overtime, stored.source_hours_overtime) ||
    !sameNumber(incoming.double_ot, stored.source_hours_double_ot) ||
    !sameNumber(incoming.paid, stored.source_hours_paid)
  )
    changed.push("hours");
  if (!sameNumber(incoming.breakMinutes, stored.source_break_minutes)) changed.push("break");
  if (!sameInstant(incoming.clockOut, stored.clock_out)) changed.push("clock-out");
  if (!sameText(incoming.position, stored.position)) changed.push("role");
  if (!sameNumber(incoming.wageRate, payload ? payload.wage_rate : null)) changed.push("pay rate");
  if (
    !sameText(incoming.employeeNote, sourceNote(payload, "employeeNote")) ||
    !sameText(incoming.managerNote, sourceNote(payload, "managerNote"))
  )
    changed.push("notes");

  // Our side: what the row says now against what Homebase said last time.
  const edited: string[] = [];
  if (
    (stored.ot_decision !== null && stored.ot_decision !== "source") ||
    !sameNumber(stored.hours_regular, stored.source_hours_regular) ||
    !sameNumber(stored.hours_overtime, stored.source_hours_overtime) ||
    !sameNumber(stored.hours_double_ot, stored.source_hours_double_ot)
  )
    edited.push("hours");
  if (!sameNumber(stored.unpaid_break_minutes, stored.source_break_minutes)) edited.push("break");
  if (
    !sameText(stored.employee_note, sourceNote(payload, "employeeNote")) ||
    !sameText(stored.manager_note, sourceNote(payload, "managerNote"))
  )
    edited.push("notes");

  if (edited.length > 0)
    return { status: "edited", alsoChanged: changed.length > 0, changed, edited };
  if (changed.length > 0) return { status: "changed", alsoChanged: false, changed, edited };
  return { status: "unchanged", alsoChanged: false, changed, edited };
}
