// lib/homebaseImport — WHICH break column gets deducted from hours worked.
//
// THE BUG THESE PIN. A Homebase export carries two break figures per row:
//
//   Break start · Break end · Break length      the ONE recorded meal punch
//   ... Regular hours · Unpaid breaks · OT ...   the TOTAL deducted, in HOURS
//
// The importer wrote `Break length` to `timesheets.unpaid_break_minutes`, which
// `workedHours` subtracts from the clock span. On most shifts the two agree and
// nothing showed. On a long overnight they do not: a second meal is taken and
// deducted, while Homebase's single Break start/end pair still shows only the
// first. Gaspar López, 2026-07-23 — punched 6:01pm → 8:10am, "Break length"
// 30 min, "Unpaid breaks" 1.00 — came out 0.50h long, and the overtime
// recompute then proposed half an hour of extra DOUBLE time on it (Mark,
// 2026-08-05: "the app disagrees with homebase and is recommending adding .5 an
// hour to the double overtime - which is the break length").
//
// Measured over both real exports, 159 punched rows:
//   span − "Unpaid breaks" == Homebase's own "Actual hours" on 159 of 159
//   span − "Break length"  == "Actual hours"                on 153 of 159
// So "Unpaid breaks" is the authority for HOURS WORKED. `breakMinutes` stays the
// authority for how long the recorded MEAL was, which is what the meal rule
// needs and which the total cannot give.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, eq, ok } from "./harness";
import { planImport } from "../../src/lib/homebaseImport";

const REAL = readFileSync(
  join(__dirname, "../../../scripts/fixtures/data/homebase-df01-slice.csv"),
  "utf8"
);

const HEADER =
  "Name,Clock in date,Clock in time,Clock out date,Clock out time,Break start,Break end," +
  "Break length,Break type,Payroll ID,Role,Wage rate,Scheduled hours,Actual hours," +
  "Actual vs. scheduled,Total paid hours,Regular hours,Unpaid breaks,OT hours,Double OT," +
  "Spread of hours,Split shifts,Estimated wages,Cash tips,Credit tips,PTO,Blue law hours," +
  "FFCRA - paid sick,FFCRA - others,FFCRA - child,Holiday pay,No show reason,Employee note,Manager note";

/** Gaspar's real 2026-07-23 line, verbatim from the stored DF02 export. */
const GASPAR =
  'Gaspar Lopez,July 23 2026,6:01pm,July 24 2026,8:10am,12:00am,12:30am,30 min,30 min - Unpaid,' +
  '583,01 Overnight Baker,$25.00,11.00,13.15,2.15,13.15,8.00,1.00,4.00,1.15,0.00,0.00,' +
  '$407.50,$0.00,$0.00,0.00,0.00,0.00,0.00,0.00,0.00,"","",""';

function file(...rows: string[]): string {
  return ["DF02 HP", "Payroll Period,07/20/2026 To 08/02/2026", "", HEADER, ...rows].join("\n");
}

/* -- the shift that found it ----------------------------------------------- */

test("Gaspar 07-23: the deduction is the TOTAL, not the one recorded meal", () => {
  const s = planImport(file(GASPAR)).shifts[0];
  eq(s.unpaidBreakMinutes, 60, "unpaid break minutes");
  // The recorded meal is still 30 — that is a different question, and the meal
  // rule needs it to decide whether the break was long enough.
  eq(s.breakMinutes, 30, "the recorded meal's own length");
});

test("Gaspar 07-23: span minus the deduction is what Homebase actually paid", () => {
  const s = planImport(file(GASPAR)).shifts[0];
  // 6:01pm → 8:10am the next day.
  const span = ((s.clockOutMinutes as number) + 1440 - s.clockInMinutes) / 60;
  eq(Math.round(span * 100) / 100, 14.15, "clock to clock");
  const worked = span - (s.unpaidBreakMinutes as number) / 60;
  // Homebase's own Total paid hours on that row, and 8 + 4 + 1.15.
  eq(Math.round(worked * 100) / 100, 13.15, "worked");
  // The old reading gave 13.65 — half an hour long, which the overtime
  // recompute turned into half an hour of extra double time.
  ok(Math.abs(span - (s.breakMinutes as number) / 60 - 13.15) > 0.4, "the old reading was 0.5h out");
});

/* -- and it holds across the whole real file ------------------------------- */

test("every punched row in the real export reconciles with Homebase's Actual hours", () => {
  const plan = planImport(REAL);
  ok(plan.shifts.length > 0, "the slice has shifts");
  let checked = 0;
  for (const s of plan.shifts) {
    if (s.clockOutMinutes === null) continue;
    const actual = s.source.totalPaidHours;
    if (actual === null) continue;
    const span =
      ((s.clockOutMinutes < s.clockInMinutes ? s.clockOutMinutes + 1440 : s.clockOutMinutes) -
        s.clockInMinutes) /
      60;
    const worked = span - (s.unpaidBreakMinutes ?? 0) / 60;
    // A cent-scale tolerance: Homebase rounds its own column to two places.
    ok(
      Math.abs(worked - actual) < 0.02,
      `${s.name} ${s.punchDate}: ours ${worked.toFixed(2)} vs Homebase ${actual}`
    );
    checked += 1;
  }
  ok(checked >= 10, `checked ${checked} rows`);
});

/* -- the edges -------------------------------------------------------------- */

test("a row with no break at all deducts nothing", () => {
  const row =
    'Gaspar Lopez,July 28 2026,7:14pm,July 28 2026,11:55pm,"","","","",583,01 Overnight Baker,' +
    '$25.00,6.50,4.68,-1.82,4.68,4.68,0.00,0.00,0.00,0.00,0.00,$117.00,$0.00,$0.00,0.00,0.00,' +
    '0.00,0.00,0.00,0.00,"","",""';
  const s = planImport(file(row)).shifts[0];
  eq(s.unpaidBreakMinutes, 0, "nothing deducted");
  eq(s.breakMinutes, null, "and no meal recorded");
});

test("a 31-minute meal rounds from the hours column, not from the punch pair", () => {
  // "Unpaid breaks" 0.52h is 31.2 minutes; the punch pair says 31.
  const row =
    'Gaspar Lopez,July 29 2026,6:17pm,July 30 2026,5:55am,11:54pm,12:25am,31 min,30 min - Unpaid,' +
    '583,01 Overnight Baker,$25.00,11.00,11.11,0.11,11.11,8.00,0.52,3.11,0.00,0.00,0.00,' +
    '$316.63,$0.00,$0.00,0.00,0.00,0.00,0.00,0.00,0.00,"","",""';
  const s = planImport(file(row)).shifts[0];
  eq(s.unpaidBreakMinutes, 31, "0.52h to the nearest minute");
  eq(s.breakMinutes, 31, "and the meal itself");
});

test("an export with no Unpaid breaks column falls back to the recorded meal", () => {
  // Every export before this column was read effectively meant that, and an
  // older file must not silently deduct nothing.
  const shortHeader = HEADER.replace(",Unpaid breaks", "");
  const row = GASPAR.split(",");
  row.splice(17, 1); // drop the 1.00
  const csv = ["DF02 HP", "Payroll Period,07/20/2026 To 08/02/2026", "", shortHeader, row.join(",")].join("\n");
  const s = planImport(csv).shifts[0];
  eq(s.unpaidBreakMinutes, 30, "falls back to the meal");
});
