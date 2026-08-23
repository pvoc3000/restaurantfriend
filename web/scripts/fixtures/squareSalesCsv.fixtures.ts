// lib/squareSalesCsv — reading a Square "Sales summary" export, for verifying
// the sync against the dashboard.
//
// The header below is COPIED FROM MARK'S REAL EXPORT, misspelling and all
// ("Focused meric"), including the line break inside the quoted title cell and
// the leading BOM. A tidied-up imitation is exactly what let the Homebase
// parser import its separator rows as a person called "-".

import { test, eq, ok } from "./harness";
import {
  parseSquareSalesSummaryCsv,
  parseSquareMoney,
  diffAgainstCsv,
  diffIsClean,
  type SalesCell,
} from "../../src/lib/squareSalesCsv";

// The real file's first three columns, three dates wide.
const NET_CSV =
  '﻿"Sales summary - Group metric by Location - Focused meric: Net sales - Daily\n' +
  'Reporting day (1:00 AM-12:59 AM PT)",1/1/2026,1/2/2026,1/3/2026\n' +
  'DF01 HP,"$3,733.27","$3,375.45","$3,725.05"\n' +
  'DF02 DTLA,"$1,573.22","$1,667.23","$2,112.71"\n' +
  'Total,"$5,306.49","$5,042.68","$5,837.76"\n';

const TIPS_CSV =
  '﻿"Sales summary - Group metric by Location - Focused meric: Tips - Daily\n' +
  'Reporting day (1:00 AM-12:59 AM PT)",1/1/2026,1/2/2026\n' +
  "DF01 HP,$286.58,$295.45\n" +
  "DF02 DTLA,$91.96,$83.47\n" +
  "Total,$378.54,$378.92\n";

const code = (label: string) => (label.startsWith("DF01") ? "DF01" : label.startsWith("DF02") ? "DF02" : null);

// ---------------------------------------------------------------------------
// parseSquareMoney
// ---------------------------------------------------------------------------

test("parseSquareMoney reads Square's own formatting", () => {
  eq(parseSquareMoney('"$3,733.27"'.replace(/"/g, "")), 373327);
  eq(parseSquareMoney("$3,733.27"), 373327);
  eq(parseSquareMoney("$286.58"), 28658);
  eq(parseSquareMoney("$112.95"), 11295);
  eq(parseSquareMoney("$14,381.12"), 1438112, "five figures with a comma");
});

test("parseSquareMoney handles a bare number and whitespace", () => {
  eq(parseSquareMoney("100"), 10000, "no dollar sign, no decimals");
  eq(parseSquareMoney("  $12.30  "), 1230, "padded");
  eq(parseSquareMoney("$0.00"), 0, "a real zero");
  eq(parseSquareMoney("$0.5"), 50, "one decimal place");
});

test("parseSquareMoney reads a NEGATIVE day — daily_sales has no >= 0 check", () => {
  eq(parseSquareMoney("-$50.00"), -5000, "leading minus");
  eq(parseSquareMoney("($50.00)"), -5000, "accounting parentheses");
  eq(parseSquareMoney("-$0.01"), -1, "one cent back");
});

test("parseSquareMoney REFUSES what it does not fully understand", () => {
  // The point is refusal, not precision: a cell it half-reads becomes a wrong
  // number nobody reconciles, where a null becomes a named failure in the diff.
  eq(parseSquareMoney(""), null, "blank");
  eq(parseSquareMoney("—"), null, "an em dash");
  eq(parseSquareMoney("n/a"), null, "words");
  eq(parseSquareMoney("$1.234"), null, "three decimals is not money");
  eq(parseSquareMoney("1.2.3"), null, "nonsense");
  eq(parseSquareMoney("$"), null, "a lone sign");
  eq(parseSquareMoney("12 dollars"), null, "trailing words");
});

// ---------------------------------------------------------------------------
// parseSquareSalesSummaryCsv — the real file's shape
// ---------------------------------------------------------------------------

test("the quoted title spanning a NEWLINE does not shift the date columns", () => {
  const csv = parseSquareSalesSummaryCsv(NET_CSV);
  // A naive split on "\n" tears the header in half and every date moves left.
  eq(csv.dates, ["2026-01-01", "2026-01-02", "2026-01-03"]);
});

test("the leading BOM does not corrupt the title", () => {
  const csv = parseSquareSalesSummaryCsv(NET_CSV);
  eq(csv.measure, "net_sales", "read despite the BOM");
});

test("the measure is read from the title, typo and all", () => {
  eq(parseSquareSalesSummaryCsv(NET_CSV).measure, "net_sales");
  eq(parseSquareSalesSummaryCsv(TIPS_CSV).measure, "tips");
});

test("the reporting-day window is READ, not skipped", () => {
  // It is a dashboard SETTING: if it changes, every stored business_date
  // silently re-buckets. The verifier prints it so a change is visible.
  eq(parseSquareSalesSummaryCsv(NET_CSV).reportingDay, "1:00 AM-12:59 AM PT");
});

test("the Total row is kept APART from the locations", () => {
  const csv = parseSquareSalesSummaryCsv(NET_CSV);
  eq(csv.rows.map((r) => r.label), ["DF01 HP", "DF02 DTLA"], "two shops, no Total");
  eq(csv.total?.[0], 530649, "and the total is available separately");
  // Folded in, every figure on the screen would be exactly doubled.
  eq(csv.rows[0].cents[0]! + csv.rows[1].cents[0]!, csv.total![0], "the rows sum to it");
});

test("cells are read across the row in date order", () => {
  const csv = parseSquareSalesSummaryCsv(NET_CSV);
  eq(csv.rows[0].cents, [373327, 337545, 372505], "DF01");
  eq(csv.rows[1].cents, [157322, 166723, 211271], "DF02");
});

test("a file with no recognisable measure is refused by name", () => {
  let threw = "";
  try {
    parseSquareSalesSummaryCsv('"Some other report",1/1/2026\nDF01 HP,$1.00\n');
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(threw.includes("net sales or tips"), `expected a naming refusal, got ${threw}`);
});

test("a non-date header column is refused rather than silently dropped", () => {
  let threw = "";
  try {
    parseSquareSalesSummaryCsv(
      '"Focused meric: Net sales",1/1/2026,Grand total\nDF01 HP,$1.00,$1.00\n'
    );
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(threw.includes("not a date"), `expected a date refusal, got ${threw}`);
});

// ---------------------------------------------------------------------------
// diffAgainstCsv
// ---------------------------------------------------------------------------

function cell(c: string, d: string, net: number, tips: number): SalesCell {
  return { locationCode: c, business_date: d, netSalesCents: net, tipsCents: tips };
}

const PERFECT: SalesCell[] = [
  cell("DF01", "2026-01-01", 373327, 28658),
  cell("DF01", "2026-01-02", 337545, 29545),
  cell("DF01", "2026-01-03", 372505, 0),
  cell("DF02", "2026-01-01", 157322, 9196),
  cell("DF02", "2026-01-02", 166723, 8347),
  cell("DF02", "2026-01-03", 211271, 0),
];

test("a matching backfill diffs CLEAN over every cell", () => {
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(NET_CSV), PERFECT, code);
  eq(diff.compared, 6, "3 dates x 2 shops");
  eq(diff.matched, 6, "all matched");
  ok(diffIsClean(diff), "clean");
});

test("a ONE CENT disagreement is caught and named", () => {
  const off = PERFECT.map((c) =>
    c.locationCode === "DF01" && c.business_date === "2026-01-02"
      ? { ...c, netSalesCents: 337546 }
      : c
  );
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(NET_CSV), off, code);
  eq(diff.matched, 5, "one short");
  eq(diff.mismatches.length, 1);
  eq(diff.mismatches[0], {
    code: "DF01",
    date: "2026-01-02",
    csvCents: 337545,
    dbCents: 337546,
    deltaCents: 1,
  });
  eq(diffIsClean(diff), false);
});

test("a FACTOR OF 100 is caught — the money-unit error this exists to prevent", () => {
  const cents = PERFECT.map((c) => ({ ...c, netSalesCents: c.netSalesCents * 100 }));
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(NET_CSV), cents, code);
  eq(diff.matched, 0, "nothing matches");
  eq(diff.mismatches.length, 6, "every cell disagrees");
});

test("a missing day is reported as a GAP, not as a mismatch", () => {
  const holed = PERFECT.filter((c) => !(c.locationCode === "DF02" && c.business_date === "2026-01-02"));
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(NET_CSV), holed, code);
  eq(diff.mismatches.length, 0, "no disagreement");
  eq(diff.missingInDb.length, 1, "one gap");
  eq(diff.missingInDb[0].code, "DF02");
  eq(diff.missingInDb[0].date, "2026-01-02");
  eq(diffIsClean(diff), false);
});

test("the TIPS file diffs against the tips column, not the sales one", () => {
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(TIPS_CSV), PERFECT, code);
  eq(diff.measure, "tips");
  eq(diff.compared, 4, "2 dates x 2 shops");
  eq(diff.matched, 4, "the tip figures agree");
  ok(diffIsClean(diff), "clean");
});

test("`through` excludes the PARTIAL final day", () => {
  // 2026-08-23 in the real export reads $112.95 at DF01 against a $3,700 norm:
  // a mid-day export on the export date. Compared, it fails every time.
  const partial =
    '"Focused meric: Net sales - Daily\nReporting day (1:00 AM-12:59 AM PT)",1/1/2026,1/2/2026\n' +
    'DF01 HP,"$3,733.27",$112.95\n';
  const cells = [cell("DF01", "2026-01-01", 373327, 0)];
  const all = diffAgainstCsv(parseSquareSalesSummaryCsv(partial), cells, code);
  eq(all.missingInDb.length, 1, "without `through` the partial day is a gap");

  const trimmed = diffAgainstCsv(parseSquareSalesSummaryCsv(partial), cells, code, {
    through: "2026-01-01",
  });
  eq(trimmed.compared, 1, "only the complete day");
  ok(diffIsClean(trimmed), "clean once the partial day is excluded");
});

test("a CSV label we cannot map is NAMED rather than silently skipped", () => {
  const withThird =
    '"Focused meric: Net sales - Daily\nReporting day (1:00 AM-12:59 AM PT)",1/1/2026\n' +
    'DF01 HP,"$3,733.27"\n' +
    "DF09 Nowhere,$100.00\n";
  const diff = diffAgainstCsv(
    parseSquareSalesSummaryCsv(withThird),
    [cell("DF01", "2026-01-01", 373327, 0)],
    code
  );
  eq(diff.unmappedLabels, ["DF09 Nowhere"]);
  eq(diffIsClean(diff), false);
});

test("THE TOTAL CROSS-CHECK catches a Square location nobody mapped", () => {
  // Every mapped shop agrees to the cent, so every per-location check passes —
  // and the shop's real takings are still understated, because a third Square
  // location exists that we never pulled. Only the Total row can say so.
  const withHiddenThird =
    '"Focused meric: Net sales - Daily\nReporting day (1:00 AM-12:59 AM PT)",1/1/2026\n' +
    'DF01 HP,"$3,733.27"\n' +
    'DF02 DTLA,"$1,573.22"\n' +
    'Total,"$6,306.49"\n'; // $1,000 more than the two rows
  const diff = diffAgainstCsv(
    parseSquareSalesSummaryCsv(withHiddenThird),
    [cell("DF01", "2026-01-01", 373327, 0), cell("DF02", "2026-01-01", 157322, 0)],
    code
  );
  eq(diff.mismatches.length, 0, "every mapped shop agrees exactly");
  eq(diff.missingInDb.length, 0, "and nothing is missing");
  eq(diff.totalMismatches.length, 1, "but the total does not add up");
  eq(diff.totalMismatches[0], {
    date: "2026-01-01",
    csvTotalCents: 630649,
    dbSumCents: 530649,
  });
  eq(diffIsClean(diff), false, "so the run is NOT clean");
});

test("a date with no rows at all is one fault, not two", () => {
  // It is already reported as missingInDb; a total mismatch on top would be the
  // same fault counted twice, which makes a report nobody reads.
  const diff = diffAgainstCsv(parseSquareSalesSummaryCsv(NET_CSV), [], code);
  eq(diff.missingInDb.length, 6, "every cell is a gap");
  eq(diff.totalMismatches.length, 0, "and the totals stay quiet");
});
