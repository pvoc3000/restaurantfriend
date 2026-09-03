import { test, eq, ok } from "./harness";
import {
  lineExtended,
  computedAmounts,
  totalDisagreesWithDocument,
} from "../../src/lib/invoices";

const line = (over: Record<string, unknown> = {}) =>
  ({ qty: 2, unit_price: 88.9, extended: 177.8, kind: "item", ...over }) as never;
const charges = (over: Record<string, unknown> = {}) =>
  ({ tax: null, freight: null, other_charges: null, ...over }) as never;

test("a line's money is its own arithmetic", () => {
  eq(lineExtended(2, 88.9), 177.8, "the real BakeMark line");
  eq(lineExtended(9, 54.99), 494.91, "and one that needs rounding");
  eq(lineExtended(0, 88.9), 0, "a struck line billed nothing");
  // Null is an ABSENCE, not zero — a line with no price read yet has no
  // extended, and 0 would be a claim that it was free.
  eq(lineExtended(1, null), null, "no price");
  eq(lineExtended(null, 47.95), null, "no quantity");
});

test("the invoice adds itself up — BakeMark 452660, as amended", () => {
  const lines = [
    line({ qty: 2, unit_price: 22.5 }),
    line({ qty: 2, unit_price: 35.5 }),
    line({ qty: 9, unit_price: 54.99 }),
    line({ qty: 2, unit_price: 82.3 }),
    line({ qty: 0, unit_price: null }),   // cocoa, struck
    line({ qty: 1, unit_price: 47.95 }),
    line({ qty: 0, unit_price: 88.9 }),   // whipped topping, struck
  ];
  const { subtotal, total } = computedAmounts(lines, charges({ tax: 0 }));
  eq(subtotal, 823.46, "what the driver wrote");
  eq(total, 823.46, "and no charges to add");
});

test("charges count once, whether printed as a line or at the foot", () => {
  // A freight LINE and the header `freight` are one charge printed twice; the
  // reader puts it wherever the page did, and this counts whichever it found.
  const asLine = computedAmounts(
    [line({ qty: 1, unit_price: 100 }), line({ qty: 1, unit_price: 8.95, kind: "freight" })],
    charges()
  );
  eq(asLine.subtotal, 100, "the freight line is not in the subtotal");
  eq(asLine.total, 108.95, "but it is in the total");

  const atFoot = computedAmounts([line({ qty: 1, unit_price: 100 })], charges({ freight: 8.95 }));
  eq(atFoot.total, 108.95, "the same answer either way");

  eq(
    computedAmounts([line({ qty: 1, unit_price: 100 })], charges({ tax: 9.75, other_charges: 0.15 })).total,
    109.9,
    "tax and other too"
  );
});

test("a bill with no lines keeps its typed total", () => {
  // The rent bill, the plumber — the invoices this module exists to carry.
  // Computing 0 for them would replace a real figure with a claim that nothing
  // is owed, which is the one answer that must never be invented.
  const none = computedAmounts([], charges({ tax: 0 }));
  eq(none.subtotal, null, "nothing to sum");
  eq(none.total, null, "so nothing to say");
});

test("the page is argued with at APPROVAL, not silently", () => {
  // What the DOCUMENT said — the reading's own total, or a driver's correction
  // — never our own column, which is computed and would agree with itself.
  eq(totalDisagreesWithDocument(823.46, 823.46), null, "agreed");
  eq(totalDisagreesWithDocument(823.46, 823.463), null, "within half a cent");
  const off = totalDisagreesWithDocument(823.46, 1001.26);
  ok(off?.includes("823.46") && off?.includes("1001.26"), "names both figures");
  // Nothing to compare against is not a disagreement.
  eq(totalDisagreesWithDocument(null, 1001.26), null, "no lines");
  eq(totalDisagreesWithDocument(823.46, null), null, "no printed total");
});
