// Fixtures for lib/invoiceExtraction's `invoiceDeliveryDate` — the date the
// receiving screen offers as the order's delivery date.
//
// The value goes into `purchase_orders.delivery_date`, a `date` column, so the
// cases that matter most are the ones that must return NOTHING: the json_schema
// holds the model to a string and says nothing about its shape, and an
// unchecked value comes back as a raw Postgres error while someone is standing
// at a delivery holding paper.

import {
  invoiceDeliveryDate,
  matchableSku,
  type InvoiceExtraction,
  type InvoiceLine,
} from "../../src/lib/invoiceExtraction";
import { eq, test } from "./harness";

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  product_id: null,
  description: "",
  qty: null,
  unit_price: null,
  extended: null,
  pack: null,
  ...over,
});

function extraction(over: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    vendor_name: "Chefs' Warehouse",
    invoice_number: "73341407",
    invoice_date: null,
    invoice_total: null,
    lines: [],
    notes: null,
    ...over,
  };
}

// ── Which date wins ─────────────────────────────────────────────────────────

test("a ship date is the answer", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "2026-08-01" })), {
    date: "2026-08-01",
    source: "ship",
  });
});

test("the ship date beats the invoice date, and says which it is", () => {
  eq(
    invoiceDeliveryDate(
      extraction({ ship_date: "2026-08-01", invoice_date: "2026-08-03" })
    ),
    { date: "2026-08-01", source: "ship" }
  );
});

test("with no ship date the invoice date is offered, marked as the weaker claim", () => {
  eq(invoiceDeliveryDate(extraction({ invoice_date: "2026-08-03" })), {
    date: "2026-08-03",
    source: "invoice",
  });
});

test("neither date printed offers nothing", () => {
  eq(invoiceDeliveryDate(extraction()), null);
});

// An invoice read before 2026-08-03 has no `ship_date` key at all. Those
// readings stay valid — they just fall through to the invoice date.
test("an extraction stored before ship_date existed still works", () => {
  const legacy = extraction({ invoice_date: "2026-07-31" });
  delete (legacy as { ship_date?: unknown }).ship_date;
  eq(invoiceDeliveryDate(legacy), { date: "2026-07-31", source: "invoice" });
});

// ── What must never reach a `date` column ───────────────────────────────────

test("a malformed ship date falls through to the invoice date", () => {
  eq(
    invoiceDeliveryDate(
      extraction({ ship_date: "08/01/26", invoice_date: "2026-08-03" })
    ),
    { date: "2026-08-03", source: "invoice" }
  );
});

test("a day that does not exist is refused", () => {
  // The round-trip check is the whole point: `new Date("2026-02-31")` does not
  // fail, it silently rolls over to March 2nd.
  eq(invoiceDeliveryDate(extraction({ ship_date: "2026-02-31" })), null);
});

test("an impossible month is refused", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "2026-13-09" })), null);
});

test("a US-format date is refused rather than guessed at", () => {
  eq(invoiceDeliveryDate(extraction({ invoice_date: "08/03/2026" })), null);
});

test("a date with a time on it is refused", () => {
  // Not harmless: the column would take it, and every later reader would see a
  // date the reader never actually promised was one.
  eq(invoiceDeliveryDate(extraction({ ship_date: "2026-08-01T00:00:00Z" })), null);
});

test("prose where a date was expected is refused", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "see attached" })), null);
});

test("an empty string is refused", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "", invoice_date: "" })), null);
});

test("a leap day in a leap year is a real date", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "2028-02-29" })), {
    date: "2028-02-29",
    source: "ship",
  });
});

test("a leap day in a common year is not", () => {
  eq(invoiceDeliveryDate(extraction({ ship_date: "2026-02-29" })), null);
});

// ── What manual match can pair on ───────────────────────────────────────────
//
// Pairing IS copying a number onto the PO line, so a line printing none can't
// be paired — which is what the receiving screen greys out, and the question
// that surfaced the missing MATERIAL column in the first place.

test("manual match pairs on the primary number", () => {
  eq(matchableSku(line({ product_id: "5011418" })), "5011418");
});

test("manual match falls back to the second number", () => {
  eq(matchableSku(line({ product_id: null, alt_product_id: "2464048" })), "2464048");
});

test("the primary is preferred when both are printed", () => {
  eq(
    matchableSku(line({ product_id: "5011418", alt_product_id: "1231399" })),
    "5011418"
  );
});

test("a line with no number at all can't be paired", () => {
  eq(matchableSku(line({ product_id: null })), null);
});
