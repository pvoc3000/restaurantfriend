// lib/columnVisibility — the tri-state visibility decision (Mark's iPad
// report, 2026-08-01): explicitly hidden, explicitly shown, or untouched, with
// only the untouched falling to the responsive compact default.
//
// The case that matters most is the one Mark actually hit: a `hideWhenCompact`
// column on a narrow screen, untouched — invisible — and then explicitly
// checked, which must WIN over the width tier. Before the fix that check was
// a no-op, which is what made per-device settings read like account sync.

import { isColumnVisible } from "../../src/lib/columnVisibility";
import { no, ok, test } from "./harness";

const none: ReadonlySet<string> = new Set();
const set = (...keys: string[]): ReadonlySet<string> => new Set(keys);

test("untouched column on a wide screen shows", () => {
  ok(isColumnVisible({ key: "a" }, false, none, none));
});

test("explicit hide wins on a wide screen", () => {
  no(isColumnVisible({ key: "a" }, false, set("a"), none));
});

test("compact drops an untouched hideWhenCompact column", () => {
  no(isColumnVisible({ key: "a", hideWhenCompact: true }, true, none, none));
});

test("explicit show beats the compact drop — Mark's iPad case", () => {
  ok(isColumnVisible({ key: "a", hideWhenCompact: true }, true, none, set("a")));
});

test("explicit hide beats an explicit show, defensively", () => {
  // setVisible keeps the two sets disjoint; if storage ever disagrees, the
  // column had better not flicker in.
  no(isColumnVisible({ key: "a" }, false, set("a"), set("a")));
});

test("compact leaves unmarked columns alone", () => {
  ok(isColumnVisible({ key: "a" }, true, none, none));
});

test("a shown entry is inert on a wide screen", () => {
  ok(isColumnVisible({ key: "a", hideWhenCompact: true }, false, none, set("a")));
});

test("explicit hide also works under compact", () => {
  no(isColumnVisible({ key: "a" }, true, set("a"), none));
});

test("pinned shows regardless of everything", () => {
  ok(isColumnVisible({ key: "a", pinned: true, hideWhenCompact: true }, true, set("a"), none));
});
