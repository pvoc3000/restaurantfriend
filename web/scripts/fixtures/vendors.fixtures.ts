// The vendor record's tab helpers — `lib/vendors`.
//
// The same three rules the employee record's tabs are pinned by, because the
// two are one pattern and the fixtures are what stop the second copy drifting
// from the first.

import { test, eq, ok } from "./harness";
import {
  VENDOR_TABS,
  VENDOR_TAB_LABEL,
  parseVendorTab,
  vendorTabHref,
} from "../../src/lib/vendors";

test("an unrecognised tab shows the record rather than an error", () => {
  eq(parseVendorTab("items"), "items");
  eq(parseVendorTab(undefined), "info", "no parameter");
  eq(parseVendorTab("nonsense"), "info", "a stale bookmark");
  eq(parseVendorTab(["items", "info"]), "items", "a repeated parameter takes the first");
});

test("every tab is labelled", () => {
  for (const t of VENDOR_TABS) ok(VENDOR_TAB_LABEL[t], `${t} is labelled`);
});

test("the default tab writes no parameter, so the record keeps one address", () => {
  // Otherwise every link already stored — the vendor list's rows, the found
  // set, the order guide's vendor links, a pasted URL — would point at
  // something that isn't canonical.
  eq(vendorTabHref("v-1", "info"), "/vendors/v-1");
  eq(vendorTabHref("v-1", "items"), "/vendors/v-1?tab=items");
});

test("switching tabs carries the breadcrumb trail through", () => {
  // Drop `from` here and moving between tabs silently strips the trail that led
  // to the record, which also costs the record book its found set.
  eq(
    vendorTabHref("v-1", "items", { from: "/vendors", fromLabel: "Vendors" }),
    "/vendors/v-1?from=%2Fvendors&fromLabel=Vendors&tab=items",
    "params kept, tab appended",
  );
  eq(
    vendorTabHref("v-1", "info", { from: "/vendors", fromLabel: "Vendors" }),
    "/vendors/v-1?from=%2Fvendors&fromLabel=Vendors",
    "and no tab= on the default",
  );
});

test("the old tab is replaced, never appended twice", () => {
  eq(vendorTabHref("v-1", "items", { tab: "items" }), "/vendors/v-1?tab=items");
  eq(vendorTabHref("v-1", "info", { tab: "items" }), "/vendors/v-1", "back to the default drops it");
});
