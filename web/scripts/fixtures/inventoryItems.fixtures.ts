// The inventory item record's tab helpers — `lib/inventoryItems`, the vendor
// record's rules a third time.

import { test, eq, ok } from "./harness";
import { ITEM_TABS, ITEM_TAB_LABEL, parseItemTab, itemTabHref } from "../../src/lib/inventoryItems";

test("an unrecognised item tab shows the record", () => {
  eq(parseItemTab("vendor-items"), "vendor-items");
  eq(parseItemTab("purchase-history"), "purchase-history");
  eq(parseItemTab(undefined), "info");
  eq(parseItemTab("nonsense"), "info");
  eq(parseItemTab(["purchase-history", "info"]), "purchase-history");
});

test("every item tab is labelled", () => {
  for (const t of ITEM_TABS) ok(ITEM_TAB_LABEL[t], `${t} is labelled`);
});

test("the item's default tab writes no parameter and the trail carries through", () => {
  eq(itemTabHref("i-1", "info"), "/items/i-1");
  eq(itemTabHref("i-1", "purchase-history"), "/items/i-1?tab=purchase-history");
  eq(
    itemTabHref("i-1", "vendor-items", { from: "/items", fromLabel: "Inventory", tab: "info" }),
    "/items/i-1?from=%2Fitems&fromLabel=Inventory&tab=vendor-items",
  );
});
