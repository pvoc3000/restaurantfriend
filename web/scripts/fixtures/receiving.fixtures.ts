// Fixtures for lib/receiving — the two-stage price button, the bulk-fill rule,
// and the small helpers the rows read.
//
// The price button is the one piece of genuinely new branching logic on the
// receiving screen, and it writes money, so most of these are about it.

import { matchInvoiceToOrder, type LineMatch } from "../../src/lib/invoiceMatch";
import { packType } from "../../src/lib/purchaseOrders";
import {
  effectiveCatalogPrice,
  fillable,
  latestRead,
  needsUpdate,
  priceAction,
  qtyLabel,
  receivedClass,
  receivingOrder,
} from "../../src/lib/receiving";
import { eq, no, ok, test } from "./harness";
import { invoiceLine, poLine, withCatalog } from "./factories";

const LOC = "loc-here";
const OTHER = "loc-elsewhere";

/** The match a line would get from a one-line invoice at `price`. */
function matchAt(line: import("../../src/lib/purchaseOrders").PoLine, price: number | null) {
  if (price === null) return undefined;
  const inv = invoiceLine({ product_id: line.product_id, qty: 1, extended: price });
  return matchInvoiceToOrder([line], [inv]).matches[0];
}

// ── needsUpdate ─────────────────────────────────────────────────────────────

test("needsUpdate: a missing target is a difference", () => {
  ok(needsUpdate(null, 12.4), "null → 12.40 is a change worth offering");
});

test("needsUpdate: a missing replacement is nothing to offer", () => {
  no(needsUpdate(12.4, null));
  no(needsUpdate(null, null));
});

test("needsUpdate: equal prices are settled", () => {
  no(needsUpdate(12.4, 12.4));
});

test("needsUpdate: float noise below the epsilon is not a difference", () => {
  no(needsUpdate(3.73, 3.7266666), "|diff| 0.0033 against a strict > 0.005");
});

test("needsUpdate: a real cent is a difference", () => {
  ok(needsUpdate(12.4, 12.41));
});

// ── effectiveCatalogPrice ───────────────────────────────────────────────────

test("effective price: no catalog row means no price and nothing to write", () => {
  eq(effectiveCatalogPrice(poLine(), LOC), { price: null, hasOverride: false });
});

test("effective price: with no override, the catalog price stands", () => {
  const line = withCatalog(poLine(), { price: 20 });
  eq(effectiveCatalogPrice(line, LOC), { price: 20, hasOverride: false });
});

test("effective price: an override at THIS location wins", () => {
  const line = withCatalog(poLine(), {
    price: 20,
    overrides: [{ location_id: LOC, price: 18 }],
  });
  eq(effectiveCatalogPrice(line, LOC), { price: 18, hasOverride: true });
});

test("effective price: an override at another location is not ours", () => {
  const line = withCatalog(poLine(), {
    price: 20,
    overrides: [{ location_id: OTHER, price: 18 }],
  });
  eq(effectiveCatalogPrice(line, LOC), { price: 20, hasOverride: false });
});

// ── priceAction: the two stages ─────────────────────────────────────────────

test("stage 1: the invoice disagrees with the order → Update PO", () => {
  const line = withCatalog(poLine({ product_id: "A", unit_price: 40.34 }), { price: 40.34 });
  const action = priceAction(line, matchAt(line, 41.25), LOC);
  eq(action?.stage, "po");
  eq(action?.price, 41.25);
  eq(action?.current, 40.34);
});

test("stage 2: the order disagrees with the catalog → Update vendor", () => {
  // What stage 1 leaves behind: the PO now says 41.25, the catalog still 40.34.
  const line = withCatalog(poLine({ product_id: "A", unit_price: 41.25 }), { price: 40.34 });
  const action = priceAction(line, matchAt(line, 41.25), LOC);
  eq(action?.stage, "vendor");
  eq(action?.price, 41.25);
  eq(action?.current, 40.34);
});

test("both taken: nothing left to offer", () => {
  const line = withCatalog(poLine({ product_id: "A", unit_price: 41.25 }), { price: 41.25 });
  eq(priceAction(line, matchAt(line, 41.25), LOC), null);
});

test("with no invoice at all, stage 2 alone absorbs the old price-differs band", () => {
  const line = withCatalog(poLine({ unit_price: 41.25 }), { price: 40.34 });
  const action = priceAction(line, undefined, LOC);
  eq(action?.stage, "vendor");
});

test("with no invoice and an agreeing catalog, there is no button", () => {
  const line = withCatalog(poLine({ unit_price: 40.34 }), { price: 40.34 });
  eq(priceAction(line, undefined, LOC), null);
});

test("a line ordered with NO price still gets stage 1", () => {
  // The case invoiceExtraction's priceDiffers answers "false" to, and the case
  // that most needs the button.
  const line = withCatalog(poLine({ product_id: "A", unit_price: null }), { price: 12.4 });
  const action = priceAction(line, matchAt(line, 12.4), LOC);
  eq(action?.stage, "po");
  eq(action?.current, null);
});

test("a catalog row with NO price still gets stage 2", () => {
  const line = withCatalog(poLine({ unit_price: 12.4 }), { price: null });
  const action = priceAction(line, undefined, LOC);
  eq(action?.stage, "vendor");
  eq(action?.current, null);
});

test("stage 2 targets the per-location override row when there is one", () => {
  const line = withCatalog(poLine({ unit_price: 41.25 }), {
    price: 40.34,
    overrides: [{ location_id: LOC, price: 39 }],
  });
  const action = priceAction(line, undefined, LOC);
  eq(action?.stage, "vendor");
  eq(action && "hasOverride" in action ? action.hasOverride : "missing", true);
  eq(action?.current, 39, "compared against the price actually in force");
});

test("stage 2 with an override that already agrees offers nothing", () => {
  const line = withCatalog(poLine({ unit_price: 39 }), {
    price: 40.34,
    overrides: [{ location_id: LOC, price: 39 }],
  });
  eq(priceAction(line, undefined, LOC), null, "the catalog price is not the one in force");
});

test("uncertainty rides along into stage 1 so the button can wear the ?", () => {
  const line = poLine({ product_id: "A", unit_price: 10 });
  const inv = invoiceLine({ product_id: "A", qty: 3, unit_price: 10, extended: 36 });
  const match = matchInvoiceToOrder([line], [inv]).matches[0];
  const action = priceAction(line, match, LOC);
  eq(action?.stage, "po");
  eq(action?.price, 12);
  ok(action?.uncertain, "3 × 10 ≠ 36 — catch weight");
});

test("the stage machine terminates: rounding to cents cannot re-arm stage 1", () => {
  // extended ÷ qty = 3.72666…; numeric(10,2) stores 3.73. The next render must
  // not offer to write 3.72666… over it again, forever.
  const line = poLine({ product_id: "A", unit_price: 3.73 });
  const inv = invoiceLine({ product_id: "A", qty: 3, extended: 11.18 });
  const match = matchInvoiceToOrder([line], [inv]).matches[0];
  const action = priceAction(line, match, LOC);
  no(action && action.stage === "po", "0.0033 apart is inside the epsilon");
});

// ── receivedClass ───────────────────────────────────────────────────────────

test("received box: untouched and zero are different states", () => {
  const untouched = receivedClass(3, null);
  const zero = receivedClass(3, 0);
  ok(untouched.includes("bg-white"));
  ok(zero.includes("bg-stop"));
  ok(untouched !== zero, "'I counted nothing' is a measurement; 'I haven't' is not");
});

test("received box: short is a look, full is settled", () => {
  ok(receivedClass(3, 2).includes("bg-mark-fill"));
  ok(receivedClass(3, 3).includes("bg-go"));
});

test("received box: over-delivery reads as settled, not as an error", () => {
  ok(receivedClass(3, 4).includes("bg-go"));
});

// ── fillable ────────────────────────────────────────────────────────────────

test("bulk fill never overwrites a counted quantity", () => {
  const counted = poLine({ qty_ordered: 5, qty_received: 2 });
  const untouched = poLine({ qty_ordered: 5 });
  const out = fillable([counted, untouched], new Map(), false);
  eq(out.length, 1);
  eq(out[0].line.id, untouched.id);
});

test("bulk fill takes the ordered quantity when nothing has been read", () => {
  const line = poLine({ qty_ordered: 5 });
  eq(fillable([line], new Map(), false)[0].qty, 5);
});

test("bulk fill takes the INVOICE quantity when something has been read", () => {
  const line = poLine({ product_id: "A", qty_ordered: 5 });
  const match = matchInvoiceToOrder(
    [line],
    [invoiceLine({ product_id: "A", qty: 3 })]
  ).matches[0];
  const byLine = new Map<string, LineMatch>([[line.id, match]]);
  eq(fillable([line], byLine, true)[0].qty, 3);
});

test("bulk fill skips lines the invoice doesn't bill", () => {
  // Deliberately NOT filled from the ordered quantity — that would assert that
  // something arrived which nobody billed us for.
  const billed = poLine({ product_id: "A", qty_ordered: 5 });
  const unbilled = poLine({ product_id: "B", qty_ordered: 2 });
  const result = matchInvoiceToOrder(
    [billed, unbilled],
    [invoiceLine({ product_id: "A", qty: 3 })]
  );
  const byLine = new Map(result.matches.map((m) => [m.line.id, m]));
  const out = fillable([billed, unbilled], byLine, true);
  eq(out.length, 1);
  eq(out[0].line.id, billed.id);
});

test("bulk fill skips a matched line whose invoice quantity didn't print", () => {
  const line = poLine({ product_id: "A", qty_ordered: 5 });
  const match = matchInvoiceToOrder(
    [line],
    [invoiceLine({ product_id: "A", qty: null })]
  ).matches[0];
  eq(fillable([line], new Map([[line.id, match]]), true).length, 0);
});

test("bulk fill will fill a zero the invoice actually printed", () => {
  const line = poLine({ product_id: "A", qty_ordered: 5 });
  const match = matchInvoiceToOrder(
    [line],
    [invoiceLine({ product_id: "A", qty: 0 })]
  ).matches[0];
  eq(fillable([line], new Map([[line.id, match]]), true)[0].qty, 0, "billed nothing");
});

// ── pack labels ─────────────────────────────────────────────────────────────

test("pack label: the catalog's type wins over the line's composed snapshot", () => {
  const line = withCatalog(poLine({ package_desc: "12 × 32 oz" }), { package_desc: "CS" });
  eq(packType(line), "CS");
  eq(qtyLabel(2, packType(line)), "2 CS");
});

test("pack label: a bare snapshot is the fallback for migrated history", () => {
  eq(packType(poLine({ package_desc: "EA" })), "EA");
});

test("pack label: a composed snapshot is refused rather than printed", () => {
  eq(packType(poLine({ package_desc: "1 × 5 lbs" })), null, "'2 1 × 5 lbs' is nonsense");
  eq(qtyLabel(2, null), "2");
});

test("pack label: nothing counted reads as a dash", () => {
  eq(qtyLabel(null, "CS"), "—");
});

// ── ordering and source selection ───────────────────────────────────────────

test("rows read in PO detail's order — category, then catalog name", () => {
  const a = withCatalog(poLine(), { category: "Dry Goods", name: "Sugar" });
  const b = withCatalog(poLine(), { category: "Dairy", name: "Milk" });
  const c = withCatalog(poLine(), { category: "Dry Goods", name: "Flour" });
  eq(
    receivingOrder([a, b, c]).map((l) => l.vendor_items?.inventory_items?.name),
    ["Milk", "Flour", "Sugar"]
  );
});

test("the invoice in play is the most recently READ attachment", () => {
  const older = { extraction: { lines: [] }, extracted_at: "2026-07-30T00:00:00Z" };
  const newer = { extraction: { lines: [] }, extracted_at: "2026-07-31T00:00:00Z" };
  const unread = { extraction: null, extracted_at: null };
  eq(
    latestRead([older, unread, newer] as never[]),
    newer as never,
    "an order can carry several documents"
  );
});

test("with nothing read there is no invoice in play", () => {
  eq(latestRead([{ extraction: null, extracted_at: null }] as never[]), null);
});
