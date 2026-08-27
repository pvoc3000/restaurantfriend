// printedVendorDisagreement — the invoice says whose bill it is, and now we
// check.
//
// It exists because of one real record: a Dawn Foods invoice attached to a
// Vesta Foodservice order put $1,985.99 of Dawn's bill on the books under
// Vesta. The filer takes the vendor from the ORDER and never from the page, so
// no number-based check could catch it — the record was filed under a vendor
// the invoice has nothing to do with.
//
// EVERY PAIR BELOW IS REAL, transcribed from the 49 readings on file. Only
// three of the twelve match as text, which is why the threshold is "shares no
// distinctive word" and not similarity: anything stricter flags nine of twelve,
// and a mark that fires on three quarters of deliveries means nothing on the
// one that matters.

import { printedVendorDisagreement } from "../../src/lib/invoices";
import { eq, test } from "./harness";

const read = (vendor_name: string | null) =>
  ({ vendor_name, lines: [] }) as never;

const check = (printed: string | null, ours: string | null) =>
  printedVendorDisagreement(read(printed), ours);

test("printedVendorDisagreement: the real pairs on file are all silent", () => {
  // Our catalog carries the name staff say; the invoice prints the name lawyers
  // use. None of these is a disagreement.
  eq(check("BAKEMARK USA LLC", "BakeMark"), null, "legal suffix and case");
  eq(check("BakeMark", "BakeMark"), null, "identical");
  eq(check("VESTA FOODSERVICE", "Vesta Foodservice"), null, "case only");
  eq(check("The Chefs' Warehouse West Coast, LLC", "Chefs Warehouse"), null, "apostrophe, article, region");
  eq(check("The Chefs' Warehouse West Coast, LLC / Greenleaf", "Chefs Warehouse"), null, "and a trading name");
  eq(check("The Chefs' Warehouse West Coast, LLC (Greenleaf)", "Chefs Warehouse"), null, "bracketed");
  eq(check("Dawn Food Products, Inc.", "Dawn Foods"), null, "plural — the SKU matcher's lesson");
  eq(check("Dawn Food Products Inc", "Dawn Foods"), null, "unpunctuated");
  eq(check("Stumptown Coffee Roasters", "Stumptown"), null, "ours is a short form");
  eq(check("Unified Paper & Packaging", "Unified Paper"), null, "ampersand");
  eq(check("Amoretti", "Amoretti"), null, "one word");
  eq(check("Cook Flavoring Company", "Cook's Vanilla"), null, "a nickname sharing one word");
});

test("printedVendorDisagreement: the record that prompted this speaks up", () => {
  // The live row, before the cleanup: Dawn's invoice filed under Vesta.
  eq(
    check("Dawn Food Products, Inc.", "Vesta Foodservice"),
    "Dawn Food Products, Inc.",
    "shares nothing — and reports what is PRINTED, for checking against paper"
  );
  eq(check("BAKEMARK USA LLC", "Chefs Warehouse"), "BAKEMARK USA LLC", "two real vendors");
});

test("printedVendorDisagreement: a shared TRADE word is not a shared identity", () => {
  // Without the noise list these share "paper" and stay quiet on a real
  // mis-filing; with it they share nothing.
  eq(check("Smart Paper Co", "Unified Paper"), "Smart Paper Co", "paper");
  eq(check("Sysco Foodservice", "Vesta Foodservice"), "Sysco Foodservice", "foodservice");
  eq(check("Acme Food Products Inc", "Dawn Foods"), "Acme Food Products Inc", "food products");
});

test("printedVendorDisagreement: a plural is not a different company", () => {
  // NOT one of the measured pairs, and pinned deliberately anyway. On the seven
  // real vendors the fold changes nothing — "Dawn Foods" and "Dawn Food
  // Products" already share `dawn`, and `foods`/`food` are noise either way —
  // so a break-check found it inert and this is the shape that makes it
  // load-bearing: a vendor whose ONE distinctive word is the plural.
  eq(check("Roaster Coffee Co", "Roasters"), null, "the only overlap is the plural");
  // Both sides fold the same way, so this is a canonical form and not a
  // dictionary; mangling a word that merely ends in `s` costs nothing.
  eq(check("Bro Trading", "Bros"), null, "folded on both sides");
});

test("printedVendorDisagreement: silence where it cannot judge", () => {
  // An absent answer is not a disagreement — the rule `printedPoDisagreement`
  // already turns on, for the vendor whose paperwork is simply built
  // differently.
  eq(check(null, "Dawn Foods"), null, "nothing printed");
  eq(check("   ", "Dawn Foods"), null, "blank");
  eq(check("Dawn Foods", null), null, "no vendor on our side");
  // A name that reduces to nothing distinctive can convict nobody.
  eq(check("Foodservice Supply Co", "Dawn Foods"), null, "all noise on the printed side");
  eq(check("Dawn Food Products", "Food Supply Company"), null, "all noise on ours");
});
