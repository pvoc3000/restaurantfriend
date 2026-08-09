/**
 * The batch log — production brief phase 5, element actuals.
 *
 * One `production_batches` row is one making of one element: what was asked
 * for, what was on hand, what came out. Migration 044.
 *
 * ---------------------------------------------------------------------------
 * THERE IS DELIBERATELY NO `expandWeek()` HERE.
 *
 * Generation lives in SQL — `generate_production_batches` — and it is tempting
 * to mirror its rule in TypeScript so a dialog can preview what a week will
 * produce. That is migration 016's `nextDeliveryDate` trap: one rule in two
 * languages, drifting the first time either is edited, and here the rule
 * decides whether a kitchen is told to make something. The dialog states the
 * week and the RECEIPT reports what actually happened, which is the same
 * arrangement `GenerateSchedules` already lives with.
 *
 * What IS here is display and arithmetic the database never does.
 */

/* -- status --------------------------------------------------------------- */

/**
 * FileMaker's five, with its sort prefixes stripped ("1 TO DO" → to_do).
 *
 * `to_do` is the DEFAULT and that is not an oversight: a batch log is generated
 * from the weekly element schedule and then worked down (Mark, 2026-08-09), so
 * a fresh row is a job nobody has done yet. FMP's 4,437 to-do rows out of
 * 14,103 are that same design, not a pile of abandoned records.
 *
 * Hardcoded rather than org config, on `lib/roles`' reasoning: this is 044's
 * own check constraint, which is schema. Adding a sixth means a migration.
 */
export const BATCH_STATUSES = [
  "to_do",
  "in_progress",
  "complete",
  "skipped",
  "test",
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  complete: "Complete",
  skipped: "Skipped",
  test: "Test",
};

export const BATCH_STATUS_OPTIONS = BATCH_STATUSES.map((value) => ({
  value,
  label: BATCH_STATUS_LABEL[value],
}));

/** Outstanding work — what the list opens on. */
export function isBatchOutstanding(status: string): boolean {
  return status === "to_do" || status === "in_progress";
}

/* -- amounts -------------------------------------------------------------- */

/**
 * "2 × 22 qt", "22 qt", "2", or an em dash.
 *
 * FileMaker's own `Batch_Yield_full_c` reads "2x 22qt", which is why these are
 * three columns rather than the free text 036 had to parse: a count and a size
 * are different facts and only the pair can be multiplied.
 *
 * A count of 1 is dropped, because "1 × 22 qt" is 22 qt said twice.
 */
export function describeAmount(
  count: number | null,
  size: number | null,
  unit: string | null
): string {
  const u = unit?.trim() ? ` ${unit.trim()}` : "";
  if (size === null) {
    // No size: the count IS the amount ("8 ea", "10 BAGS").
    return count === null ? "—" : `${trim(count)}${u}`;
  }
  if (count === null || count === 1) return `${trim(size)}${u}`;
  return `${trim(count)} × ${trim(size)}${u}`;
}

/**
 * count × size — how much there actually is, in the unit.
 *
 * NULL when either half is missing, never zero. "4x 3 GAL" is twelve gallons
 * and "3 GAL" with no count is three; treating a missing count as zero would
 * report an empty tub, and treating a missing SIZE as one would report four
 * gallons where twelve were made. Both are wrong quietly.
 */
export function amountTotal(count: number | null, size: number | null): number | null {
  if (size === null) return count;
  if (count === null) return size;
  return count * size;
}

/** How a batch came out against what the shop keeps on hand. */
export type YieldVerdict = "over" | "under" | "at" | "unknown";

/**
 * Did this batch make its par?
 *
 * "unknown" when either side is missing, and that is the case worth getting
 * right: a missing par read as zero makes every batch "over", which is a
 * confident answer to a question nobody can answer.
 */
export function yieldAgainstPar(batch: {
  yield_count: number | null;
  yield_size: number | null;
  yield_unit: string | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
}): YieldVerdict {
  const made = amountTotal(batch.yield_count, batch.yield_size);
  const par = amountTotal(batch.par_count, batch.par_size);
  if (made === null || par === null) return "unknown";
  // Different units are not comparable, and guessing a conversion here would be
  // worse than declining: `lib/units` refuses to convert a package unit to a
  // weight for the same reason.
  const mu = batch.yield_unit?.trim().toLowerCase() ?? "";
  const pu = batch.par_unit?.trim().toLowerCase() ?? "";
  if (mu !== pu) return "unknown";
  if (Math.abs(made - par) < 0.001) return "at";
  return made > par ? "over" : "under";
}

/* -- the week ------------------------------------------------------------- */

/**
 * The ISO week containing `iso` — Monday first, seven dates.
 *
 * ISO 1 = MONDAY, and off by one silently shifts a whole kitchen's week by a
 * day — the trap `lib/productionPlans` already carries a fixture for. Dates are
 * compared and stepped as STRINGS through a UTC anchor, never `new Date(iso)`,
 * which is UTC midnight and so the previous day west of Greenwich.
 */
export function batchWeek(iso: string): string[] {
  const monday = weekStart(iso);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDays(monday, i));
  return out;
}

/** The Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay is 0=Sunday; ISO wants 1=Monday…7=Sunday.
  const isodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(iso, -(isodow - 1));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "11 Aug – 17 Aug 2026", for a dialog that has to say which week. */
export function weekLabel(iso: string): string {
  const week = batchWeek(iso);
  return `${short(week[0])} – ${short(week[6])} ${week[6].slice(0, 4)}`;
}

function short(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month}`;
}

/** "Mon 8/11" — the same voice the item history uses. */
export function batchDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Drops a trailing ".000" without rounding anything a scale could show. */
function trim(n: number): string {
  return String(Number(n.toFixed(3)));
}
