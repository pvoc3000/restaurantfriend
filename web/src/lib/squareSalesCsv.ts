/**
 * READING A SQUARE "SALES SUMMARY" EXPORT — for VERIFICATION ONLY.
 *
 * Nothing in the app imports this at runtime. It exists so that the Square sync
 * can be PROVED against the numbers Mark reads on his own dashboard, rather
 * than merely looking plausible: he exported net sales and tips for 2026 to
 * date, and `npm run verify:square` diffs our backfill against them cell by
 * cell. A sync that agrees with the dashboard on 468 cells is a sync you can
 * stop thinking about.
 *
 * It is deliberately NOT an importer. Square backfills; these files check the
 * backfill. Building an importer as well would be a second way for the same
 * numbers to arrive, and then a question about which one was right.
 *
 * THE FILE SHAPE, from the real exports:
 *
 *   "Sales summary - Group metric by Location - Focused meric: Net sales - Daily
 *   Reporting day (1:00 AM-12:59 AM PT)",1/1/2026,1/2/2026,…
 *   DF01 HP,"$3,733.27","$3,375.45",…
 *   DF02 DTLA,"$1,573.22",…
 *   Total,"$5,306.49",…
 *
 * Three things about it that a naive reader gets wrong, all found in the real
 * files rather than imagined:
 *
 *   * THE TITLE CELL SPANS A NEWLINE. It is one quoted field containing a line
 *     break, so splitting on "\n" tears the header in half and every date
 *     column shifts. `parseCsv` from lib/homebaseImport handles it, which is
 *     why this module borrows that rather than writing a second CSV reader.
 *     (Square's own header also misspells "meric" — left alone; we match on
 *     "net sales" / "tips", not on the whole string.)
 *   * THERE IS A BOM. `﻿` leads the file, so a naive `startsWith` on the
 *     title fails and the first column label reads wrong.
 *   * THE LAST ROW IS A TOTAL, not a location. Folded into the location rows it
 *     would double every figure. Kept apart deliberately — see `total`, which
 *     is a genuine cross-check rather than a leftover.
 */

import { parseCsv, parseHomebaseDate } from "./homebaseImport";

export type SquareMeasure = "net_sales" | "tips";

export type SquareCsvRow = {
  /** The dashboard's label for the shop — "DF01 HP", not "DF01". */
  label: string;
  /** One per date, in column order. Null where the cell was blank. */
  cents: (number | null)[];
};

export type SquareCsv = {
  measure: SquareMeasure;
  /**
   * The reporting-day window exactly as the file prints it —
   * "1:00 AM-12:59 AM PT". READ AND RETURNED rather than skipped: it is a
   * DASHBOARD SETTING, and if it is ever changed every stored business_date
   * silently re-buckets and the history stops meaning what it meant. The
   * verifier prints it so a change shows up as a line that reads differently.
   */
  reportingDay: string | null;
  /** ISO dates, in column order. */
  dates: string[];
  /** Location rows only — the Total row is NOT in here. */
  rows: SquareCsvRow[];
  /** The Total row, kept apart so it can be used as a cross-check. */
  total: (number | null)[] | null;
};

/**
 * `"$3,733.27"` → `373327`.
 *
 * REFUSES anything it does not fully understand, returning null —
 * `parseDollarsToCents`' posture, and for its reason: what this buys over
 * `Math.round(parseFloat(v) * 100)` is refusal rather than precision. A cell
 * reading "1.2.3" or "n/a" must become a NAMED failure in the diff, not a
 * number somebody later reconciles against.
 *
 * Accepts a leading minus and Square's parenthesised negative — a day of net
 * refunds is real, and `daily_sales` has no `>= 0` check precisely so it can be
 * recorded.
 */
export function parseSquareMoney(cell: string): number | null {
  const raw = cell.trim();
  if (!raw) return null;

  let body = raw;
  let negative = false;

  // Accounting style: ($12.34) means -1234.
  if (body.startsWith("(") && body.endsWith(")")) {
    negative = true;
    body = body.slice(1, -1).trim();
  }
  if (body.startsWith("-")) {
    negative = !negative;
    body = body.slice(1).trim();
  }
  if (body.startsWith("$")) body = body.slice(1).trim();
  body = body.replace(/,/g, "");

  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(body);
  if (!m) return null;

  const dollars = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(2, "0");
  const cents = dollars * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}

/** "Reporting day (1:00 AM-12:59 AM PT)" → "1:00 AM-12:59 AM PT". */
function readReportingDay(title: string): string | null {
  const m = /Reporting day\s*\(([^)]*)\)/i.exec(title);
  return m ? m[1].trim() : null;
}

/**
 * Which measure the file holds, from its own title. Matched on a substring
 * rather than the whole line because Square's header carries a typo
 * ("Focused meric") that a future export may quietly fix.
 */
function readMeasure(title: string): SquareMeasure | null {
  const t = title.toLowerCase();
  if (t.includes("net sales")) return "net_sales";
  if (t.includes("tips")) return "tips";
  return null;
}

export function parseSquareSalesSummaryCsv(text: string): SquareCsv {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) throw new Error("The file is empty.");

  const header = rows[0];
  const title = header[0] ?? "";

  const measure = readMeasure(title);
  if (!measure) {
    throw new Error(
      `Could not tell whether this file is net sales or tips from its title: ${JSON.stringify(
        title.slice(0, 120)
      )}`
    );
  }

  const dates: string[] = [];
  for (let i = 1; i < header.length; i++) {
    const cell = (header[i] ?? "").trim();
    if (!cell) continue;
    const iso = parseHomebaseDate(cell);
    if (!iso) throw new Error(`Column ${i + 1} is not a date: ${JSON.stringify(cell)}`);
    dates.push(iso);
  }
  if (!dates.length) throw new Error("The header carries no date columns.");

  const body: SquareCsvRow[] = [];
  let total: (number | null)[] | null = null;

  for (const row of rows.slice(1)) {
    const label = (row[0] ?? "").trim();
    // Square ends the file with a blank line; a row with no label and no data
    // is that, not a shop.
    if (!label && row.every((c) => !c.trim())) continue;
    if (!label) continue;

    const cents = dates.map((_, i) => parseSquareMoney(row[i + 1] ?? ""));

    if (label.toLowerCase() === "total") {
      total = cents;
      continue;
    }
    body.push({ label, cents });
  }

  return { measure, reportingDay: readReportingDay(title), dates, rows: body, total };
}

// ----------------------------------------------------------------------------
// The diff
// ----------------------------------------------------------------------------

/** One (location, date) figure out of `daily_sales`, as the verifier reads it. */
export type SalesCell = {
  locationCode: string;
  business_date: string;
  netSalesCents: number;
  tipsCents: number;
};

export type CsvDiff = {
  measure: SquareMeasure;
  compared: number;
  matched: number;
  /** Both sides have the day and they disagree — the failure that matters. */
  mismatches: {
    code: string;
    date: string;
    csvCents: number;
    dbCents: number;
    deltaCents: number;
  }[];
  /** The dashboard has a figure and we have no row. A gap in the backfill. */
  missingInDb: { code: string; date: string; csvCents: number }[];
  /** We have a row the dashboard's window does not cover. Usually benign. */
  missingInCsv: { code: string; date: string; dbCents: number }[];
  /** A CSV label we could not map to one of our locations. */
  unmappedLabels: string[];
  /**
   * The CSV's own Total row against the sum of the locations we mapped, per
   * date. A disagreement means SQUARE HAS A LOCATION WE HAVE NOT MAPPED — the
   * one error that every per-location check above would call a clean pass,
   * because the rows we do know about all agree. This is the cross-check that
   * catches a third shop nobody mentioned.
   */
  totalMismatches: { date: string; csvTotalCents: number; dbSumCents: number }[];
};

/**
 * `codeForCsvLabel` is a PARAMETER rather than a constant, for the reason
 * `parseLocationCode` exists in homebaseImport: "DF01 HP" is a Square dashboard
 * string that anyone with a login can rename, and a rename must not require a
 * code change.
 */
export function diffAgainstCsv(
  csv: SquareCsv,
  cells: readonly SalesCell[],
  codeForCsvLabel: (label: string) => string | null,
  opts: { through?: string } = {}
): CsvDiff {
  const measure = csv.measure;
  const valueOf = (c: SalesCell) => (measure === "tips" ? c.tipsCents : c.netSalesCents);

  const inWindow = (date: string) =>
    date >= csv.dates[0] &&
    date <= (opts.through && opts.through < csv.dates[csv.dates.length - 1]
      ? opts.through
      : csv.dates[csv.dates.length - 1]);

  const db = new Map<string, number>();
  for (const c of cells) db.set(`${c.locationCode}|${c.business_date}`, valueOf(c));

  const diff: CsvDiff = {
    measure,
    compared: 0,
    matched: 0,
    mismatches: [],
    missingInDb: [],
    missingInCsv: [],
    unmappedLabels: [],
    totalMismatches: [],
  };

  const mappedCodes: string[] = [];
  const seen = new Set<string>();

  for (const row of csv.rows) {
    const code = codeForCsvLabel(row.label);
    if (!code) {
      diff.unmappedLabels.push(row.label);
      continue;
    }
    mappedCodes.push(code);

    csv.dates.forEach((date, i) => {
      if (!inWindow(date)) return;
      const csvCents = row.cents[i];
      if (csvCents === null) return;

      const key = `${code}|${date}`;
      seen.add(key);
      diff.compared++;

      const dbCents = db.get(key);
      if (dbCents === undefined) {
        diff.missingInDb.push({ code, date, csvCents });
        return;
      }
      if (dbCents === csvCents) diff.matched++;
      else
        diff.mismatches.push({
          code,
          date,
          csvCents,
          dbCents,
          deltaCents: dbCents - csvCents,
        });
    });
  }

  for (const c of cells) {
    if (!inWindow(c.business_date)) continue;
    if (!mappedCodes.includes(c.locationCode)) continue;
    const key = `${c.locationCode}|${c.business_date}`;
    if (!seen.has(key)) {
      diff.missingInCsv.push({ code: c.locationCode, date: c.business_date, dbCents: valueOf(c) });
    }
  }

  if (csv.total) {
    csv.dates.forEach((date, i) => {
      if (!inWindow(date)) return;
      const csvTotalCents = csv.total?.[i];
      if (csvTotalCents === null || csvTotalCents === undefined) return;

      let dbSumCents = 0;
      let any = false;
      for (const code of mappedCodes) {
        const v = db.get(`${code}|${date}`);
        if (v !== undefined) {
          dbSumCents += v;
          any = true;
        }
      }
      // No rows at all for that date is already reported as missingInDb; a
      // total mismatch on top would be the same fault counted twice.
      if (!any) return;
      if (dbSumCents !== csvTotalCents) {
        diff.totalMismatches.push({ date, csvTotalCents, dbSumCents });
      }
    });
  }

  return diff;
}

/** True when nothing at all disagreed. What the verifier exits on. */
export function diffIsClean(diff: CsvDiff): boolean {
  return (
    diff.mismatches.length === 0 &&
    diff.missingInDb.length === 0 &&
    diff.missingInCsv.length === 0 &&
    diff.unmappedLabels.length === 0 &&
    diff.totalMismatches.length === 0
  );
}
