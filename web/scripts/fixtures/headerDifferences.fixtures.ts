import { test, eq } from "./harness";
import { headerDifferences } from "../../src/lib/bills";

const bill = (over: Record<string, unknown> = {}) =>
  ({
    invoice_number: "452660",
    invoice_date: "2026-09-01",
    due_date: "2026-09-15",
    terms: "Net 14",
    subtotal: 100,
    tax: null,
    freight: null,
    other_charges: null,
    total: 100,
    ...over,
  }) as never;
const reading = (over: Record<string, unknown> = {}) =>
  ({
    vendor_name: "BAKEMARK USA LLC",
    invoice_number: "452660",
    invoice_date: "2026-09-01",
    due_date: "2026-09-15",
    terms: "Net 14",
    subtotal: 100,
    tax: null,
    freight: null,
    other_charges: null,
    invoice_total: 100,
    lines: [],
    ...over,
  }) as never;
const columns = (b: never, r: never, hasLines = true) =>
  headerDifferences(b, r, { hasLines }).map((d) => d.column);

test("a bill that says what its page says has nothing to offer", () => {
  eq(columns(bill(), reading()), [], "with lines");
  eq(columns(bill(), reading(), false), [], "and without");
});

test("each header field is offered when the page prints something else", () => {
  const diffs = headerDifferences(
    bill(),
    reading({
      invoice_number: " 452661 ",
      invoice_date: "2026-09-02",
      due_date: "2026-09-16",
      terms: "Net 30",
      tax: 4.5,
      freight: 12,
      other_charges: -15.31,
    }),
    { hasLines: true }
  );
  eq(
    diffs.map((d) => [d.column, d.current, d.printed]),
    [
      ["invoice_number", "452660", "452661"],
      ["invoice_date", "2026-09-01", "2026-09-02"],
      ["due_date", "2026-09-15", "2026-09-16"],
      ["terms", "Net 14", "Net 30"],
      ["tax", null, 4.5],
      ["freight", null, 12],
      // Other is signed as printed (091) — a credit at the foot stays negative.
      ["other_charges", null, -15.31],
    ],
    "in the screen's own order"
  );
});

test("a field the page does not print is never offered", () => {
  // The 2026-09-03 case: the reader missed a $15.31 credit and it was typed
  // into Other by hand. Null means not printed, so it is left alone.
  eq(
    columns(
      bill({ other_charges: -15.31, tax: 3, due_date: "2026-09-20", terms: "COD" }),
      reading({ other_charges: null, tax: null, due_date: null, terms: null, invoice_number: null })
    ),
    [],
    "nothing printed, nothing offered"
  );
  eq(columns(bill(), reading({ due_date: "not a date" })), [], "an unreadable date is not printed");
});

test("an empty charge and a printed zero agree", () => {
  eq(columns(bill(), reading({ tax: 0, freight: 0 })), [], "null against $0.00");
  eq(columns(bill({ tax: 4.5 }), reading({ tax: 4.504 })), [], "inside a cent");
});

test("subtotal and total are offered only while the bill has no lines", () => {
  const r = reading({ subtotal: 90, invoice_total: 95 });
  eq(columns(bill(), r, true), [], "computed from the lines, so not ours to offer");
  eq(columns(bill(), r, false), ["subtotal", "total"], "typed, so offered");
  eq(
    headerDifferences(bill(), reading({ invoice_total: 1001.26, corrected_total: 823.46 }), {
      hasLines: false,
    }).map((d) => d.printed),
    [823.46],
    "the handwritten total is the one offered"
  );
});

test("a credit reading's negatives are magnitudes on the record", () => {
  eq(
    columns(
      bill({ tax: 4.5, other_charges: 2 }),
      reading({ is_credit: true, subtotal: -100, tax: -4.5, other_charges: -2, invoice_total: -106.5 })
    ),
    [],
    "the same figures, the other direction"
  );
});
