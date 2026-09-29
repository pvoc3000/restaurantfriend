import { test, eq } from "./harness";
import { poLine, withCatalog } from "./factories";
import { billLinesFromOrder, headerFromReadings } from "../../src/lib/billFromOrder";
import type { InvoiceExtraction } from "../../src/lib/invoiceExtraction";

const reading = (id: string, over: Partial<InvoiceExtraction> = {}) => ({
  id,
  extraction: {
    vendor_name: "Chefs Warehouse",
    invoice_number: "73535581",
    invoice_date: "2026-09-22",
    invoice_total: 394.16,
    lines: [],
    notes: null,
    ...over,
  } as InvoiceExtraction,
});

test("a bill from an order bills what arrived, at the line's price", () => {
  const counted = poLine({ qty_ordered: 4, qty_received: 3, unit_price: 12.5, description: "Flour" });
  const uncounted = poLine({ qty_ordered: 2, qty_received: null, unit_price: 5 });
  const nothingCame = poLine({ qty_ordered: 6, qty_received: 0, unit_price: 9 });
  const bill = billLinesFromOrder("po-1", [counted, nothingCame, uncounted]);

  eq(bill.length, 2, "a line counted at 0 is left off");
  eq(bill[0].qty, 3, "received, not ordered, where it was counted");
  eq(bill[0].extended, 37.5, "and the charge follows it");
  eq(bill[1].qty, 2, "ordered where nobody counted");
  eq(bill.map((l) => l.line_no).join(","), "1,2", "numbered with no gap for the skipped line");
  eq(bill[0].purchase_order_item_id, counted.id, "each line names its PO line");
  eq(bill[1].purchase_order_id, "po-1", "and its order");
});

test("no price is an absence, not a free line", () => {
  const [line] = billLinesFromOrder("po-1", [poLine({ qty_ordered: 1, unit_price: null })]);
  eq(line.extended, null, "no extended without a price");
});

test("the description falls back to the catalog name", () => {
  const [line] = billLinesFromOrder("po-1", [
    withCatalog(poLine({ description: null, unit_price: 1 }), { name: "Sugar" }),
  ]);
  eq(line.description, "Sugar", "our name when the line has none");
});

test("THE BILL TAKES THE VENDOR'S NUMBER FROM THE ORDER'S READING — Mark, 2026-09-29", () => {
  // Closed, then the invoice attached and read: Generate Bill made a bill with
  // no number. This is the case that must keep its number.
  const got = headerFromReadings([reading("att-1", { terms: "Net 14" })]);
  eq(got.header?.invoice_number ?? null, "73535581", "the printed number");
  eq(got.header?.invoice_date ?? null, "2026-09-22", "the printed date");
  eq(got.header?.due_date ?? null, "2026-10-06", "due from the terms when none is printed");
  eq(got.header ? got.attachmentIds.join(",") : "", "att-1", "and the reading is the one filed");
});

test("two pages of one invoice fill each other's blanks and are both filed", () => {
  const got = headerFromReadings([
    reading("p1", { terms: null }),
    reading("p2", { invoice_number: "73535581 ", terms: "COD" }),
  ]);
  eq(got.header?.terms ?? null, "COD", "page two supplies what page one lacked");
  eq(got.header ? got.attachmentIds.join(",") : "", "p1,p2", "both pages");
});

test("two different invoices give no header, and say why", () => {
  const got = headerFromReadings([reading("a"), reading("b", { invoice_number: "999" })]);
  eq(got.header, null, "one bill cannot carry two numbers");
  eq(got.header === null && got.reason !== null, true, "the confirm has a reason to show");
});

test("a numberless reading is taken alone, never beside a numbered one", () => {
  const alone = headerFromReadings([reading("x", { invoice_number: null })]);
  eq(alone.header ? alone.attachmentIds.join(",") : "", "x", "alone it is the invoice");
  const beside = headerFromReadings([reading("n"), reading("x", { invoice_number: null })]);
  eq(beside.header ? beside.attachmentIds.join(",") : "", "n", "beside a numbered one, only that one");
});

test("a credit memo is never the header of a bill for the order's goods", () => {
  const got = headerFromReadings([reading("c", { is_credit: true })]);
  eq(got.header, null, "no header from a credit");
  eq(headerFromReadings([]).header, null, "and none from nothing");
});
