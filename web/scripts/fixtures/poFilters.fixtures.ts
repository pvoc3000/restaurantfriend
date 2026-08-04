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
