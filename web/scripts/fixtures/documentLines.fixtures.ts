// How the printed order documents order the lines inside one group — the
// category on the vendor PO, the shop section on the shopping list.
//
// Worth pinning because the failure is quiet in the wrong way: a mis-ordered
// PDF is obvious to whoever reads it and invisible to everyone else, and the
// person who reads it is a VENDOR filling the order.

import { compareDocumentLines, documentLineSortKey } from "../../src/lib/purchaseOrders";
import { eq, test } from "./harness";

const line = (description: string | null, item_name: string | null = null) => ({
  description,
  item_name,
});

function ordered(lines: { description: string | null; item_name?: string | null }[]) {
  return [...lines].sort(compareDocumentLines).map(documentLineSortKey);
}

test("lines read A→Z by the description the vendor sees", () => {
  eq(ordered([line("Sugar, granulated"), line("Butter, unsalted"), line("Flour, bread")]), [
    "Butter, unsalted",
    "Flour, bread",
    "Sugar, granulated",
  ]);
});

test("the key is the VENDOR's description, our name only as a fallback", () => {
  // "Napkins" is what we call it; the page prints "Serviettes, 2-ply", so that
  // is what the page must be alphabetised by.
  eq(documentLineSortKey(line("Serviettes, 2-ply", "Napkins")), "Serviettes, 2-ply");
  eq(documentLineSortKey(line(null, "Napkins")), "Napkins");
  eq(documentLineSortKey(line(null, null)), "");
});

test("a line with no description at all sinks rather than leading the group", () => {
  eq(ordered([line(null, null), line("Almonds, sliced")]), ["Almonds, sliced", ""]);
});

test("numbers inside a description compare as numbers", () => {
  // The trap a plain localeCompare walks into: "10" sorting before "5".
  eq(ordered([line("Flour 10 lb"), line("Flour 5 lb"), line("Flour 20 lb")]), [
    "Flour 5 lb",
    "Flour 10 lb",
    "Flour 20 lb",
  ]);
});

test("surrounding whitespace doesn't decide the order", () => {
  eq(ordered([line("  Zest"), line("Anise")]), ["Anise", "Zest"]);
});

test("two identical descriptions are left alone rather than swapped", () => {
  eq(compareDocumentLines(line("Cocoa"), line("Cocoa")), 0);
});
