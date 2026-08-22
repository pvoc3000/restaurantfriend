// lib/homebaseImport — reading a real Homebase timesheet export.
//
// The first block runs against an ACTUAL slice of Mark's DF01 export
// (scripts/fixtures/data/homebase-df01-slice.csv), preamble and totals rows and
// hyphen separators intact. A tidied-up imitation would have passed the first
// version of this parser, which imported the separator rows as a person called
// "-" with eighteen shifts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, eq, ok, no } from "./harness";
import {
  planImport,
  parseHomebaseDate,
  parseHomebaseTime,
  parseLocationCode,
  parsePeriod,
} from "../../src/lib/homebaseImport";

// Resolved from THIS file's location so the suite runs from any cwd. The
// compiled harness lives under .fixtures-build, so walk back to the source dir.
const REAL = readFileSync(
  join(__dirname, "../../../scripts/fixtures/data/homebase-df01-slice.csv"),
  "utf8"
);

/* -- against the real file ------------------------------------------------- */

test("the real export's preamble yields the shop and the period", () => {
  const plan = planImport(REAL);
  eq(plan.locationCode, "DF01", "from `DF01 HP` on line 1");
  eq(plan.periodStart, "2026-07-20");
  eq(plan.periodEnd, "2026-08-02");
});

test("totals rows and hyphen separators are NOT people", () => {
  const plan = planImport(REAL);
  no(plan.people.some((p) => p.name === "-"), 'no person called "-"');
  no(plan.people.some((p) => /^totals for/i.test(p.name)), "no person called Totals for…");
  ok(plan.people.length >= 1, "but the real employee is there");
  ok(plan.shifts.length >= 1, "and their shifts are");
});

test("the real rows parse into instants-in-waiting, with the meal", () => {
  const plan = planImport(REAL);
  const s = plan.shifts[0];
  ok(/^\d{4}-\d{2}-\d{2}$/.test(s.punchDate), "punch date is ISO");
  ok(s.clockInMinutes >= 0 && s.clockInMinutes < 1440, "clock-in is minutes of day");
  ok(s.payrollId !== null, "and the Payroll ID came through — it is employees.legacy_id");
  // Angelica's first shift is 12:15am → 8:28am with a 6:09–6:39am meal.
  eq(s.clockInMinutes, 15, "12:15am");
  eq(s.breakMinutes, 30);
});

test("Homebase does NOT split at midnight — the stitcher fires zero times", () => {
  // The brief's central premise, tested against the real file. Clock-in and
  // clock-out dates are separate columns and overnight shifts arrive whole.
  const plan = planImport(REAL);
  eq(plan.stitchedCount, 0);
  ok(plan.shifts.every((s) => !s.stitched), "no shift is marked stitched");
});

test("nothing in the real slice is refused", () => {
  eq(planImport(REAL).refused, []);
});

/* -- the primitives -------------------------------------------------------- */

test("dates in both shapes, and an unreal one refused", () => {
  eq(parseHomebaseDate("July 23 2026"), "2026-07-23");
  eq(parseHomebaseDate("August 2 2026"), "2026-08-02");
  eq(parseHomebaseDate("07/20/2026"), "2026-07-20");
  eq(parseHomebaseDate("February 31 2026"), null, "rolls over, so refused");
  eq(parseHomebaseDate("-"), null);
  eq(parseHomebaseDate(null), null);
});

test("times, including midnight and noon", () => {
  eq(parseHomebaseTime("12:15am"), 15);
  eq(parseHomebaseTime("12:00am"), 0, "midnight is 0, not 720");
  eq(parseHomebaseTime("12:00pm"), 720, "noon is 720, not 0");
  eq(parseHomebaseTime("8:28am"), 508);
  eq(parseHomebaseTime("10:07pm"), 1327);
  eq(parseHomebaseTime("-"), null);
});

test("the shop code is the first token of line 1", () => {
  eq(parseLocationCode("DF01 HP"), "DF01");
  eq(parseLocationCode("DF02 DTLA"), "DF02");
  // Anything unexpected comes back WHOLE rather than being guessed at, so the
  // screen can show what it found instead of silently picking a shop.
  eq(parseLocationCode("Somewhere Else"), "Somewhere Else");
  eq(parseLocationCode(undefined), null);
});

test("the payroll period is read from the file, not chosen by the uploader", () => {
  eq(parsePeriod(["Payroll Period", "07/20/2026 To 08/02/2026"]), {
    start: "2026-07-20",
    end: "2026-08-02",
  });
  eq(parsePeriod(["Payroll Period", "nothing here"]), { start: null, end: null });
});

/* -- synthetic cases the real file cannot show ----------------------------- */

const HEADER =
  "Name,Clock in date,Clock in time,Clock out date,Clock out time,Break start,Break end,Break length,Break type,Payroll ID,Role,Wage rate,Scheduled hours,Actual hours,Actual vs. scheduled,Total paid hours,Regular hours,Unpaid breaks,OT hours,Double OT,Spread of hours,Split shifts,Estimated wages,Cash tips,Credit tips,PTO,Blue law hours,FFCRA - paid sick,FFCRA - others,FFCRA - child,Holiday pay,No show reason,Employee note,Manager note";

function file(...rows: string[]): string {
  return ["DF01 HP", "Payroll Period,07/20/2026 To 08/02/2026", "", HEADER, ...rows].join("\n");
}
/** name, in-date, in-time, out-date, out-time, then the rest blank. */
function row(name: string, id: string, ind: string, int: string, outd: string, outt: string): string {
  const pad = new Array(34).fill("");
  pad[0] = name; pad[1] = ind; pad[2] = int; pad[3] = outd; pad[4] = outt; pad[9] = id;
  return pad.join(",");
}

test("a shift a source DID split at midnight is stitched back into one", () => {
  const plan = planImport(
    file(
      row("Eddy Salazar", "375", "July 20 2026", "10:00pm", "July 21 2026", "12:00am"),
      row("Eddy Salazar", "375", "July 21 2026", "12:00am", "July 21 2026", "6:00am")
    )
  );
  eq(plan.shifts.length, 1, "two segments became one shift");
  eq(plan.stitchedCount, 1);
  const s = plan.shifts[0];
  ok(s.stitched, "and it says so");
  eq(s.punchDate, "2026-07-20");
  eq(s.clockInMinutes, 1320, "10pm");
  eq(s.clockOutDate, "2026-07-21");
  eq(s.clockOutMinutes, 360, "6am — an eight-hour shift, which owes daily OT");
});

test("a zero-gap pair at 11pm is NOT stitched — it is a genuine double", () => {
  // The reason the test is "same instant AND local midnight" rather than
  // "zero gap". Merging these would invent one long shift out of two short ones.
  const plan = planImport(
    file(
      row("Ruby Mares", "560", "July 20 2026", "3:00pm", "July 20 2026", "11:00pm"),
      row("Ruby Mares", "560", "July 20 2026", "11:00pm", "July 21 2026", "2:00am")
    )
  );
  eq(plan.shifts.length, 2, "still two shifts");
  eq(plan.stitchedCount, 0);
});

test("two people who both clock out at midnight are not merged with each other", () => {
  const plan = planImport(
    file(
      row("Alice A", "1", "July 20 2026", "4:00pm", "July 21 2026", "12:00am"),
      row("Bob B", "2", "July 21 2026", "12:00am", "July 21 2026", "8:00am")
    )
  );
  eq(plan.shifts.length, 2, "different people, never stitched");
  eq(plan.stitchedCount, 0);
});

test("three segments joining at midnight is refused, not guessed at", () => {
  const plan = planImport(
    file(
      row("Long Shift", "9", "July 20 2026", "6:00pm", "July 21 2026", "12:00am"),
      row("Long Shift", "9", "July 21 2026", "12:00am", "July 22 2026", "12:00am"),
      row("Long Shift", "9", "July 22 2026", "12:00am", "July 22 2026", "6:00am")
    )
  );
  ok(plan.refused.some((r) => /24 hours/.test(r.why)), "refused and explained");
});

test("an unreadable row is refused BY LINE and the rest still import", () => {
  const plan = planImport(
    file(
      row("Good One", "1", "July 20 2026", "9:00am", "July 20 2026", "5:00pm"),
      row("Bad One", "2", "Jellyfish 40 2026", "9:00am", "July 20 2026", "5:00pm"),
      row("Good Two", "3", "July 21 2026", "9:00am", "July 21 2026", "5:00pm")
    )
  );
  eq(plan.shifts.length, 2, "the two good rows survive");
  eq(plan.refused.length, 1);
  eq(plan.refused[0].name, "Bad One");
  ok(plan.refused[0].line > 0, "and it names the line");
});

test("a shift with no clock-out is kept, not refused", () => {
  // Someone forgot to clock out. That is a real state, and 184 rows of the
  // FileMaker history have it. Refusing would lose the shift entirely.
  const plan = planImport(file(row("Forgot", "1", "July 20 2026", "9:00am", "", "")));
  eq(plan.shifts.length, 1);
  eq(plan.shifts[0].clockOutMinutes, null);
});

test("a file that is not a Homebase export says so rather than importing nothing", () => {
  const plan = planImport("some,other,csv\n1,2,3");
  eq(plan.shifts, []);
  ok(plan.refused.some((r) => /does not look like/.test(r.why)));
});

test("a bare `Totals` row is not a shift and not a failure", () => {
  // The real DF01 export ends with a grand-total row labelled just "Totals" —
  // no "for <name>". The first pass only caught "Totals for" and reported the
  // last line of every file as unreadable, which is a true statement about a
  // row that was never a shift.
  const plan = planImport(file(row("Real One", "1", "July 20 2026", "9:00am", "July 20 2026", "5:00pm"), "Totals"));
  eq(plan.shifts.length, 1);
  eq(plan.refused, []);
  no(plan.people.some((p) => /totals/i.test(p.name)), "and Totals is not a person");
});

test("a row with a date and NO punches is skipped, not refused", () => {
  // Homebase prints a row for a scheduled day nobody clocked in for — ten of
  // them in the real DF01 fortnight, mostly salaried people. Calling these
  // "rows this cannot read" is a false accusation about the file, and it buries
  // the rows that genuinely are unreadable among rows that are fine.
  const plan = planImport(file(row("Traci Trombino", "9", "July 20 2026", "", "July 20 2026", "")));
  eq(plan.shifts, []);
  eq(plan.refused, [], "not a failure");
  eq(plan.skipped.length, 1);
  eq(plan.skipped[0].name, "Traci Trombino");
  eq(plan.skipped[0].punchDate, "2026-07-20");
});

test("an unreadable TIME is still a refusal — the two are told apart", () => {
  const plan = planImport(file(row("Odd One", "1", "July 20 2026", "half past nine", "July 20 2026", "5:00pm")));
  eq(plan.skipped, [], "not merely empty");
  eq(plan.refused.length, 1);
  ok(/Unreadable clock-in time/.test(plan.refused[0].why));
});
