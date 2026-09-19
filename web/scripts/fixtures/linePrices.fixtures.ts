// The same item on one order at two prices — the add panel's merge rule and
// the two guards that keep a free line from reading as a price disagreement.
//
// Mark, 2026-09-19: "we ordered 13 bags of that mix, they gave us a free bag.
// I'd like to have the master mix appear twice, once at $50 ea. and once at 0
// ea." Which is the general case, not a free-goods special: a price break
// partway through a quantity does the same thing.
//
// These pin the boundary in both directions. Merging too eagerly averages two
// prices into a line nobody was charged; refusing to merge at all puts three
// lines of the same SKU on a vendor's copy because somebody added it three
// times, which is the mistake the merge existed to prevent in the first place.

import {
  closeReadiness,
  isFreeLine,
  mergeTargetLine,
  samePrice,
} from "../../src/lib/purchaseOrders";
import { priceAction } from "../../src/lib/receiving";
import { eq, no, ok, test } from "./harness";
import { poLine, withCatalog } from "./factories";

const LOC = "loc-here";

// ── samePrice ───────────────────────────────────────────────────────────────

test("samePrice: equal prices are one line's price", () => {
  ok(samePrice(50, 50));
  ok(samePrice(0, 0), "free is a price, not an absence");
});

test("samePrice: a cent apart is two prices", () => {
  no(samePrice(50, 50.01));
  no(samePrice(0, 0.01), "a penny is not free");
});

test("samePrice: rounds to the cent the column stores", () => {
  // unit_price is numeric(10,2), so both of these land on 50.00 — merging them
  // is not a relaxation, it is what the database is about to do anyway.
  ok(samePrice(50.001, 50), "sub-cent noise is the same stored price");
  ok(samePrice(50.004, 49.9962));
  no(samePrice(50.005, 49.994), "…but a real half-cent split still parts them");
});

test("samePrice: null is a value, not a wildcard", () => {
  ok(samePrice(null, null), "two lines with no price known are one line");
  no(samePrice(null, 50), "a priceless line never absorbs a priced add");
  no(samePrice(50, null), "…nor the other way round");
});

// ── mergeTargetLine ─────────────────────────────────────────────────────────

const mix = (over: Parameters<typeof poLine>[0] = {}) =>
  poLine({ vendor_item_id: "vi-mix", qty_ordered: 13, unit_price: 50, ...over });

test("merge: an empty order has nothing to join", () => {
  eq(mergeTargetLine([], "vi-mix", 50), null);
});

test("merge: the same item at the same price joins its line", () => {
  const line = mix();
  eq(mergeTargetLine([line], "vi-mix", 50)?.id, line.id);
});

test("merge: the free bag starts its own line", () => {
  // THE CASE THIS EXISTS FOR. 13 at $50 on the order, one thrown in at 0.
  const ordered = mix();
  eq(mergeTargetLine([ordered], "vi-mix", 0), null, "0 does not join $50");
});

test("merge: …and a second free bag joins the first", () => {
  const ordered = mix();
  const free = mix({ qty_ordered: 1, unit_price: 0 });
  eq(mergeTargetLine([ordered, free], "vi-mix", 0)?.id, free.id);
  eq(mergeTargetLine([ordered, free], "vi-mix", 50)?.id, ordered.id, "and $50 still joins $50");
});

test("merge: a different item never joins, whatever the price", () => {
  eq(mergeTargetLine([mix()], "vi-flour", 50), null);
});

test("merge: a one-off line is never a target", () => {
  // `vendor_item_id` null — there is no SKU to say two of them are the same
  // thing, and `addOneOff` never asks. A null id must not match a null id.
  const oneOff = poLine({ vendor_item_id: null, unit_price: 50 });
  eq(mergeTargetLine([oneOff], "vi-mix", 50), null);
});

test("merge: a line with no price known takes an add with none", () => {
  const unpriced = mix({ unit_price: null });
  eq(mergeTargetLine([unpriced], "vi-mix", null)?.id, unpriced.id);
  eq(mergeTargetLine([unpriced], "vi-mix", 0), null, "…but not a free one");
});

test("merge: the FIRST matching line wins, deterministically", () => {
  // Two lines at one price is a state the panel cannot create but the data can
  // (a hand edit, a migrated order). Landing on the earlier one is arbitrary
  // but must not be random — the alternative is an add that goes somewhere
  // different each time it is pressed.
  const a = mix({ qty_ordered: 3 });
  const b = mix({ qty_ordered: 4 });
  eq(mergeTargetLine([a, b], "vi-mix", 50)?.id, a.id);
});

// ── isFreeLine ──────────────────────────────────────────────────────────────

test("free: zero is free, null is unknown", () => {
  ok(isFreeLine({ unit_price: 0 }));
  no(isFreeLine({ unit_price: null }), "nobody has filled this in yet");
  no(isFreeLine({ unit_price: 50 }));
});

// ── the two guards ──────────────────────────────────────────────────────────

test("receiving: a free line is not offered a catalog update", () => {
  // Without the guard this returns stage "vendor" for ever: the line says 0,
  // the catalog says $50, and the only way to agree is to write 0 over a live
  // price — which every order-guide suggestion then reads.
  const free = withCatalog(poLine({ unit_price: 0 }), { price: 50 });
  eq(priceAction(free, undefined, LOC), null);
});

test("receiving: a PRICED line still is", () => {
  const priced = withCatalog(poLine({ unit_price: 50 }), { price: 45 });
  eq(priceAction(priced, undefined, LOC)?.stage, "vendor", "the guard is not a blanket");
});

test("finalize: a free line raises no price caveat", () => {
  const ordered = withCatalog(poLine({ unit_price: 50, qty_received: 13 }), { price: 50 });
  const free = withCatalog(poLine({ unit_price: 0, qty_received: 1 }), { price: 50 });
  eq(
    closeReadiness([ordered, free], 1, LOC, 1),
    [],
    "nothing left to settle on a fully received, filed order"
  );
});

test("finalize: a line that really does disagree is still named", () => {
  const drifted = withCatalog(poLine({ unit_price: 52, qty_received: 1 }), { price: 50 });
  eq(closeReadiness([drifted], 1, LOC, 1), ["1 line's price differs from the catalog"]);
});

// ── the invoice matcher's price tiebreak ────────────────────────────────────
//
// Mark, 2026-09-19: "for both master mix lines there's a 'match' button… when I
// try to match to the purchase order line, nothing changes. Is it getting
// matched?" It was not. The four SKU passes skip any number printed twice on
// the ORDER, which was the honest answer while two lines of one SKU meant a
// split delivery — but the add panel now creates that state deliberately, and
// the very thing that distinguishes the two lines is the price.

import { matchInvoiceToOrder, sameSku } from "../../src/lib/invoiceMatch";
import { invoiceLine } from "./factories";

/** The order as Mark's stood: thirteen bags at $50 and the free one. */
const mixLines = () => [
  poLine({ product_id: "08779", qty_ordered: 13, unit_price: 50, qty_received: 13 }),
  poLine({ product_id: "08779", qty_ordered: 1, unit_price: 0, qty_received: 1 }),
];

test("tiebreak: the free bag and the thirteen each find their invoice line", () => {
  const [paid, free] = mixLines();
  const billed = invoiceLine({ product_id: "08779", qty: 13, extended: 650 });
  const gratis = invoiceLine({ product_id: "08779", qty: 1, extended: 0 });
  const { matches, unmatchedInvoice } = matchInvoiceToOrder([paid, free], [billed, gratis]);
  eq(matches[0].invoice?.extended, 650, "the $50 line takes the $650 of billing");
  eq(matches[1].invoice?.extended, 0, "and the free bag takes the free line");
  eq(unmatchedInvoice, [], "nothing left over");
});

test("tiebreak: it is not fooled by the ORDER of the invoice lines", () => {
  const [paid, free] = mixLines();
  const gratis = invoiceLine({ product_id: "08779", qty: 1, extended: 0 });
  const billed = invoiceLine({ product_id: "08779", qty: 13, extended: 650 });
  const { matches } = matchInvoiceToOrder([paid, free], [gratis, billed]);
  eq(matches[0].invoice?.extended, 650);
  eq(matches[1].invoice?.extended, 0);
});

test("tiebreak: leading zeros still don't count", () => {
  const [paid, free] = mixLines();
  const billed = invoiceLine({ product_id: "8779", qty: 13, extended: 650 });
  const gratis = invoiceLine({ product_id: "8779", qty: 1, extended: 0 });
  const { matches } = matchInvoiceToOrder([paid, free], [billed, gratis]);
  eq(matches[0].invoice?.extended, 650);
  eq(matches[1].invoice?.extended, 0);
});

test("tiebreak: THE SPLIT DELIVERY IS STILL REFUSED", () => {
  // The case the duplicate-SKU rule was written for: one SKU, two lines, SAME
  // price. Nothing tells them apart, and pairing them in array order would
  // propose a quantity against a line chosen by accident. Both stay unmatched.
  //
  // THE DESCRIPTIONS ARE REAL AND IDENTICAL ON PURPOSE. Without them this case
  // passes for the wrong reason: two lines of one item have the same wording by
  // construction, and before 2026-09-19 they fell out of the SKU passes into
  // the DESCRIPTION pass, which scored both 1.0 and paired them by array order
  // — reporting a confident match that was right only by luck.
  const d = "MASTER MIX DONUT CAKE";
  const a = poLine({ product_id: "08779", description: d, qty_ordered: 6, unit_price: 50 });
  const b = poLine({ product_id: "08779", description: d, qty_ordered: 7, unit_price: 50 });
  const one = invoiceLine({ product_id: "08779", description: d, qty: 6, extended: 300 });
  const two = invoiceLine({ product_id: "08779", description: d, qty: 7, extended: 350 });
  const { matches, unmatchedInvoice } = matchInvoiceToOrder([a, b], [one, two]);
  eq(matches[0].invoice, null);
  eq(matches[1].invoice, null);
  eq(unmatchedInvoice.length, 2, "reported as billed-but-not-placed, the honest answer");
});

test("tiebreak: two invoice lines at one price against one order line is refused", () => {
  // A partial shipment billed twice at the same rate. The order line's price
  // matches both, so the price has not decided anything.
  const [paid, free] = mixLines();
  const half = invoiceLine({ product_id: "08779", qty: 7, extended: 350 });
  const rest = invoiceLine({ product_id: "08779", qty: 6, extended: 300 });
  const gratis = invoiceLine({ product_id: "08779", qty: 1, extended: 0 });
  const { matches } = matchInvoiceToOrder([paid, free], [half, rest, gratis]);
  eq(matches[0].invoice, null, "the $50 line has two candidates and takes neither");
  eq(matches[1].invoice?.extended, 0, "the free bag is still unambiguous and still pairs");
});

test("tiebreak: a line with no price of its own cannot be placed by price", () => {
  const unpriced = poLine({ product_id: "08779", qty_ordered: 13, unit_price: null });
  const free = poLine({ product_id: "08779", qty_ordered: 1, unit_price: 0 });
  const billed = invoiceLine({ product_id: "08779", qty: 13, extended: 650 });
  const gratis = invoiceLine({ product_id: "08779", qty: 1, extended: 0 });
  const { matches } = matchInvoiceToOrder([unpriced, free], [billed, gratis]);
  eq(matches[0].invoice, null, "nothing to compare");
  eq(matches[1].invoice?.extended, 0, "the free bag still decides itself");
});

test("tiebreak: a UNIQUE sku is untouched by any of this", () => {
  const flour = poLine({ product_id: "12345", qty_ordered: 4, unit_price: 20 });
  const billed = invoiceLine({ product_id: "12345", qty: 4, extended: 96 });
  const { matches } = matchInvoiceToOrder([flour], [billed]);
  eq(matches[0].invoice?.extended, 96, "the ordinary pass still does the ordinary work");
});

// ── sameSku ─────────────────────────────────────────────────────────────────

test("sameSku: the matcher's own rules, so the Match dialog cannot disagree", () => {
  ok(sameSku("08779", "08779"));
  ok(sameSku("08779", "8779"), "leading zeros never mean anything");
  ok(sameSku(" 30-111 ", "30111"), "spaces and dashes are formatting");
  ok(sameSku("abc", "ABC"), "case is not meaning");
  no(sameSku("08779", "50021"), "a renumbered item is a real difference — copy it");
  no(sameSku(null, "08779"), "no number on the line is not a match");
  no(sameSku("08779", null));
});
