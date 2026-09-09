// The schedules list's order.
//
// The bug this file exists for (Mark, 2026-09-09): "changing the sort direction
// of the date column on the schedule list page doesn't actually change the sort
// direction". The GROUP led with a hardcoded direction, and inside a date band
// every row carries the same date — so the within-run comparison was a no-op
// and the arrow moved nothing. The default grouping is Date, so it was the
// first thing anybody would try.

import { sortSchedules, type SortableSchedule } from "../../src/lib/productionSchedule";
import { test, eq, ok } from "./harness";

function night(over: Partial<SortableSchedule> = {}): SortableSchedule {
  return {
    schedule_date: "2026-09-14",
    sellsCode: "DF01",
    kitchenCode: "DF01",
    source: "plan",
    lineCount: 10,
    parTotal: 100,
    countedLines: 0,
    printedAt: null,
    regenerations: 0,
    ...over,
  };
}

const MON = night({ schedule_date: "2026-09-14", sellsCode: "DF01" });
const TUE = night({ schedule_date: "2026-09-15", sellsCode: "DF02" });
const WED = night({ schedule_date: "2026-09-16", sellsCode: "DF01" });

const dates = (rows: SortableSchedule[]) => rows.map((r) => r.schedule_date);

/* -- the reported bug ------------------------------------------------------ */

test("grouped by date, sorting BY date turns the bands over", () => {
  const rows = [MON, TUE, WED];
  eq(dates(sortSchedules(rows, { key: "date", dir: "desc" }, "date")),
     ["2026-09-16", "2026-09-15", "2026-09-14"], "newest first");
  eq(dates(sortSchedules(rows, { key: "date", dir: "asc" }, "date")),
     ["2026-09-14", "2026-09-15", "2026-09-16"], "oldest first");
});

test("... and the two directions really differ", () => {
  // The regression in one line: before the fix both calls returned the same
  // array, because the group's lead was hardcoded and the within-run compare
  // was a no-op on rows that all share a date.
  const rows = [MON, TUE, WED];
  const desc = dates(sortSchedules(rows, { key: "date", dir: "desc" }, "date"));
  const asc = dates(sortSchedules(rows, { key: "date", dir: "asc" }, "date"));
  ok(desc.join() !== asc.join(), `desc ${desc.join()} vs asc ${asc.join()}`);
});

test("it is not special to dates — any grouping sorted by its own column flips", () => {
  const rows = [night({ kitchenCode: "DF01" }), night({ kitchenCode: "DF02" })];
  eq(sortSchedules(rows, { key: "kitchen", dir: "asc" }, "kitchen").map((r) => r.kitchenCode),
     ["DF01", "DF02"]);
  eq(sortSchedules(rows, { key: "kitchen", dir: "desc" }, "kitchen").map((r) => r.kitchenCode),
     ["DF02", "DF01"]);
});

/* -- what must NOT have changed -------------------------------------------- */

test("a group the sort does not name keeps its own lead: DATE bands newest first", () => {
  // "Most recent first" is what anybody means by a day, and an ascending band
  // would open the list on last month.
  const rows = [MON, TUE, WED];
  eq(dates(sortSchedules(rows, { key: "lines", dir: "asc" }, "date")),
     ["2026-09-16", "2026-09-15", "2026-09-14"], "still newest first");
  eq(dates(sortSchedules(rows, { key: "lines", dir: "desc" }, "date")),
     ["2026-09-16", "2026-09-15", "2026-09-14"], "and the column's direction does not touch it");
});

test("a group the sort does not name leads ASCENDING when it is not a date", () => {
  const rows = [night({ kitchenCode: "DF02" }), night({ kitchenCode: "DF01" })];
  eq(sortSchedules(rows, { key: "lines", dir: "desc" }, "kitchen").map((r) => r.kitchenCode),
     ["DF01", "DF02"], "a run is a table of contents, not the thing you sorted");
});

test("the chosen column still sorts WITHIN each run", () => {
  const rows = [
    night({ schedule_date: "2026-09-14", sellsCode: "DF01", lineCount: 5 }),
    night({ schedule_date: "2026-09-14", sellsCode: "DF02", lineCount: 9 }),
    night({ schedule_date: "2026-09-15", sellsCode: "DF01", lineCount: 1 }),
  ];
  const out = sortSchedules(rows, { key: "lines", dir: "desc" }, "date");
  eq(out.map((r) => `${r.schedule_date}:${r.lineCount}`),
     ["2026-09-15:1", "2026-09-14:9", "2026-09-14:5"],
     "newest band first, and biggest first inside the older one");
});

test("ungrouped, the column alone decides", () => {
  const rows = [MON, TUE, WED];
  eq(dates(sortSchedules(rows, { key: "date", dir: "asc" }, "none")),
     ["2026-09-14", "2026-09-15", "2026-09-16"]);
  eq(dates(sortSchedules(rows, { key: "date", dir: "desc" }, "none")),
     ["2026-09-16", "2026-09-15", "2026-09-14"]);
});

test("tiebreaks read ASCENDING whichever way the primary points", () => {
  // `lib/tableSort`'s rule and its reason: flipping a column reverses the order
  // you CHOSE, not the stable fallback used where that column cannot decide.
  const rows = [
    night({ sellsCode: "DF02", kitchenCode: "DF01", lineCount: 7 }),
    night({ sellsCode: "DF01", kitchenCode: "DF01", lineCount: 7 }),
  ];
  for (const dir of ["asc", "desc"] as const) {
    eq(sortSchedules(rows, { key: "lines", dir }, "none").map((r) => r.sellsCode),
       ["DF01", "DF02"], `tiebreak under ${dir}`);
  }
});

test("it does not mutate what it is given", () => {
  const rows = [WED, MON, TUE];
  const before = dates(rows);
  sortSchedules(rows, { key: "date", dir: "asc" }, "date");
  eq(dates(rows), before, "the caller's array is untouched");
});
