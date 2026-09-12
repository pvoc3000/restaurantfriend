// The production item record's tab helpers — `lib/productionItems`, the
// inventory item record's rules a fourth time.

import { test, eq, ok } from "./harness";
import {
  PRODUCTION_ITEM_TABS,
  PRODUCTION_ITEM_TAB_LABEL,
  parseProductionItemTab,
  productionItemTabHref,
} from "../../src/lib/productionItems";

test("an unrecognised production item tab shows the record", () => {
  eq(parseProductionItemTab("costs"), "costs");
  eq(parseProductionItemTab("history"), "history");
  eq(parseProductionItemTab(undefined), "info");
  eq(parseProductionItemTab("nonsense"), "info");
  eq(parseProductionItemTab(["history", "info"]), "history");
});

test("every production item tab is labelled", () => {
  for (const t of PRODUCTION_ITEM_TABS) ok(PRODUCTION_ITEM_TAB_LABEL[t], `${t} is labelled`);
});

test("the production item's default tab writes no parameter and the trail carries through", () => {
  eq(productionItemTabHref("p-1", "info"), "/production-items/p-1");
  eq(productionItemTabHref("p-1", "history"), "/production-items/p-1?tab=history");
  eq(
    productionItemTabHref("p-1", "costs", {
      from: "/production-items",
      fromLabel: "Items",
      tab: "info",
    }),
    "/production-items/p-1?from=%2Fproduction-items&fromLabel=Items&tab=costs",
  );
});
