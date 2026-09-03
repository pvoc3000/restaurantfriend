import { test, eq, ok } from "./harness";
import {
  handAmendment,
  amendedTotal,
  type InvoiceExtraction,
} from "../../src/lib/invoiceExtraction";

const line = (over: Record<string, unknown> = {}) => ({
  product_id: "11200",
  description: "WHIP TPNG NON DAIRY RTW",
  qty: 2,
  unit_price: 88.9,
  extended: 177.8,
  pack: "4/9#",
  ...over,
}) as InvoiceExtraction["lines"][number];

/** BakeMark 452660, as the reader actually saw it. */
const bakemark = {
  invoice_total: 1001.26,
  corrected_total: 823.46,
  lines: [
    line({ product_id: "08843", extended: 45, qty: 2, unit_price: 22.5 }),
    line({ product_id: "09391", extended: 71, qty: 2, unit_price: 35.5 }),
    line({ product_id: "09401", extended: 494.91, qty: 9, unit_price: 54.99 }),
    line({ product_id: "31654", extended: 164.6, qty: 2, unit_price: 82.3 }),
    line({ product_id: "58999", extended: null, qty: 1, unit_price: null, struck_through: true }),
    line({ product_id: "50021", extended: 47.95, qty: 1, unit_price: 47.95 }),
    line({ product_id: "11200", extended: 177.8, struck_through: true }),
  ],
} as unknown as InvoiceExtraction;

test("a page nobody wrote on is not an amendment", () => {
  eq(handAmendment({ lines: [line()], invoice_total: 177.8, corrected_total: null }), null, "clean");
  // Every reading stored before 2026-09-02 predates both fields, and must stay
  // valid rather than reading as an amended page.
  eq(
    handAmendment({ lines: [line()], invoice_total: 177.8 } as never),
    null,
    "an older reading carries neither field"
  );
});

test("the real BakeMark page: two strikes and a handwritten total", () => {
  const a = handAmendment(bakemark)!;
  ok(a, "amended");
  eq(a.struck.length, 2, "the cocoa and the topping");
  eq(a.printedTotal, 1001.26, "what was printed");
  eq(a.correctedTotal, 823.46, "what the driver wrote");
  // 45 + 71 + 494.91 + 164.6 + 47.95 — the topping and the cocoa come off.
  eq(a.remaining, 823.46, "and the lines left standing agree with him");
  eq(amendedTotal(a), 823.46, "so that is what is owed");
});

test("the handwritten figure wins over our arithmetic", () => {
  // If they disagree the PAGE is the record — it is what the driver and
  // whoever signed agreed at the door. Both are exposed so a screen can SAY
  // they differ rather than picking quietly.
  const odd = handAmendment({
    ...bakemark,
    corrected_total: 800,
  } as InvoiceExtraction)!;
  eq(odd.remaining, 823.46, "our sum");
  eq(odd.correctedTotal, 800, "their pen");
  eq(amendedTotal(odd), 800, "the pen wins");
});

test("a strike with no handwritten total still amends", () => {
  // The commonest shape: a line crossed out and no new total written.
  const a = handAmendment({
    invoice_total: 1001.26,
    corrected_total: null,
    lines: [
      line({ product_id: "08843", extended: 45 }),
      line({ product_id: "11200", extended: 177.8, struck_through: true }),
    ],
  } as unknown as InvoiceExtraction)!;
  ok(a, "still an amendment");
  eq(a.correctedTotal, null, "nothing written at the foot");
  eq(a.remaining, 45, "so the lines left standing decide");
  eq(amendedTotal(a), 45);
});

test("a handwritten total with nothing struck still amends", () => {
  // A driver who writes a new total without crossing a line — a short case, a
  // price agreed at the door. Refusing this because no line is struck would
  // hide the one number that changed.
  const a = handAmendment({
    invoice_total: 500,
    corrected_total: 450,
    lines: [line({ extended: 500 })],
  } as unknown as InvoiceExtraction)!;
  ok(a, "amended");
  eq(a.struck.length, 0);
  eq(amendedTotal(a), 450);
});
