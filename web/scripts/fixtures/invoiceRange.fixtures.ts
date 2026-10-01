// `lib/invoiceRange` — the customer invoice list's Issued window, and the
// `from..to` token it shares with the special order list (`lib/dateRange`).

import { test, eq, ok } from "./harness";
import { parseRangeToken, rangeToken } from "../../src/lib/dateRange";
import {
  DEFAULT_INVOICE_RANGE,
  inInvoiceRange,
  invoiceRangeBounds,
  invoiceRangeToken,
  isInvoiceRangeToken,
} from "../../src/lib/invoiceRange";

const TODAY = "2026-10-01";

test("all time is the resting view, and it hides nothing", () => {
  eq(DEFAULT_INVOICE_RANGE, "all");
  eq(invoiceRangeBounds("all", TODAY), null);
  eq(invoiceRangeBounds(undefined, TODAY), null);
  ok(inInvoiceRange("2019-03-04", null), "an old overdue invoice stays on the list");
});

test("an unreadable token is all time, not an empty list", () => {
  eq(invoiceRangeBounds("whenever", TODAY), null);
  eq(invoiceRangeBounds("2026-13-45..2026-14-01", TODAY), null);
  eq(isInvoiceRangeToken("whenever"), false);
});

test("last month is the calendar month", () => {
  const b = invoiceRangeBounds("last_month", TODAY);
  eq(b?.from, "2026-09-01");
  eq(b?.to, "2026-09-30");
  ok(inInvoiceRange("2026-09-30", b));
  eq(inInvoiceRange(TODAY, b), false);
});

test("a picked pair that IS a preset is stored by key; one that is not, as itself", () => {
  eq(invoiceRangeToken({ from: "2026-09-01", to: "2026-09-30" }, TODAY), "last_month");
  eq(invoiceRangeToken({ from: "2026-09-03", to: "2026-09-10" }, TODAY), "2026-09-03..2026-09-10");
  eq(invoiceRangeToken(null, TODAY), "all");
  ok(isInvoiceRangeToken("2026-09-03..2026-09-10"));
  eq(invoiceRangeBounds("2026-09-03..2026-09-10", TODAY)?.to, "2026-09-10");
});

test("the shared token: round trip, backwards is a range, a fake date is not", () => {
  const r = { from: "2026-09-03", to: "2026-09-10" };
  eq(parseRangeToken(rangeToken(r))?.from, r.from);
  eq(parseRangeToken("2026-09-10..2026-09-03")?.from, "2026-09-03");
  eq(parseRangeToken("2026-02-31..2026-03-01"), null);
  eq(parseRangeToken("last_month"), null);
});
