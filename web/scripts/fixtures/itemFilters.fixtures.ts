// `lib/itemFilters` — Last ordered as a range (2026-09-08).

import { test, eq } from "./harness";
import {
  DEFAULT_ITEM_FILTERS,
  itemFiltersToQuery,
  LAST_ORDERED_PRESETS,
  parseItemFilters,
} from "../../src/lib/itemFilters";
import { matchingPreset } from "../../src/lib/dateRange";

const TUE = "2026-09-08";
const by = (key: string) => LAST_ORDERED_PRESETS.find((p) => p.key === key)!;

test("the three age bands abut and All time is null", () => {
  eq(by("within1y").range(TUE), { from: "2025-09-08", to: TUE });
  eq(by("1to2y").range(TUE), { from: "2024-09-08", to: "2025-09-07" });
  eq(by("over2y").range(TUE), { from: "2000-01-01", to: "2024-09-07" });
  eq(by("all").range(TUE), null);
  // Every day is in exactly one band: the ends meet with no gap and no overlap.
  eq(by("1to2y").range(TUE)!.to < by("within1y").range(TUE)!.from, true);
  eq(by("over2y").range(TUE)!.to < by("1to2y").range(TUE)!.from, true);
  eq(matchingPreset(null, LAST_ORDERED_PRESETS, TUE)?.label, "All time");
});

test("the range rides the URL as from/to and half a pair is nothing", () => {
  eq(parseItemFilters({ from: "2025-09-08", to: TUE }).last, { from: "2025-09-08", to: TUE });
  eq(parseItemFilters({ from: "2025-09-08" }).last, null);
  eq(parseItemFilters({ stale: "never" }).last, null, "the old key is simply ignored");
  eq(itemFiltersToQuery({ ...DEFAULT_ITEM_FILTERS, last: { from: "2025-09-08", to: TUE } }), `from=2025-09-08&to=${TUE}`);
  eq(itemFiltersToQuery(DEFAULT_ITEM_FILTERS), "");
});
