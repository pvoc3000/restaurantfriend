// lib/gustoExport — the payroll file.
//
// The sick-hours case is the most important assertion in this repo: it is made
// against the produced CSV HEADER STRING, because an object-shape assertion
// lets a rename pass while the column quietly comes back and everybody is paid
// their sick time twice.

import { test, eq, ok, no } from "./harness";
import {
  buildExportRows,
  toCsv,
  csvCell,
  exportReadiness,
  exportFileName,
  GUSTO_COLUMNS,
  type ExportEmployee,
  type ExportShift,
} from "../../src/lib/gustoExport";

const alice: ExportEmployee = {
  id: "e1",
  first_name: "Leo",
  last_name: "Almonte Mejia",
  primary_wage_type: "Sr. Donut Friend",
  gusto_id: "n4smoy",
};
const bob: ExportEmployee = {
  id: "e2",
  first_name: "Javier",
  last_name: "Altamirano",
  primary_wage_type: "Fryer",
  gusto_id: "aipnqc",
};

function shift(over: Partial<ExportShift> & { employee_id: string }): ExportShift {
  return {
    wage_type: null,
    hours_regular: null,
    hours_overtime: null,
    hours_double_ot: null,
    sick_hours: null,
    tip_allocation: null,
    ...over,
  };
}

/* -- THE assertion --------------------------------------------------------- */

test("SICK HOURS DO NOT APPEAR IN THE FILE — asserted on the header string", () => {
  // Decision 7. Gusto already pays sick time requested through Gusto; this
  // module records it only so the two sets of records can be checked against
  // each other. Including it here pays the person twice.
  //
  // Against the STRING, deliberately: asserting on an object shape lets a
  // rename slip the column back in.
  const csv = toCsv(
    buildExportRows(
      [shift({ employee_id: "e1", wage_type: "Sr. Donut Friend", hours_regular: 30, sick_hours: 8 })],
      [alice],
      new Map()
    )
  );
  const header = csv.split("\r\n")[0];
  no(/sick/i.test(header), `the header must not mention sick: ${header}`);
  no(/sick/i.test(csv), "and neither must any row");
  // And the 8 sick hours must not have been folded into regular either.
  const first = csv.split("\r\n")[1];
  ok(first.includes("30.00"), "regular hours are 30, not 38");
  no(first.includes("38.00"), "sick hours were not silently added to regular");
});

test("the header is exactly the template's columns, in order", () => {
  const header = toCsv([]).split("\r\n")[0];
  eq(header, GUSTO_COLUMNS.join(","));
  ok(header.startsWith("last_name,first_name,title,gusto_employee_id"));
  ok(header.includes("missed_break_hours"));
});

/* -- the (Primary) suffix -------------------------------------------------- */

test("exactly one row per person carries (Primary)", () => {
  const rows = buildExportRows(
    [
      shift({ employee_id: "e1", wage_type: "Sr. Donut Friend", hours_regular: 5 }),
      shift({ employee_id: "e1", wage_type: "Supervisor", hours_regular: 68.58, hours_overtime: 1.11 }),
    ],
    [alice],
    new Map()
  );
  eq(rows.length, 2);
  eq(rows.filter((r) => r.isPrimary).length, 1);
  eq(rows[0].title, "Sr. Donut Friend (Primary)", "and the primary comes first");
  eq(rows[1].title, "Supervisor");
});

test("the suffix is added, never expected in the data", () => {
  // 031 stores the BARE title in both columns precisely so this can't produce
  // two primary rows or none.
  const rows = buildExportRows(
    [shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 73.45 })],
    [bob],
    new Map()
  );
  eq(rows[0].title, "Fryer (Primary)");
  no(rows[0].title.includes("(Primary) (Primary)"), "never doubled");
});

test("someone who worked NONE of their primary job still gets a primary row", () => {
  // Leo's own row in the real template: `Sr. Donut Friend (Primary)`, 0.0
  // hours, 204.5 tips. Without this the earnings would have nowhere to go.
  const rows = buildExportRows(
    [shift({ employee_id: "e1", wage_type: "Supervisor", hours_regular: 68.58, tip_allocation: 204.5 })],
    [alice],
    new Map()
  );
  eq(rows.length, 2);
  eq(rows[0].title, "Sr. Donut Friend (Primary)");
  eq(rows[0].regular_hours, 0);
  eq(rows[0].paycheck_tips, 204.5, "and it carries the tips");
  eq(rows[1].title, "Supervisor");
  eq(rows[1].regular_hours, 68.58);
});

/* -- earnings ride the primary row ONLY ------------------------------------ */

test("tips and premiums are on the primary row and nowhere else", () => {
  const rows = buildExportRows(
    [
      shift({ employee_id: "e1", wage_type: "Sr. Donut Friend", hours_regular: 5, tip_allocation: 100 }),
      shift({ employee_id: "e1", wage_type: "Supervisor", hours_regular: 20, tip_allocation: 104.5 }),
    ],
    [alice],
    new Map([["e1", 2]])
  );
  const primary = rows.find((r) => r.isPrimary)!;
  const other = rows.find((r) => !r.isPrimary)!;
  // Tips are a PERSON's — pooled per shop-day across whatever they were doing —
  // so both shifts' allocations land on the one row.
  eq(primary.paycheck_tips, 204.5);
  eq(primary.missed_break_hours, 2);
  eq(other.paycheck_tips, null, "the non-primary row carries no tips");
  eq(other.missed_break_hours, 0, "and no premium");
});

test("premiums are HOURS on missed_break_hours, never dollars", () => {
  // Mark's decision, 2026-08-04. Gusto multiplies by the rate it already knows;
  // this module stores none.
  const rows = buildExportRows(
    [shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 40 })],
    [bob],
    new Map([["e2", 1]])
  );
  eq(rows[0].missed_break_hours, 1);
  const csv = toCsv(rows);
  const cols = csv.split("\r\n")[1].split(",");
  eq(cols[GUSTO_COLUMNS.indexOf("missed_break_hours")], "1.00");
  eq(cols[GUSTO_COLUMNS.indexOf("custom_earning_premium")], "", "the dollars column stays empty");
});

test("someone owed a premium but with no shifts still gets a row", () => {
  // Easy to lose: their only shift that fortnight might be on another payroll,
  // and dropping them would silently drop the premium.
  const rows = buildExportRows([], [alice], new Map([["e1", 1]]));
  eq(rows.length, 1);
  eq(rows[0].title, "Sr. Donut Friend (Primary)");
  eq(rows[0].missed_break_hours, 1);
  eq(rows[0].regular_hours, 0);
});

/* -- hours ----------------------------------------------------------------- */

test("hours for one title are summed across that title's shifts", () => {
  const rows = buildExportRows(
    [
      shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 8 }),
      shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 7.45, hours_overtime: 1.56 }),
    ],
    [bob],
    new Map()
  );
  eq(rows.length, 1);
  eq(rows[0].regular_hours, 15.45);
  eq(rows[0].overtime_hours, 1.56);
});

test("a shift with no wage type falls back to the person's primary", () => {
  // Rather than inventing a job called "(none)" that Gusto has never heard of.
  const rows = buildExportRows(
    [shift({ employee_id: "e2", wage_type: null, hours_regular: 6 })],
    [bob],
    new Map()
  );
  eq(rows.length, 1);
  eq(rows[0].title, "Fryer (Primary)");
  eq(rows[0].regular_hours, 6);
});

test("rows sort by last name, then first, then primary first", () => {
  const rows = buildExportRows(
    [
      shift({ employee_id: "e2", wage_type: "Overnight Fryer", hours_regular: 3 }),
      shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 3 }),
      shift({ employee_id: "e1", wage_type: "Supervisor", hours_regular: 3 }),
    ],
    [alice, bob],
    new Map()
  );
  eq(rows.map((r) => `${r.last_name}/${r.title}`), [
    "Almonte Mejia/Sr. Donut Friend (Primary)",
    "Almonte Mejia/Supervisor",
    "Altamirano/Fryer (Primary)",
    "Altamirano/Overnight Fryer",
  ]);
});

/* -- CSV ------------------------------------------------------------------- */

test("a name with a comma or a quote survives intact", () => {
  eq(csvCell("Almonte Mejia"), "Almonte Mejia");
  eq(csvCell("Smith, Jr."), '"Smith, Jr."');
  eq(csvCell('O"Brien'), '"O""Brien"');
  eq(csvCell("line\nbreak"), '"line\nbreak"');
  eq(csvCell(null), "");
  eq(csvCell(0), "0");
});

test("the file is CRLF and ends with one", () => {
  const csv = toCsv(
    buildExportRows([shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 1 })], [bob], new Map())
  );
  ok(csv.endsWith("\r\n"));
  eq(csv.split("\r\n").filter(Boolean).length, 2, "header plus one row");
});

test("every row has exactly as many cells as the header", () => {
  const csv = toCsv(
    buildExportRows(
      [
        shift({ employee_id: "e1", wage_type: "Sr. Donut Friend", hours_regular: 5, tip_allocation: 12 }),
        shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 5 }),
      ],
      [alice, bob],
      new Map([["e1", 1]])
    )
  );
  const lines = csv.split("\r\n").filter(Boolean);
  for (const l of lines) eq(l.split(",").length, GUSTO_COLUMNS.length, `cells in: ${l}`);
});

/* -- readiness ------------------------------------------------------------- */

test("readiness NAMES what is unresolved and never blocks", () => {
  // closeReadiness's posture: gate the export on a complete set and the
  // fortnight with one missing clock-out never exports.
  const rows = buildExportRows(
    [shift({ employee_id: "e1", wage_type: "Sr. Donut Friend", hours_regular: 5 })],
    [{ ...alice, gusto_id: null }],
    new Map()
  );
  const caveats = exportReadiness({
    rows,
    employees: [{ ...alice, gusto_id: null }],
    shiftsWithoutClockOut: 2,
    undecidedBreakFindings: 3,
    poolsWithoutFigure: 1,
    overtimeNeedingReview: 4,
  });
  eq(caveats.map((c) => c.code).sort(), [
    "breaks_undecided",
    "no_gusto_id",
    "overtime_unreviewed",
    "tips_missing",
    "unfinished_shifts",
  ]);
  // Each one says what it MEANS for the file, not just that it exists.
  ok(caveats.every((c) => c.detail.length > 20), "every caveat explains itself");
});

test("a clean period reports nothing", () => {
  const rows = buildExportRows(
    [shift({ employee_id: "e2", wage_type: "Fryer", hours_regular: 40 })],
    [bob],
    new Map()
  );
  eq(
    exportReadiness({
      rows,
      employees: [bob],
      shiftsWithoutClockOut: 0,
      undecidedBreakFindings: 0,
      poolsWithoutFigure: 0,
      overtimeNeedingReview: 0,
    }),
    []
  );
});

test("a missing job title is caught — Gusto needs one to pick a rate", () => {
  const nameless: ExportEmployee = { ...bob, primary_wage_type: null };
  const rows = buildExportRows(
    [shift({ employee_id: "e2", wage_type: null, hours_regular: 5 })],
    [nameless],
    new Map()
  );
  const caveats = exportReadiness({
    rows,
    employees: [nameless],
    shiftsWithoutClockOut: 0,
    undecidedBreakFindings: 0,
    poolsWithoutFigure: 0,
    overtimeNeedingReview: 0,
  });
  ok(caveats.some((c) => c.code === "no_wage_type"));
});

test("the file is named for the period, so two never collide", () => {
  eq(exportFileName("Donut Friend", "2026-07-20"), "donut-friend-2026-07-20.csv");
  eq(exportFileName("", "2026-07-20"), "payroll-2026-07-20.csv");
});
