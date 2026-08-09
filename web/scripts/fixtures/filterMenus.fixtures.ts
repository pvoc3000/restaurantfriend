// lib/filterMenus — the brain behind `ui/FilterMenus`, the row of popup menus
// that combine (Mark, 2026-08-09).
//
// The case to trust is the CONDITIONED COUNT, and specifically that a
// dimension is left out of its OWN arithmetic. Count a menu against its own
// current value and every option in it reads 0 except the one already chosen,
// which on screen looks exactly like the data having vanished — and it would
// look plausible, because the one you picked still reads correctly. Several
// cases below fail if that exclusion is removed.
//
// The rest pin the two rules the component leans on: the menus are an AND, and
// `FILTER_ALL` never reaches a dimension's own `matches`.

import {
  FILTER_ALL,
  activeFilterCount,
  applyListFilters,
  clearedFilters,
  filterCounts,
  filterHref,
  filterQuery,
  matchesDimension,
  parseFilterSearch,
  parseFilterValues,
  type FilterDimension,
} from "../../src/lib/filterMenus";
import { eq, test } from "./harness";

type Row = { name: string; kind: string; schedule: string | null; active: boolean };

const rows: Row[] = [
  { name: "Almonds", kind: "purchased", schedule: "WEEKLY", active: true },
  { name: "Bear Claw", kind: "made", schedule: "WEEKLY", active: true },
  { name: "Cocoa", kind: "purchased", schedule: "AB", active: true },
  { name: "Dish Soap", kind: "purchased", schedule: null, active: false },
  { name: "Egg Wash", kind: "made", schedule: null, active: true },
  { name: "Fryer Oil", kind: "manual", schedule: "DONUT", active: false },
];

const KIND: FilterDimension<Row> = {
  key: "kind",
  label: "Kind",
  options: [
    { value: "made", label: "Made" },
    { value: "purchased", label: "Purchased" },
    { value: "manual", label: "Manual" },
  ],
  matches: (r, v) => r.kind === v,
};

const SCHEDULE: FilterDimension<Row> = {
  key: "schedule",
  label: "Schedule",
  options: [
    { value: "DONUT", label: "Donut" },
    { value: "AB", label: "AB" },
    { value: "WEEKLY", label: "Weekly" },
    { value: "none", label: "None" },
  ],
  matches: (r, v) => (v === "none" ? r.schedule === null : r.schedule === v),
};

const STATUS: FilterDimension<Row> = {
  key: "active",
  label: "Status",
  options: [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ],
  matches: (r, v) => (v === "active" ? r.active : !r.active),
};

const DIMS = [STATUS, KIND, SCHEDULE];
const names = (list: Row[]) => list.map((r) => r.name);

// --- applyListFilters -------------------------------------------------------

test("no values at all → every row, nothing filtered", () => {
  eq(applyListFilters(rows, DIMS, {}).length, 6);
});

test("FILTER_ALL is the same as saying nothing", () => {
  eq(applyListFilters(rows, DIMS, { kind: FILTER_ALL, schedule: FILTER_ALL }).length, 6);
});

test("one menu narrows on its own dimension", () => {
  eq(names(applyListFilters(rows, DIMS, { kind: "made" })), ["Bear Claw", "Egg Wash"]);
});

test("TWO MENUS ARE AN AND, not an or — the whole point of the control", () => {
  eq(names(applyListFilters(rows, DIMS, { kind: "made", schedule: "WEEKLY" })), ["Bear Claw"]);
});

test("three menus combine, and an impossible combination is empty rather than wrong", () => {
  eq(applyListFilters(rows, DIMS, { active: "inactive", kind: "made", schedule: "AB" }), []);
});

test("null is reachable only through its own option, never through a value", () => {
  eq(names(applyListFilters(rows, DIMS, { schedule: "none" })), ["Dish Soap", "Egg Wash"]);
});

test("a value for a dimension that isn't declared is ignored, not obeyed", () => {
  // A stale key — from a URL, or a menu since removed — must not empty the list.
  eq(applyListFilters(rows, DIMS, { colour: "green" }).length, 6);
});

test("matchesDimension lets FILTER_ALL through without calling matches", () => {
  let called = false;
  const spy: FilterDimension<Row> = {
    ...KIND,
    matches: () => {
      called = true;
      return false;
    },
  };
  eq(matchesDimension(spy, rows[0], {}), true, "unset passes");
  eq(called, false, "and the predicate was never asked");
});

// --- filterCounts -----------------------------------------------------------

test("with nothing set, every option counts over the whole population", () => {
  const counts = filterCounts(rows, DIMS, {});
  eq(counts.kind.made, 2);
  eq(counts.kind.purchased, 3);
  eq(counts.kind.manual, 1);
  eq(counts.kind[FILTER_ALL], 6, "the All option carries the total");
});

test("A DIMENSION IS NOT COUNTED AGAINST ITSELF — its other options stay live", () => {
  // Kind is set to `made`. Its own menu must still say what the OTHER kinds
  // would give, or every option but the chosen one reads 0 and the menu looks
  // like it has lost its data.
  const counts = filterCounts(rows, DIMS, { kind: "made" });
  eq(counts.kind.purchased, 3, "purchased is still offered honestly");
  eq(counts.kind.manual, 1);
  eq(counts.kind[FILTER_ALL], 6);
});

test("but the OTHER menus do narrow to what the set one leaves", () => {
  const counts = filterCounts(rows, DIMS, { kind: "made" });
  eq(counts.schedule.WEEKLY, 1, "only Bear Claw is made AND weekly");
  eq(counts.schedule.none, 1, "only Egg Wash is made with no schedule");
  eq(counts.schedule.AB, 0, "nothing is made AND on AB");
  eq(counts.schedule[FILTER_ALL], 2, "All = the two made ones");
});

test("two set menus condition a third", () => {
  const counts = filterCounts(rows, DIMS, { active: "active", kind: "purchased" });
  eq(counts.schedule.WEEKLY, 1, "Almonds");
  eq(counts.schedule.AB, 1, "Cocoa");
  eq(counts.schedule.none, 0, "Dish Soap is purchased with no schedule but INACTIVE");
});

test("a zero-count option is reported as 0, never dropped", () => {
  // The vocabulary has to stay put as you filter, or the menu's contents jump
  // around and the option you were reaching for moves.
  const counts = filterCounts(rows, DIMS, { schedule: "DONUT" });
  eq(Object.keys(counts.kind).length, 4, "All plus the three kinds");
  eq(counts.kind.made, 0);
});

test("an empty row set counts zeros rather than throwing", () => {
  const counts = filterCounts([], DIMS, { kind: "made" });
  eq(counts.kind[FILTER_ALL], 0);
  eq(counts.schedule.WEEKLY, 0);
});

// --- the bar's own state ----------------------------------------------------

test("activeFilterCount counts only the menus actually saying something", () => {
  eq(activeFilterCount(DIMS, {}), 0);
  eq(activeFilterCount(DIMS, { kind: FILTER_ALL }), 0, "All is not a filter");
  eq(activeFilterCount(DIMS, { kind: "made" }), 1);
  eq(activeFilterCount(DIMS, { kind: "made", schedule: "AB", active: "active" }), 3);
});

test("clearedFilters puts every declared dimension back to All", () => {
  const cleared = clearedFilters(DIMS);
  eq(activeFilterCount(DIMS, cleared), 0);
  eq(applyListFilters(rows, DIMS, cleared).length, 6);
});

// --- the URL ----------------------------------------------------------------

test("an unfiltered view writes NO query, so the list keeps one address", () => {
  eq(filterQuery(DIMS, {}), "");
  eq(filterQuery(DIMS, { kind: FILTER_ALL }), "", "All is not worth a parameter");
  eq(filterHref("/elements", DIMS, {}), "/elements");
});

test("a set menu writes its key, and the search rides as q", () => {
  eq(filterQuery(DIMS, { kind: "made" }), "kind=made");
  eq(
    filterHref("/elements", DIMS, { kind: "made", schedule: "WEEKLY" }, "glaze"),
    "/elements?q=glaze&kind=made&schedule=WEEKLY"
  );
});

test("a blank or whitespace search writes nothing", () => {
  eq(filterQuery(DIMS, {}, "   "), "");
  eq(filterQuery(DIMS, {}, "glaze"), "q=glaze");
  eq(filterQuery(DIMS, {}, "  glaze  "), "q=glaze", "and it is trimmed");
});

test("a value for an UNDECLARED dimension never reaches the URL", () => {
  eq(filterQuery(DIMS, { colour: "green", kind: "made" }), "kind=made");
});

test("round trip: what is written is what is read back", () => {
  const values = { active: "active", kind: "purchased", schedule: "none" };
  const query = filterQuery(DIMS, values, "cocoa");
  const params = Object.fromEntries(new URLSearchParams(query));
  eq(parseFilterValues(DIMS, params), values);
  eq(parseFilterSearch(params), "cocoa");
});

test("A VALUE NO OPTION OFFERS IS DROPPED, not obeyed", () => {
  // ?kind=cheese would otherwise filter to nothing while the menu — which shows
  // a stored value even when it is off its own list — sat there reading
  // "cheese". Not filtering is the better answer to a mistyped link.
  eq(parseFilterValues(DIMS, { kind: "cheese" }), {});
  eq(parseFilterValues(DIMS, { kind: "cheese", schedule: "AB" }), { schedule: "AB" });
});

test("a parameter for a dimension that doesn't exist is ignored", () => {
  eq(parseFilterValues(DIMS, { colour: "green" }), {});
});

test("repeated parameters take the first, never the array", () => {
  // Next hands `?kind=made&kind=manual` over as an array; a raw array reaching
  // `matches` would compare an object to a string and quietly match nothing.
  eq(parseFilterValues(DIMS, { kind: ["made", "manual"] }), { kind: "made" });
  eq(parseFilterSearch({ q: ["a", "b"] }), "a");
});

test("an empty query parses to no filters at all", () => {
  eq(parseFilterValues(DIMS, {}), {});
  eq(parseFilterSearch({}), "");
  eq(activeFilterCount(DIMS, parseFilterValues(DIMS, {})), 0);
});
