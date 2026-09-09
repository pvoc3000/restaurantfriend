// `lib/invoiceFilters` — the window as a RangePicker (2026-09-08), sharing
// the PO list's presets so the two lists cannot drift on "90 days".

import { test, eq } from "./harness";
import {
  DEFAULT_INVOICE_FILTERS,
  invoiceFiltersToQuery,
  parseInvoiceFilters,
  parseInvoiceView,
  serializeInvoiceView,
} from "../../src/lib/invoiceFilters";

test("a preset key, a custom pair, and half a pair", () => {
  eq(parseInvoiceFilters({ range: "7" }).range, "7");
  eq(parseInvoiceFilters({ from: "2026-08-01", to: "2026-08-31" }).range, { from: "2026-08-01", to: "2026-08-31" });
  eq(parseInvoiceFilters({ from: "2026-08-01" }).range, DEFAULT_INVOICE_FILTERS.range);
  eq(parseInvoiceFilters({ range: "0", from: "2026-08-01", to: "2026-08-31" }).range, "0", "a key wins");
});

test("the URL writes range= for a key and from/to for a pair, nothing for the default", () => {
  eq(invoiceFiltersToQuery({ ...DEFAULT_INVOICE_FILTERS, range: "all" }), "range=all");
  eq(invoiceFiltersToQuery({ ...DEFAULT_INVOICE_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } }), "from=2026-08-01&to=2026-08-31");
  eq(invoiceFiltersToQuery(DEFAULT_INVOICE_FILTERS), "");
});

test("the session cookie round-trips both, and a pre-picker cookie still reads", () => {
  const custom = { ...DEFAULT_INVOICE_FILTERS, range: { from: "2026-08-01", to: "2026-08-31" } };
  eq(parseInvoiceView(serializeInvoiceView(custom)).range, custom.range);
  eq(parseInvoiceView("status=open&aging=all&range=90&sort=due_date&dir=asc").range, "90");
  eq(parseInvoiceView("range=banana").range, undefined);
});
