// The Add-item panel's "you haven't added that yet" guard.
//
// The panel stays open after each add, so typing an amount and typing an amount
// THEN pressing Add to PO leave the screen looking almost the same. What these
// pin is the difference between the two, and the two ways of getting it wrong:
// warning about a blank form (so the ordinary Done grows a dialog nobody
// needs), and quoting a number back that nobody entered.

import { test, eq, ok } from "./harness";
import {
  addableQty,
  isPendingAdd,
  unaddedAdds,
  unaddedWarning,
  type PendingAdd,
} from "../../src/lib/purchaseOrders";

const row = (label: string, qty: string): PendingAdd => ({ label, values: [qty] });

/** The one-off form, in the panel's own field order: amount first. */
const oneOff = (over: Partial<Record<
  "qty" | "description" | "brand" | "productId" | "packageDesc" | "price" | "notes",
  string
>> = {}): PendingAdd => {
  const f = {
    qty: "",
    description: "",
    brand: "",
    productId: "",
    packageDesc: "",
    price: "",
    notes: "",
    ...over,
  };
  return {
    label: f.description.trim() || "a one-off item",
    values: [f.qty, f.description, f.brand, f.productId, f.packageDesc, f.price, f.notes],
  };
};

test("an untouched panel closes without a question", () => {
  eq(unaddedAdds([]), []);
  eq(unaddedWarning([]), null, "nothing typed");
  // The one-off entry is ALWAYS offered by the component, so a blank form must
  // not be work — otherwise every Done on the catalog tab asks a dialog.
  eq(unaddedWarning([oneOff()]), null, "a blank one-off form");
  // A draft cleared after a successful add leaves an empty string behind.
  eq(unaddedWarning([row("Flour, All Purpose", ""), oneOff()]), null, "an added row");
  eq(unaddedWarning([row("Flour, All Purpose", "   ")]), null, "whitespace is not work");
});

test("a typed amount is named, with its quantity", () => {
  eq(unaddedAdds([row("Flour, All Purpose", "3")]), ["3 × Flour, All Purpose"]);
  // Arithmetic is allowed in every numeric field here (lib/calc), so the
  // confirm has to say what it comes to rather than echo the keystrokes.
  eq(unaddedAdds([row("Cups, 12oz", "2 * 6")]), ["12 × Cups, 12oz"]);
});

test("a quantity nobody entered is never quoted back", () => {
  // Both are somebody mid-keystroke: "0" cannot be added at all (the panel
  // refuses anything <= 0) and "1 +" is half an expression. Naming the item
  // alone says what is loose without inventing an amount.
  eq(unaddedAdds([row("Flour, All Purpose", "0")]), ["Flour, All Purpose"]);
  eq(unaddedAdds([row("Flour, All Purpose", "1 +")]), ["Flour, All Purpose"]);
  eq(unaddedAdds([row("Flour, All Purpose", "-2")]), ["Flour, All Purpose"]);
  // …and it is still a warning: something was typed and would be discarded.
  ok(unaddedWarning([row("Flour, All Purpose", "0")]), "a stray 0 still warns");
});

test("a half-filled one-off form is work", () => {
  // No amount and no description — but somebody typed a brand, and closing
  // would throw it away.
  eq(unaddedAdds([oneOff({ brand: "Guittard" })]), ["a one-off item"]);
  eq(unaddedAdds([oneOff({ qty: "2", description: "Dry ice" })]), ["2 × Dry ice"]);
  // The description names it even when the amount is the field still missing.
  eq(unaddedAdds([oneOff({ description: "Dry ice" })]), ["Dry ice"]);
});

test("the confirm names what is loose", () => {
  const one = unaddedWarning([row("Flour, All Purpose", "3")]);
  eq(one?.title, "Close without adding?");
  ok(one?.body.includes("3 × Flour, All Purpose"), "the single case names the row");
  ok(one?.body.includes("discards it"), "singular");
  ok(!one?.body.includes("·"), "one thing is a sentence, not a list");

  const many = unaddedWarning([
    row("Flour, All Purpose", "3"),
    row("Sugar, Granulated", "1"),
    oneOff({ qty: "2", description: "Dry ice" }),
  ]);
  eq(
    many?.body.split("\n").filter((l) => l.startsWith("· ")),
    ["· 3 × Flour, All Purpose", "· 1 × Sugar, Granulated", "· 2 × Dry ice"]
  );
  ok(many?.body.includes("discards them"), "plural");
});

test("what counts as an order amount", () => {
  // The fill on Add to PO promises the button will work, so this must agree
  // with the refusal the button itself raises — one call, three readers.
  eq(addableQty("3"), 3);
  eq(addableQty(" 2 * 6 "), 12);
  eq(addableQty("0.5"), 0.5);
  eq(addableQty(""), null, "blank");
  eq(addableQty("   "), null, "whitespace");
  eq(addableQty("0"), null, "zero is not an order");
  eq(addableQty("-2"), null, "negative");
  eq(addableQty("1 +"), null, "half an expression");
  eq(addableQty("case"), null, "not a number");
});

test("the fill follows anything typed, not a valid amount", () => {
  // Mark, 2026-09-08: Add to PO takes the fill "as soon as the user enters
  // anything". So this is deliberately looser than `addableQty` — a stray "0"
  // blackens the row, because the row IS what finishes the task from there.
  ok(isPendingAdd(row("Flour, All Purpose", "0")), "a zero is still typing");
  ok(isPendingAdd(row("Flour, All Purpose", "1 +")), "half an expression");
  ok(isPendingAdd(oneOff({ brand: "Guittard" })), "any field of the one-off form");
  eq(isPendingAdd(row("Flour, All Purpose", "")), false, "blank");
  eq(isPendingAdd(row("Flour, All Purpose", "  ")), false, "whitespace");
  // The add that succeeds clears the draft, which is what puts the fill back on
  // Done — so an added row must read exactly like an untouched one.
  eq(isPendingAdd(oneOff()), false, "a form reset after an add");
});
