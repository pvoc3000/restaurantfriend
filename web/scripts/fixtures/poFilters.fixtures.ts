// The PO list's filter state — URL, then the session cookie, then defaults.
//
// These exist for one failure mode: every parser here FALLS BACK silently on a
// value it doesn't recognise. So a status the URL layer hasn't been taught
// about doesn't error, it quietly becomes "all" — the filter appears to do
// nothing, and the choice you just made unmakes itself.
//
// Since 2026-09-14 the status filter is a SET (empty = every status). The old
// roll-ups `open` and `all` still READ, so links and remembered views from
// before mean what they meant.

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

test("the default is every status: an empty set", () => {
  eq(DEFAULT_PO_FILTERS.status, []);
});

test("parsePoFilters: the old ?status=open reads as draft, sent and received", () => {
  eq(parsePoFilters({ status: "open" }).status, ["draft", "sent", "received"]);
});

test("parsePoFilters: the old ?status=all reads as every status", () => {
  eq(parsePoFilters({ status: "all" }, { status: ["draft"] }).status, []);
});

test("parsePoFilters: one raw status survives as a set of one", () => {
  eq(parsePoFilters({ status: "received" }).status, ["received"]);
});

test("parsePoFilters: several statuses survive, in the ladder's order", () => {
  eq(parsePoFilters({ status: ["closed", "draft"] }).status, ["draft", "closed"]);
});

test("parsePoFilters: unknown values beside real ones are dropped", () => {
  eq(parsePoFilters({ status: ["banana", "sent"] }).status, ["sent"]);
});

test("parsePoFilters: nonsense falls back rather than meaning every status", () => {
  eq(parsePoFilters({ status: "banana" }).status, DEFAULT_PO_FILTERS.status);
});

test("parsePoFilters: nonsense falls back to the REMEMBERED statuses, not the default", () => {
  eq(parsePoFilters({ status: "banana" }, { status: ["draft", "sent"] }).status, ["draft", "sent"]);
});

test("parsePoFilters: no status at all keeps what you were last looking at", () => {
  eq(parsePoFilters({}, { status: ["received"] }).status, ["received"]);
});

test("the session cookie round-trips a set", () => {
  const filters = { ...DEFAULT_PO_FILTERS, status: ["draft", "received"] as ("draft" | "received")[] };
  eq(parsePoView(serializePoView(filters)).status, ["draft", "received"]);
});

test("a pre-set cookie holding open still reads as the three open statuses", () => {
  eq(parsePoView("status=open&range=90").status, ["draft", "sent", "received"]);
});

test("a stale cookie holding a retired value is ignored", () => {
  eq(parsePoView("status=banana&range=90").status, undefined);
});

test("the URL repeats status per choice, and every status writes nothing", () => {
  eq(poFiltersToQuery({ ...DEFAULT_PO_FILTERS, status: ["draft", "sent"] }), "status=draft&status=sent");
  eq(poFiltersToQuery({ ...DEFAULT_PO_FILTERS, status: [] }), "");
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
