// Fixtures for lib/invoiceMatch — the SKU join, its two relaxations, and the
// description fallback.
//
// These pin the behaviour the module's own comments claim, most of them on the
// NEGATIVE side: a line reported as "couldn't match this" is a small annoyance,
// while a wrong match silently proposes the wrong quantity against the wrong
// product. Several are drawn from Mark's real DF01 data (2026-07-31), which is
// where the Jaccard→containment change came from.

import { matchInvoiceToOrder } from "../../src/lib/invoiceMatch";
import { eq, no, ok, test } from "./harness";
import { invoiceLine, poLine, withCatalog } from "./factories";

// ── The SKU join ────────────────────────────────────────────────────────────

test("exact SKU joins the two sides", () => {
  const line = poLine({ product_id: "GT128F" });
  const inv = invoiceLine({ product_id: "GT128F", description: "Guitar strings" });
  const { matches, unmatchedInvoice } = matchInvoiceToOrder([line], [inv]);
  eq(matches.length, 1);
  eq(matches[0].by, "product_id");
  eq(matches[0].invoice, inv);
  eq(unmatchedInvoice.length, 0);
});

test("SKU comparison ignores case", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "gt128f" })],
    [invoiceLine({ product_id: "GT128F" })]
  );
  eq(matches[0].by, "product_id");
});

test("SKU comparison ignores dashes", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "30-111" })],
    [invoiceLine({ product_id: "30111" })]
  );
  eq(matches[0].by, "product_id");
});

test("SKU comparison ignores internal spaces", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "30 111" })],
    [invoiceLine({ product_id: "30111" })]
  );
  eq(matches[0].by, "product_id");
});

test("SKU comparison ignores surrounding whitespace", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "  GT128F  " })],
    [invoiceLine({ product_id: "GT128F" })]
  );
  eq(matches[0].by, "product_id");
});

test("a SKU that is only whitespace is no SKU at all", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "   " })],
    [invoiceLine({ product_id: "   " })]
  );
  eq(matches[0].invoice, null);
  eq(matches[0].by, null);
});

test("leading zeros on the order side are relaxed away", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "08843" })],
    [invoiceLine({ product_id: "8843" })]
  );
  eq(matches[0].by, "product_id");
});

test("leading zeros on the invoice side are relaxed away", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "8843" })],
    [invoiceLine({ product_id: "08843" })]
  );
  eq(matches[0].by, "product_id");
});

test("the strict pass wins before zeros are relaxed", () => {
  // Both "0100" and "100" are on the invoice. The order asks for "0100" and
  // must get the one that is literally "0100", not the relaxed neighbour.
  const strict = invoiceLine({ product_id: "0100", description: "padded" });
  const loose = invoiceLine({ product_id: "100", description: "unpadded" });
  const { matches } = matchInvoiceToOrder([poLine({ product_id: "0100" })], [loose, strict]);
  eq(matches[0].invoice?.description, "padded");
});

test("a SKU printed twice on the INVOICE is refused, not guessed", () => {
  const { matches, unmatchedInvoice } = matchInvoiceToOrder(
    [poLine({ product_id: "SW2900" })],
    [
      invoiceLine({ product_id: "SW2900", description: "first half" }),
      invoiceLine({ product_id: "SW2900", description: "backordered half" }),
    ]
  );
  eq(matches[0].invoice, null, "no arbitrary pairing");
  eq(unmatchedInvoice.length, 2);
});

test("a SKU appearing twice on the ORDER is refused on both lines", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "SW2900" }), poLine({ product_id: "SW2900" })],
    [invoiceLine({ product_id: "SW2900" })]
  );
  eq(matches[0].invoice, null);
  eq(matches[1].invoice, null);
});

// ── The description fallback ────────────────────────────────────────────────

test("the real Guittard pair — containment answers 1.0 where Jaccard refused", () => {
  // Found against Mark's DF01 order, 2026-07-31. Our side carries FileMaker's
  // accumulated boilerplate; every extra token is one the invoice can't match,
  // which is what scored an identical pair 0.55 under Jaccard.
  const line = poLine({
    description:
      "CHOC-GUITTARD 66% ORGANIC 25 LB // Guittard // CS (1*25lbs) // $.98 per oz //",
  });
  const inv = invoiceLine({ description: "CHOC GUITTARD 66% ORGANIC 25 LB" });
  const { matches } = matchInvoiceToOrder([line], [inv]);
  eq(matches[0].by, "description");
  eq(matches[0].invoice, inv);
});

test("a SKU that finds nothing still falls through to the description", () => {
  // Both sides print a SKU and they disagree — a vendor renumbering a part, or
  // our snapshot going stale. The descriptions are the remaining evidence, so
  // the pair is offered as a `≈` match rather than dropped.
  const line = poLine({ product_id: "AAA111", description: "ORGANIC WHOLE MILK GALLON" });
  const inv = invoiceLine({ product_id: "BBB222", description: "ORGANIC WHOLE MILK GALLON" });
  const { matches } = matchInvoiceToOrder([line], [inv]);
  eq(matches[0].by, "description");
  eq(matches[0].invoice, inv);
});

test("containment below 0.75 is refused", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ description: "Red Blue Green Yellow Black" })],
    [invoiceLine({ description: "Red Blue Green Purple Orange White" })]
  );
  eq(matches[0].invoice, null, "3 of 5 shared is 0.6");
});

test("fewer than three shared words is refused however well it contains", () => {
  // "Milk" is wholly contained in "Milk Chocolate Bar" — containment 1.0, and
  // exactly the wrong answer.
  const { matches } = matchInvoiceToOrder(
    [poLine({ description: "Milk" })],
    [invoiceLine({ description: "Milk Chocolate Bar" })]
  );
  eq(matches[0].invoice, null);
});

test("two near-identical products are kept apart", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ description: "Bananas, Ripe" })],
    [invoiceLine({ description: "Bananas, Fresh" })]
  );
  eq(matches[0].invoice, null, "they share one word, and every banana line has it");
});

test("single characters are not words", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ description: "a b c milk" })],
    [invoiceLine({ description: "a b c cream" })]
  );
  eq(matches[0].invoice, null);
});

test("the brand and catalog name widen what a line offers", () => {
  const line = withCatalog(poLine({ description: "66% ORGANIC", brand: "Guittard" }), {
    name: "Chocolate Wafers",
  });
  const inv = invoiceLine({ description: "GUITTARD 66% ORGANIC" });
  const { matches } = matchInvoiceToOrder([line], [inv]);
  eq(matches[0].by, "description");
});

test("the best-scoring pair is taken first", () => {
  const exact = poLine({ description: "ORGANIC WHOLE MILK GALLON" });
  const weaker = poLine({ description: "ORGANIC WHOLE MILK QUART CARTON" });
  const inv = invoiceLine({ description: "ORGANIC WHOLE MILK GALLON" });
  const { matches } = matchInvoiceToOrder([exact, weaker], [inv]);
  eq(matches[0].invoice, inv, "1.00 beats 0.75");
  eq(matches[1].invoice, null);
});

test("description matching cannot steal a line already claimed by SKU", () => {
  const bySku = poLine({ product_id: "GT128F" });
  const byText = poLine({ description: "ORGANIC WHOLE MILK GALLON" });
  const inv = invoiceLine({
    product_id: "GT128F",
    description: "ORGANIC WHOLE MILK GALLON",
  });
  const { matches } = matchInvoiceToOrder([bySku, byText], [inv]);
  eq(matches[0].by, "product_id");
  eq(matches[1].invoice, null);
});

// ── The shape of the answer ─────────────────────────────────────────────────

test("there is one match entry per order line, always", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" }), poLine(), poLine({ product_id: "C" })],
    [invoiceLine({ product_id: "A" })]
  );
  eq(matches.length, 3);
  eq(matches[1].by, null);
  eq(matches[2].invoice, null);
});

test("what was billed but not ordered is reported", () => {
  const extra = invoiceLine({ product_id: "ZZZ", description: "Not on this order" });
  const { unmatchedInvoice } = matchInvoiceToOrder(
    [poLine({ product_id: "A" })],
    [invoiceLine({ product_id: "A" }), extra]
  );
  eq(unmatchedInvoice, [extra]);
});

// ── The numbers on a match ──────────────────────────────────────────────────

test("the unit price is derived from the line total, not the printed rate", () => {
  // Distributors quote a per-case or per-pound rate against a per-piece
  // quantity; extended ÷ qty reproduced the order's own price on 13 of 19 real
  // lines where the printed one managed 6.
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" })],
    [invoiceLine({ product_id: "A", qty: 3, unit_price: 10, extended: 36 })]
  );
  eq(matches[0].unitPrice, 12);
});

test("the printed rate is the fallback when the line total is missing", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" }), poLine({ product_id: "B" })],
    [
      invoiceLine({ product_id: "A", qty: 3, unit_price: 10, extended: null }),
      invoiceLine({ product_id: "B", qty: null, unit_price: 10, extended: 36 }),
    ]
  );
  eq(matches[0].unitPrice, 10);
  eq(matches[1].unitPrice, 10);
});

test("a zero quantity does not divide", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" })],
    [invoiceLine({ product_id: "A", qty: 0, unit_price: 10, extended: 0 })]
  );
  eq(matches[0].unitPrice, 10);
});

test("arithmetic that doesn't close is flagged uncertain — the catch-weight case", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" })],
    [invoiceLine({ product_id: "A", qty: 3, unit_price: 10, extended: 36 })]
  );
  ok(matches[0].priceUncertain, "3 × 10 is not 36");
});

test("arithmetic that closes is not flagged", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A" })],
    [invoiceLine({ product_id: "A", qty: 3, unit_price: 12, extended: 36 })]
  );
  no(matches[0].priceUncertain);
});

test("qtyDiffers compares against what was RECEIVED, so an untouched line is quiet", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A", qty_ordered: 5, qty_received: null })],
    [invoiceLine({ product_id: "A", qty: 3 })]
  );
  no(matches[0].qtyDiffers, "nothing counted yet is nothing to disagree with");
});

test("qtyDiffers fires once a quantity has been counted", () => {
  const { matches } = matchInvoiceToOrder(
    [poLine({ product_id: "A", qty_ordered: 5, qty_received: 2 })],
    [invoiceLine({ product_id: "A", qty: 3 })]
  );
  ok(matches[0].qtyDiffers);
});

test("an unmatched line carries no numbers and no uncertainty", () => {
  const { matches } = matchInvoiceToOrder([poLine({ unit_price: 4 })], []);
  eq(matches[0].unitPrice, null);
  no(matches[0].priceDiffers);
  no(matches[0].priceUncertain);
});
