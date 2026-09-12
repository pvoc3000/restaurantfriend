// The location record's tab helpers — `lib/locations`, the production item
// record's rules a fifth time.

import { test, eq, ok } from "./harness";
import {
  LOCATION_TABS,
  LOCATION_TAB_LABEL,
  parseLocationTab,
  locationTabHref,
} from "../../src/lib/locations";

test("an unrecognised location tab shows the record", () => {
  eq(parseLocationTab("addresses"), "addresses");
  eq(parseLocationTab("operations"), "operations");
  eq(parseLocationTab(undefined), "info");
  eq(parseLocationTab("nonsense"), "info");
  eq(parseLocationTab(["operations", "info"]), "operations");
});

test("every location tab is labelled", () => {
  for (const t of LOCATION_TABS) ok(LOCATION_TAB_LABEL[t], `${t} is labelled`);
});

test("the location's default tab writes no parameter and the trail carries through", () => {
  eq(locationTabHref("l-1", "info"), "/locations/l-1");
  eq(locationTabHref("l-1", "operations"), "/locations/l-1?tab=operations");
  eq(
    locationTabHref("l-1", "addresses", {
      from: "/locations",
      fromLabel: "Locations",
      tab: "info",
    }),
    "/locations/l-1?from=%2Flocations&fromLabel=Locations&tab=addresses",
  );
});
