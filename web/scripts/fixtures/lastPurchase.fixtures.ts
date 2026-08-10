// lastPurchaseLabel — the order guide's item header answering "when did we last
// buy this, and as what" (Mark, 2026-08-10).
//
// The case worth pinning hardest is the NEVER one. The label is rendered on
// every item header on the walk, so "never ordered here" is a claim the guide
// makes hundreds of times a day, and it has to mean exactly what migration
// 048's view means: no non-void purchase AT THIS LOCATION. Dropping the
// qualifier, or rendering an empty string, are both worse than they look —
// see the assertions below.

import { lastPurchaseLabel, type LastPurchase } from "../../src/lib/orderGuide";
import { eq, test } from "./harness";

const base: LastPurchase = {
  item_location_id: "il-1",
  last_order_date: "2026-08-04",
  vendor_item_id: "vi-1",
  vendor_name: "Chefs Warehouse",
  vendor_item_description: "ORG BLACKBERRY 6/6OZ",
  brand: null,
  package_desc: null,
  package_content: null,
  pack_count: null,
  pack_size: null,
  pack_unit: null,
};

test("lastPurchaseLabel: date, vendor, and what it was bought as", () => {
  eq(
    lastPurchaseLabel(base, "Blackberries, Fresh", "oz"),
    "last 2026-08-04 · Chefs Warehouse · ORG BLACKBERRY 6/6OZ",
    "described"
  );
});

test("lastPurchaseLabel: an undescribed purchase composes, it doesn't go blank", () => {
  // Same rule the guide's own lines follow — 100 of DF01's Monday lines have no
  // vendor description, and a header that named the vendor but not the product
  // would be the em-dash problem moved up a row.
  eq(
    lastPurchaseLabel(
      { ...base, vendor_item_description: null, brand: "Giustos", pack_count: 1, pack_size: 50, pack_unit: "lbs" },
      "Flour, Cake",
      "lbs"
    ),
    "last 2026-08-04 · Chefs Warehouse · Flour, Cake // Giustos // 1 × 50 lbs",
    "composed source"
  );
});

test("lastPurchaseLabel: NEVER says so, and says HERE", () => {
  // "here" is load-bearing, not padding. The view is location-scoped, so an
  // item bought weekly at the other shop reads as never bought on this one —
  // and "never ordered" without the qualifier is a claim about the ORG that
  // this data cannot support.
  eq(lastPurchaseLabel(undefined, "Flour, Cake", "lbs"), "never ordered here", "no row");
});

test("lastPurchaseLabel: never returns an empty string", () => {
  // An empty header is indistinguishable from the migration not being applied,
  // which is exactly the confusion the caller suppresses the label to avoid —
  // it can only do that if the label itself is never silent.
  const cases: Array<LastPurchase | undefined> = [
    undefined,
    base,
    { ...base, vendor_name: null },
    { ...base, vendor_item_description: null },
    { ...base, vendor_name: null, vendor_item_description: null },
  ];
  for (const c of cases) {
    const label = lastPurchaseLabel(c, "Flour, Cake", "lbs");
    eq(label.length > 0, true, JSON.stringify(c?.vendor_name ?? "none"));
  }
});

test("lastPurchaseLabel: an empty slot COLLAPSES rather than leaving a bare separator", () => {
  // " ·  · " reads as missing data where an absent field should read as an
  // absent field — slashLabel's rule, applied to the same problem one level up.
  eq(
    lastPurchaseLabel({ ...base, vendor_name: null }, "Flour, Cake", "lbs"),
    "last 2026-08-04 · ORG BLACKBERRY 6/6OZ",
    "no vendor name"
  );
  eq(
    lastPurchaseLabel(
      { ...base, vendor_name: null, vendor_item_description: null },
      "Flour, Cake",
      "lbs"
    ),
    "last 2026-08-04 · Flour, Cake",
    "nothing but the item name"
  );
});
