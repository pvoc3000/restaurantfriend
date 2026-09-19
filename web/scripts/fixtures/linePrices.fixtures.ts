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
