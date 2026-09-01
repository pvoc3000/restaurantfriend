// billsFromReadings — what an order's paperwork BILLS, before any of it is
// filed.
//
// Filing moved to close (Mark, 2026-09-01: "I don't think an invoice document
// should be created automatically … it should be created only once a purchase
// order is reconciled and closed"), so an order being received now normally has
// documents READ and no invoice records behind them. Receiving used to lean on
// the filed records having been joined and unioned for it; these are the rules
// that do that work from the readings instead.
//
// The target is PARITY with what filing would have produced — see
// `filedInvoice.fixtures` for the join rule and `invoicePages.fixtures` for the
// page rule. If these two ever disagree with those, the screen and the record
// have started telling different stories about one delivery.

import { billsFromReadings } from "../../src/lib/invoices";
import type { InvoiceExtraction, InvoiceLine } from "../../src/lib/invoiceExtraction";
import { eq, test } from "./harness";

const line = (product_id: string, description: string, qty: number, price: number): InvoiceLine => ({
  product_id,
  description,
  qty,
  unit_price: price,
  extended: qty * price,
  pack: null,
});

const reading = (invoice_number: string | null, lines: InvoiceLine[]): InvoiceExtraction => ({
  vendor_name: "Chefs Warehouse",
  invoice_number,
  invoice_date: "2026-08-17",
  invoice_total: null,
  lines,
  notes: null,
});

const att = (over: Record<string, unknown> = {}) => ({
  kind: "invoice",
  extracted_at: "2026-08-17T10:00:00Z",
  extraction: reading("73535581", [line("A1", "OREO PIECES", 1, 56.44)]),
  ...over,
});

const skus = (bills: { lines: InvoiceLine[] }[]) =>
  bills.map((b) => b.lines.map((l) => l.product_id));

// ── the case the widening exists for ────────────────────────────────────────

test("two DIFFERENT invoices are two bills, and both are billing this delivery", () => {
  // The backorder: a delivery split across two invoices. Reconciling against
  // whichever was read last reports every line of the other as never billed.
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00", extraction: reading("111", [line("A", "APPLES", 1, 1)]) }),
    att({ extracted_at: "…11:00", extraction: reading("222", [line("B", "BUTTER", 1, 2)]) }),
  ]);
  eq(bills.length, 2, "two bills");
  eq(skus(bills), [["A"], ["B"]], "and every line of both is available to match");
});

test("the same invoice read TWICE is one bill, and its lines are not doubled", () => {
  // A re-taken photo, or "Read again" landing on a second attachment. Doubling
  // the lines is worse than useless: the matcher refuses a SKU that appears
  // twice, so every line would go unmatched.
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00" }),
    att({ extracted_at: "…11:00" }),
  ]);
  eq(bills.length, 1, "one bill");
  eq(skus(bills), [["A1"]], "one copy of its line");
});

test("two PAGES of one invoice are one bill holding the union", () => {
  // Chefs Warehouse 73535581 again, in the form receiving meets it. The totals
  // block prints on both pages, so both readings claim the same number.
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00", extraction: reading("73535581", [line("A", "OREO", 1, 1), line("B", "WALNUT", 1, 2)]) }),
    att({ extracted_at: "…11:00", extraction: reading("73535581", [line("C", "COKE", 1, 3)]) }),
  ]);
  eq(bills.length, 1, "one bill");
  eq(skus(bills), [["A", "B", "C"]], "holding both pages");
});

test("a page that repeats one line of another adds only what is new", () => {
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00", extraction: reading("9", [line("A", "OREO", 1, 1)]) }),
    att({ extracted_at: "…11:00", extraction: reading("9", [line("A", "OREO", 1, 1), line("B", "WALNUT", 1, 2)]) }),
  ]);
  eq(skus(bills), [["A", "B"]], "the repeat is dropped, the new line is kept");
});

test("one invoice printing the same item twice keeps both", () => {
  // A MULTISET, not a set — `unfiledLines`' rule, and the reason it is one.
  const twice = [line("A", "OREO", 1, 1), line("A", "OREO", 1, 1)];
  eq(skus(billsFromReadings([att({ extraction: reading("9", twice) })])), [["A", "A"]]);
});

// ── what never joins ────────────────────────────────────────────────────────

test("a reading with no printed number never joins anything", () => {
  // `filedInvoiceFor` refuses a numberless match for the same reason: there is
  // nothing to be confident on. Two numberless readings therefore read as two
  // bills — which is exactly what filing them would produce.
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00", extraction: reading(null, [line("A", "APPLES", 1, 1)]) }),
    att({ extracted_at: "…11:00", extraction: reading(null, [line("B", "BUTTER", 1, 2)]) }),
  ]);
  eq(bills.length, 2, "no join");
  eq(bills.map((b) => b.number), [null, null], "and neither claims a number");
});

test("punctuation is not a different invoice", () => {
  // `normalizeInvoiceNumber`, the same comparison the filed path joins on and
  // the printed-PO warning uses. Chefs Warehouse really does print spaces for
  // hyphens.
  const bills = billsFromReadings([
    att({ extracted_at: "…10:00", extraction: reading("132-181164-01", [line("A", "APPLES", 1, 1)]) }),
    att({ extracted_at: "…11:00", extraction: reading("132 181164 01", [line("B", "BUTTER", 1, 2)]) }),
  ]);
  eq(bills.length, 1, "one bill");
  eq(bills[0].number, "132-181164-01", "named as the FIRST page printed it");
});

// ── what is not a bill ──────────────────────────────────────────────────────

test("only an INVOICE is a bill, and only once it has been read", () => {
  eq(billsFromReadings([att({ kind: "packing_slip" })]).length, 0, "packing slip");
  eq(billsFromReadings([att({ kind: "photo" })]).length, 0, "photo");
  eq(billsFromReadings([att({ extraction: null })]).length, 0, "unread");
  eq(billsFromReadings([]).length, 0, "nothing attached");
});

// ── order ───────────────────────────────────────────────────────────────────

test("bills come in the order the documents were READ", () => {
  // So the pages of one invoice line up the way they were attached, and the
  // band's first bill is the first one somebody put on the order.
  const bills = billsFromReadings([
    att({ extracted_at: "2026-08-17T12:00:00Z", extraction: reading("222", [line("B", "BUTTER", 1, 2)]) }),
    att({ extracted_at: "2026-08-17T09:00:00Z", extraction: reading("111", [line("A", "APPLES", 1, 1)]) }),
  ]);
  eq(bills.map((b) => b.number), ["111", "222"], "earliest read first");
});

test("a reading that has never been stamped still sorts, and still counts", () => {
  // `extracted_at` is optional on the shape this takes; a null must not throw
  // and must not swallow the document.
  const bills = billsFromReadings([
    att({ extracted_at: null, extraction: reading("111", [line("A", "APPLES", 1, 1)]) }),
    att({ extracted_at: "2026-08-17T09:00:00Z", extraction: reading("222", [line("B", "BUTTER", 1, 2)]) }),
  ]);
  eq(bills.map((b) => b.number), ["111", "222"], "unstamped leads");
});
