// `lib/billFilters` — the window as a RangePicker (2026-09-08), sharing
// the PO list's presets so the two lists cannot drift on "90 days".

import { test, eq } from "./harness";
import {
  DEFAULT_BILL_FILTERS,
  billFiltersToQuery,
  parseBillFilters,
  parseBillView,
  serializeBillView,
} from "../../src/lib/billFilters";

test("a preset key, a custom pair, and half a pair", () => {
  eq(parseBillFilters({ range: "7" }).range, "7");
  eq(parseBillFilters({ from: "2026-08-01", to: "2026-08-31" }).range, { from: "2026-08-01", to: "2026-08-31" });
  eq(parseBillFilters({ from: "2026-08-01" }).range, DEFAULT_BILL_FILTERS.range);
  eq(parseBillFilters({ range: "0", from: "2026-08-01", to: "2026-08-31" }).range, "0", "a key wins");
});

test("the URL writes range= for a key and from/to for a pair, nothing for the default", () => {
  eq(billFiltersToQuery({ ...DEFAULT_BILL_FILTERS, range: "all" }), "range=all");
  eq(billFiltersToQuery({ ...DEFAULT_BILL_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } }), "from=2026-08-01&to=2026-08-31");
  eq(billFiltersToQuery(DEFAULT_BILL_FILTERS), "");
});

test("the session cookie round-trips both, and a pre-picker cookie still reads", () => {
  const custom = { ...DEFAULT_BILL_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } };
  eq(parseBillView(serializeBillView(custom)).range, custom.range);
  eq(parseBillView("status=open&aging=all&range=90&sort=due_date&dir=asc").range, "90");
  eq(parseBillView("range=banana").range, undefined);
});
