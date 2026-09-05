// The record book — `lib/recordSet`.

import { test, eq } from "./harness";
import { carryQuery, recordPosition } from "../../src/lib/recordSet";

const q = (s: string) => new URLSearchParams(s);

test("the book carries the current tab onto the next record", () => {
  // The published href is the LIST's — its breadcrumb stamp — and the tab is
  // the reader's; both survive.
  eq(
    carryQuery("/vendors/v-2?from=%2Fvendors&fromLabel=Vendors", q("tab=invoices&from=x"), ["tab"]),
    "/vendors/v-2?from=%2Fvendors&fromLabel=Vendors&tab=invoices",
  );
});

test("being on the default tab lands on the default tab", () => {
  // The default writes no parameter, so a `tab=` on the target is REMOVED
  // rather than left to win.
  eq(carryQuery("/vendors/v-2?tab=items", q(""), ["tab"]), "/vendors/v-2");
  eq(carryQuery("/vendors/v-2", q(""), ["tab"]), "/vendors/v-2", "nothing to add, nothing added");
});

test("only the named keys move — the trail stays the list's", () => {
  eq(
    carryQuery("/vendors/v-2?from=%2Fvendors", q("tab=items&from=%2Felsewhere&q=flour"), ["tab"]),
    "/vendors/v-2?from=%2Fvendors&tab=items",
  );
  eq(carryQuery("/vendors/v-2?tab=items", q("tab=info"), []), "/vendors/v-2?tab=items", "no keys, untouched");
});

test("recordPosition still walks the set as published", () => {
  const set = [
    { id: "a", href: "/x/a" },
    { id: "b", href: "/x/b" },
    { id: "c", href: "/x/c" },
  ];
  const p = recordPosition(set, "b")!;
  eq([p.index, p.total, p.previous, p.next, p.first, p.last], [2, 3, "/x/a", "/x/c", "/x/a", "/x/c"]);
  eq(recordPosition(set, "zzz"), null, "not in the set");
});
