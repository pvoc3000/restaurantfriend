// unfiledLines / blankHeaderFields — folding a second PAGE into an invoice that
// already exists, without folding a second COPY into it.
//
// The case is real and Mark found it (2026-08-27): Chefs Warehouse 73535581 at
// DF02 was scanned a page at a time and attached as two files. The totals block
// prints on every page, so each page read as the whole $394.16 bill and each
// became its own record — one holding 4 lines, the other 7, with /invoices
// showing $788.32 owed for a $394.16 invoice. The header rule joins them; these
// are what stop the join losing seven lines on the way.
//
// The numbers below are that invoice, transcribed from the live rows.

import { blankHeaderFields, unfiledLines } from "../../src/lib/invoices";
import { eq, test } from "./harness";

type Draft = {
  line_no: number | null;
  product_id: string | null;
  description: string | null;
  qty: number | null;
  unit_price: number | null;
  extended: number | null;
};

const draft = (
  line_no: number,
  product_id: string,
  description: string,
  qty: number,
  unit_price: number,
  extended: number
): Draft => ({ line_no, product_id, description, qty, unit_price, extended });

// Page one, as filed.
const PAGE_1: Draft[] = [
  draft(1, "1118156", "OREO COOKIE MEDIUM PIECES", 1, 56.44, 56.44),
  draft(2, "NW100B", "WALNUT PIECES", 1, 5.5, 27.5),
  draft(3, "NP105B", "PECAN PIECES", 1, 9.54, 47.7),
  draft(4, "SPC114", "SPC CINNAMON GROUND", 1, 50.82, 50.82),
];

// Page two, read separately.
const PAGE_2: Draft[] = [
  draft(1, "81655", "SODA COKE MEXICAN", 1, 51.23, 51.23),
  draft(2, "924170", "SARATOGA WATER STILL", 1, 30.79, 30.79),
  draft(3, "930705", "SAN PELLEGRINO WATER SPARKLING", 1, 34.45, 34.45),
  draft(4, "928229", "SYRUP CARAMEL MONIN", 1, 137.74, 11.48),
  draft(5, "VN186004", "SYRUP VANILLA MONIN", 1, 116.95, 9.75),
  draft(6, "10332287N", "CLOVER HALF AND HALF ORG", 2, 51.78, 8.63),
  draft(7, "10615236", "OATLY OAT MILK BARISTA", 1, 53.97, 53.97),
];

test("unfiledLines: a second PAGE is added, numbered after the first", () => {
  const added = unfiledLines(PAGE_1, PAGE_2);
  eq(added.length, 7, "every line on page two is new");
  eq(
    added.map((l) => l.line_no),
    [5, 6, 7, 8, 9, 10, 11],
    "numbering continues rather than colliding"
  );
  eq(PAGE_1.length + added.length, 11, "the record ends up holding the whole invoice");
});

test("unfiledLines: the SAME page again adds nothing", () => {
  eq(unfiledLines(PAGE_1, PAGE_1).length, 0, "identical re-read");
  // The way it really arrives: PostgREST hands numerics back as strings, so a
  // stored line and a freshly read one differ in type on every money column.
  const stored = PAGE_1.map((l) => ({
    ...l,
    qty: String(l.qty!.toFixed(3)),
    unit_price: String(l.unit_price!.toFixed(4)),
    extended: String(l.extended!.toFixed(2)),
  }));
  eq(unfiledLines(stored, PAGE_1).length, 0, "strings from the database still match");
});

test("unfiledLines: a rescan covering both pages adds only what is missing", () => {
  const added = unfiledLines(PAGE_1, [...PAGE_1, ...PAGE_2]);
  eq(added.length, 7, "page one is recognised, page two is added");
  eq(added[0].product_id, "81655", "and it is page two that lands");
});

test("unfiledLines: wording and case are not a different line", () => {
  const restated = [{ ...PAGE_1[0], description: "  oreo   cookie medium pieces " }];
  eq(unfiledLines(PAGE_1, restated).length, 0, "spacing and case");
});

test("unfiledLines: the same item printed twice is two lines, not one", () => {
  // A MULTISET, which is the case a set would get wrong in both directions.
  const twice = [PAGE_1[0], { ...PAGE_1[0], line_no: 2 }];
  eq(unfiledLines(twice, twice).length, 0, "both are already held");
  eq(unfiledLines([PAGE_1[0]], twice).length, 1, "one held, one still to add");
});

test("unfiledLines: nothing on file yet means everything is new", () => {
  eq(unfiledLines([], PAGE_2).map((l) => l.line_no), [1, 2, 3, 4, 5, 6, 7], "numbered from one");
});

test("blankHeaderFields: a later page fills blanks and revises nothing", () => {
  // The totals block routinely sits on the last page, so page one's record can
  // be missing figures page two has.
  const onFile = { invoice_number: "73535581", total: null, freight: null, terms: "NET 14" };
  const read = { invoice_number: "73535581", total: 394.16, freight: 8.95, terms: "NET 30" };
  eq(blankHeaderFields(onFile, read), { total: 394.16, freight: 8.95 }, "blanks only");
});

test("blankHeaderFields: a page that knows less takes nothing away", () => {
  const onFile = { total: 394.16, due_date: "2026-08-26" };
  eq(blankHeaderFields(onFile, { total: null, due_date: null }), {}, "nulls are not a patch");
});

test("blankHeaderFields: is_credit is a decision, never a blank to fill", () => {
  // `false` is a VALUE, not a blank — which the null test already handles, so
  // this pins the consequence rather than a rule of its own. It is here because
  // a special case for `is_credit` was written, and this is what showed it was
  // doing nothing.
  eq(blankHeaderFields({ is_credit: false }, { is_credit: true }), {}, "left alone");
});
