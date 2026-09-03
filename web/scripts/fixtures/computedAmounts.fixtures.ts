import { test, eq, ok } from "./harness";
import {
  lineExtended,
  rescaledExtended,
  computedAmounts,
  totalDisagreesWithDocument,
} from "../../src/lib/invoices";

/** A line is a CHARGE with a quantity and a rate beside it — and on a broken
 *  case those three do not multiply out. Every case below states all three. */
const line = (qty: number | null, price: number | null, extended: number | null, over: Record<string, unknown> = {}) =>
  ({ qty, unit_price: price, extended, kind: "item", ...over }) as never;
const charges = (over: Record<string, unknown> = {}) =>
  ({ tax: null, freight: null, other_charges: null, ...over }) as never;

test("the simple case is the simple arithmetic", () => {
  eq(lineExtended(2, 88.9), 177.8, "the real BakeMark line");
  eq(lineExtended(9, 54.99), 494.91, "and one that needs rounding");
  eq(lineExtended(0, 88.9), 0, "a struck line billed nothing");
  // Null is an ABSENCE, not zero — a line with no price read yet has no
  // extended, and 0 would be a claim that it was free.
  eq(lineExtended(1, null), null, "no price");
  eq(lineExtended(null, 47.95), null, "no quantity");
});

test("A BROKEN CASE IS NOT qty × unit_price — Chefs Warehouse 73358289", () => {
  // Pack `24/1 LB BC`: the CASE price is printed and eaches are billed, so
  // seven pounds of a $62.68 case is $18.28 and not $438.76. Deriving the
  // charge here turned a $472.13 invoice into $1,952.90 — measured, on a bill
  // already approved. THIS IS THE FIXTURE THAT MUST GO RED if anybody makes
  // `extended` a computation again.
  const cornStarch = line(7, 62.68, 18.28);
  const syrup = line(1, 116.95, 9.75);
  const halfAndHalf = line(2, 54.66, 9.11);
  const { subtotal } = computedAmounts([cornStarch, syrup, halfAndHalf], charges());
  eq(subtotal, 37.14, "what the page charged");
  ok(
    lineExtended(7, 62.68) !== 18.28,
    "and it is emphatically not what the multiplication says"
  );

  // Moving the quantity moves the charge at THE RATE IT WAS BILLED AT.
  eq(rescaledExtended(cornStarch, { qty: 14 }), 36.56, "twice the units, twice the charge");
  eq(rescaledExtended(cornStarch, { qty: 0 }), 0, "none of them, nothing owed");
  // A price edit moves it in proportion, so a broken case stays a broken case.
  eq(rescaledExtended(cornStarch, { unit_price: 125.36 }), 36.56, "a doubled case price");
});

test("a rescale falls back to multiplication only when there is nothing to scale", () => {
  // A line somebody is typing from nothing has no rate yet.
  eq(rescaledExtended(line(null, null, null), { qty: 3 }), null, "no price either");
  eq(rescaledExtended(line(null, 12.5, null), { qty: 3 }), 37.5, "so multiply");
  // A prior charge of zero carries no rate, so it multiplies rather than
  // scaling 0 forever — which would silently keep a resurrected line free.
  eq(rescaledExtended(line(0, 12.5, 0), { qty: 2 }), 25, "back from struck");
});

test("the invoice adds itself up — BakeMark 452660, as amended", () => {
  const lines = [
    line(2, 22.5, 45),
    line(2, 35.5, 71),
    line(9, 54.99, 494.91),
    line(2, 82.3, 164.6),
    line(0, null, null), // cocoa, struck
    line(1, 47.95, 47.95),
    line(0, 88.9, 0), // whipped topping, struck and its charge cleared with it
  ];
  const { subtotal, total } = computedAmounts(lines, charges({ tax: 0 }));
  eq(subtotal, 823.46, "what the driver wrote");
  eq(total, 823.46, "and no charges to add");

  // THE STRANDED CHARGE is the bug this invoice actually had: the quantity went
  // to nothing and $177.80 stayed behind. It is real money until somebody
  // clears it, so it is COUNTED and MARKED rather than quietly dropped.
  const stranded = [...lines];
  stranded[6] = line(0, 88.9, 177.8);
  eq(computedAmounts(stranded, charges({ tax: 0 })).total, 1001.26, "still owed, on paper");
});

test("charges count once, whether printed as a line or at the foot", () => {
  // A freight LINE and the header `freight` are one charge printed twice; the
  // reader puts it wherever the page did, and this counts whichever it found.
  const asLine = computedAmounts(
    [line(1, 100, 100), line(1, 8.95, 8.95, { kind: "freight" })],
    charges()
  );
  eq(asLine.subtotal, 100, "the freight line is not in the subtotal");
  eq(asLine.total, 108.95, "but it is in the total");

  const atFoot = computedAmounts([line(1, 100, 100)], charges({ freight: 8.95 }));
  eq(atFoot.total, 108.95, "the same answer either way");

  eq(
    computedAmounts([line(1, 100, 100)], charges({ tax: 9.75, other_charges: 0.15 })).total,
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
  // — never our own column, which is maintained and would agree with itself.
  eq(totalDisagreesWithDocument(823.46, 823.46), null, "agreed");
  eq(totalDisagreesWithDocument(823.46, 823.463), null, "within half a cent");
  const off = totalDisagreesWithDocument(823.46, 1001.26);
  ok(off?.includes("823.46") && off?.includes("1001.26"), "names both figures");
  // Nothing to compare against is not a disagreement.
  eq(totalDisagreesWithDocument(null, 1001.26), null, "no lines");
  eq(totalDisagreesWithDocument(823.46, null), null, "no printed total");
});

test("A CORRECTION THE READING MISSED IS NOT A DISCREPANCY — real invoice 15-700541", () => {
  // Chefs Warehouse-shaped bug, a different vendor: the OCR reading correctly
  // captured subtotal ($102.04) AND invoice_total ($86.73), but never
  // populated other_charges — the printed page has a $15.31 credit the model
  // simply missed. Mark had ALREADY typed -15.31 into the invoice's own Other
  // field to make the STORED figures reconcile, which is exactly what this
  // fixture pins: comparing our COMPUTED total (fresh, from lines + the
  // corrected Other) against the document's total must agree, even though
  // the raw reading's four parts (subtotal+tax+freight+other, with other
  // read as null) would sum to $102.04 and disagree with the reading's own
  // $86.73 if summed directly — which is the OLD, wrong check.
  const lines = [
    line(2, 51.02, 102.04), // the only item line; subtotal = 102.04
  ];
  const correctedCharges = charges({ tax: 0, other_charges: -15.31 });
  const computed = computedAmounts(lines, correctedCharges);
  eq(computed.subtotal, 102.04, "subtotal, from the line");
  eq(computed.total, 86.73, "total, once the correction is folded in");

  // The document's own total, as read (or a driver's correction — same
  // shape either way): $86.73. Computed and document now agree.
  eq(totalDisagreesWithDocument(computed.total, 86.73), null, "no disagreement once corrected");

  // And the OLD check's own arithmetic — the thing that used to fire — is
  // shown here only to prove what it was actually testing: the READING's
  // own un-corrected parts (other read as 0/missing) summing to $102.04
  // against the READING's own total of $86.73. That is an OCR self-check,
  // not a "does our record match the document" check, and it is why it kept
  // firing after the correction was already made.
  const uncorrectedReadingSum = 102.04 + 0 + 0 + 0; // other never read
  ok(Math.abs(uncorrectedReadingSum - 86.73) > 0.005, "the old check's own premise, for the record");
});
