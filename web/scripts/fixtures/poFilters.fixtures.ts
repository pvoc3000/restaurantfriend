// The PO list's filter state — URL, then the session cookie, then defaults.
//
// These exist for one failure mode: every parser here FALLS BACK silently on a
// value it doesn't recognise. So a status the URL layer hasn't been taught
// about doesn't error, it quietly becomes "all" — the filter appears to do
// nothing, and the chip you just pressed unpresses itself. `open` is a roll-up
// rather than a column value, which is exactly the kind of thing a validator
// written against the status list forgets.

import { isPoOpen } from "../../src/lib/purchaseOrders";
import {
  DEFAULT_PO_FILTERS,
  parsePoFilters,
  parsePoView,
  serializePoView,
} from "../../src/lib/poFilters";
import { eq, no, ok, test } from "./harness";

test("isPoOpen: outstanding work is draft, sent, received", () => {
  ok(isPoOpen("draft"), "draft");
  ok(isPoOpen("sent"), "sent");
  ok(isPoOpen("received"), "received");
});

test("isPoOpen: closed and void are inert, not open", () => {
  no(isPoOpen("closed"), "closed");
  // Void hasn't been "closed" either, and is emphatically not open work.
  no(isPoOpen("void"), "void");
});

test("parsePoFilters: ?status=open survives", () => {
  eq(parsePoFilters({ status: "open" }).status, "open");
});

test("parsePoFilters: a raw status still survives", () => {
  eq(parsePoFilters({ status: "received" }).status, "received");
});

test("parsePoFilters: nonsense falls back rather than sticking", () => {
  eq(parsePoFilters({ status: "banana" }).status, DEFAULT_PO_FILTERS.status);
});

test("parsePoFilters: nonsense falls back to the REMEMBERED status, not the default", () => {
  eq(parsePoFilters({ status: "banana" }, { status: "open" }).status, "open");
});

test("parsePoFilters: no status at all keeps what you were last looking at", () => {
  eq(parsePoFilters({}, { status: "open" }).status, "open");
});

test("the session cookie round-trips open", () => {
  const filters = { ...DEFAULT_PO_FILTERS, status: "open" as const };
  eq(parsePoView(serializePoView(filters)).status, "open");
});

test("a stale cookie holding a retired value is ignored", () => {
  eq(parsePoView("status=banana&range=90").status, undefined);
});

/* -- the window as a RangePicker (2026-09-08) ---------------------------- */

import { poRangeBounds, poRangeFromPicker, poFiltersToQuery } from "../../src/lib/poFilters";

const TUE = "2026-09-08";

test("a preset key resolves to a window THROUGH today; all time to null", () => {
  eq(poRangeBounds("0", TUE), { from: TUE, to: TUE });
  eq(poRangeBounds("7", TUE), { from: "2026-09-01", to: TUE });
  eq(poRangeBounds("90", TUE), { from: "2026-06-10", to: TUE });
  eq(poRangeBounds("all", TUE), null);
  eq(poRangeBounds({ from: "2026-08-01", to: "2026-08-31" }, TUE), { from: "2026-08-01", to: "2026-08-31" });
});

test("a picked pair that IS a preset is stored by key, so it moves with the calendar", () => {
  eq(poRangeFromPicker({ from: "2026-06-10", to: TUE }, TUE), "90");
  eq(poRangeFromPicker({ from: TUE, to: TUE }, TUE), "0");
  eq(poRangeFromPicker(null, TUE), "all");
  eq(poRangeFromPicker({ from: "2026-08-01", to: "2026-08-31" }, TUE), { from: "2026-08-01", to: "2026-08-31" });
});

test("a custom pair rides the URL as from/to and a key as range", () => {
  const custom = { ...DEFAULT_PO_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } };
  eq(poFiltersToQuery(custom), "from=2026-08-01&to=2026-08-31");
  eq(poFiltersToQuery({ ...DEFAULT_PO_FILTERS, range: "all" }), "range=all");
  eq(poFiltersToQuery(DEFAULT_PO_FILTERS), "", "the default writes nothing");
  eq(parsePoFilters({ from: "2026-08-01", to: "2026-08-31" }).range, { from: "2026-08-01", to: "2026-08-31" });
  eq(parsePoFilters({ from: "2026-08-01" }).range, DEFAULT_PO_FILTERS.range, "half a pair is nothing");
  eq(parsePoFilters({ range: "7", from: "2026-08-01", to: "2026-08-31" }).range, "7", "a key wins");
});

test("the session cookie round-trips a custom pair and a key", () => {
  const custom = { ...DEFAULT_PO_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } };
  eq(parsePoView(serializePoView(custom)).range, custom.range);
  eq(parsePoView(serializePoView({ ...DEFAULT_PO_FILTERS, range: "7" })).range, "7");
  eq(parsePoView("status=open&range=90").range, "90", "a pre-picker cookie still means 90 days");
});
