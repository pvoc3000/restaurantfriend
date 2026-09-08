// The vendor filter shared by the order guide, the PO list and the invoice
// list (Mark, 2026-09-08).
//
// Three rules carry the weight, and each fails silently if it is ever
// "simplified": an empty set means ALL rather than none; a chosen vendor stays
// in the picker even when the view holds none of its rows; and the options are
// counted over rows that have passed every OTHER control.

import { test, eq, ok } from "./harness";
import {
  appendVendorFilter,
  matchesVendorFilter,
  parseVendorFilter,
  vendorFilterOptions,
  MAX_VENDOR_FILTER,
} from "../../src/lib/vendorFilter";

test("an empty set means every vendor, never none", () => {
  ok(matchesVendorFilter("BakeMark", []), "a named vendor");
  // A row with no vendor at all survives too — nothing is being asked of it.
  ok(matchesVendorFilter(null, []), "no vendor");
});

test("a chosen set admits those vendors and nothing else", () => {
  const chosen = ["BakeMark", "Chefs Warehouse"];
  ok(matchesVendorFilter("BakeMark", chosen));
  ok(matchesVendorFilter("Chefs Warehouse", chosen));
  eq(matchesVendorFilter("Amoretti", chosen), false, "a vendor not chosen");
  // You asked for these vendors, and "no vendor" is not one of them.
  eq(matchesVendorFilter(null, chosen), false, "a row with no vendor");
  eq(matchesVendorFilter(undefined, chosen), false, "an absent embed");
});

test("names round-trip through a query, separator or not", () => {
  // REPEATED params rather than one comma-separated value, so a name holding
  // the separator needs no escaping scheme.
  const names = ["Smith, Jones & Co", "BakeMark"];
  const params = new URLSearchParams({ status: "open" });
  appendVendorFilter(params, names);
  const back = parseVendorFilter(new URLSearchParams(params.toString()).getAll("vendor"));
  eq(back, names);
});

test("a stale or hand-edited value is tolerated", () => {
  eq(parseVendorFilter(undefined), []);
  eq(parseVendorFilter(null), []);
  eq(parseVendorFilter(""), [], "one empty value");
  eq(parseVendorFilter(["BakeMark", "", "  ", "BakeMark"]), ["BakeMark"], "blanks and repeats");
  eq(parseVendorFilter("  BakeMark  "), ["BakeMark"], "trimmed");
  eq(parseVendorFilter("BakeMark"), ["BakeMark"], "a single value, not an array");
});

test("the cap is a fence against dropping a whole cookie", () => {
  const many = Array.from({ length: MAX_VENDOR_FILTER + 10 }, (_, i) => `Vendor ${i}`);
  eq(parseVendorFilter(many).length, MAX_VENDOR_FILTER);
  // And the cap applies on the way OUT too, or a cookie could be written that
  // its own parser would then truncate.
  const params = new URLSearchParams();
  appendVendorFilter(params, many);
  eq(params.getAll("vendor").length, MAX_VENDOR_FILTER);
});

test("options are the vendors in scope, counted, in name order", () => {
  const rows = ["Chefs Warehouse", "BakeMark", "Chefs Warehouse", null, "Amoretti", undefined];
  eq(vendorFilterOptions(rows, []), [
    { value: "Amoretti", label: "Amoretti", hint: "1" },
    { value: "BakeMark", label: "BakeMark", hint: "1" },
    { value: "Chefs Warehouse", label: "Chefs Warehouse", hint: "2" },
  ]);
});

test("names sort numeric-aware, like every other list in the app", () => {
  eq(
    vendorFilterOptions(["Vendor 10", "Vendor 2"], []).map((o) => o.label),
    ["Vendor 2", "Vendor 10"]
  );
});

test("a CHOSEN vendor is always listed, at 0, even with no rows in view", () => {
  // Narrow the window to Today and your vendor may have nothing in it. Dropping
  // the option would take the control off the screen while it was still
  // narrowing the list — an empty table, and nothing to untick.
  const options = vendorFilterOptions(["BakeMark"], ["Chefs Warehouse"]);
  eq(options, [
    { value: "BakeMark", label: "BakeMark", hint: "1" },
    { value: "Chefs Warehouse", label: "Chefs Warehouse", hint: "0" },
  ]);
});

test("a chosen vendor is listed ONCE, with its real count", () => {
  const options = vendorFilterOptions(["BakeMark", "BakeMark"], ["BakeMark"]);
  eq(options, [{ value: "BakeMark", label: "BakeMark", hint: "2" }]);
});
