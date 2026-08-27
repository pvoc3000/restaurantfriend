// filedInvoiceFor — the invoice a reading JOINS instead of duplicating.
//
// The auto-filer had exactly one guard, the attachment's own `invoice_id`, and
// it is per-FILE: it cannot see a second copy of the same invoice (two files,
// two rows, two nulls) and it cannot see the same invoice read on a second
// order. Measured on the live database 2026-08-27: 7 numbers on file twice,
// one of them three times, 15 of 49 invoices.
//
// `findPossibleDuplicates` asks the same question of a HUMAN and warns rather
// than blocking, because a person is there to judge. This is the CERTAIN half
// of it promoted to an action, and the cases below are the boundary of what
// "certain" is allowed to mean.

import { filedInvoiceFor } from "../../src/lib/invoices";
import { eq, test } from "./harness";

const VENDOR = "v-dawn";
const OTHER_VENDOR = "v-bakemark";

function inv(over: Partial<Parameters<typeof filedInvoiceFor>[1][number]> = {}) {
  return {
    id: "i-1",
    vendor_id: VENDOR,
    invoice_number: "96490389",
    status: "open" as const,
    is_credit: false,
    ...over,
  };
}

const reading = (over: Partial<Parameters<typeof filedInvoiceFor>[0]> = {}) => ({
  vendor_id: VENDOR,
  invoice_number: "96490389",
  is_credit: false,
  ...over,
});

test("filedInvoiceFor: the same number at the same vendor is the same bill", () => {
  eq(filedInvoiceFor(reading(), [inv()])?.id, "i-1", "exact");
});

test("filedInvoiceFor: punctuation and case are not a different invoice", () => {
  // The same normalization the printed-PO warning uses, deliberately — the
  // auto-join and the on-screen warning must not disagree about what "the same
  // number" means.
  eq(filedInvoiceFor(reading({ invoice_number: " 96490389 " }), [inv()])?.id, "i-1", "spaces");
  eq(filedInvoiceFor(reading({ invoice_number: "96-490-389" }), [inv()])?.id, "i-1", "hyphens");
  eq(
    filedInvoiceFor(reading({ invoice_number: "arint2000678795" }), [
      inv({ invoice_number: "ARINT2000678795" }),
    ])?.id,
    "i-1",
    "case"
  );
  eq(filedInvoiceFor(reading({ invoice_number: "0450364" }), [inv({ invoice_number: "450364" })])?.id,
    "i-1", "leading zeros");
});

test("filedInvoiceFor: a numberless reading joins NOTHING", () => {
  // A rent bill and a photographed receipt have no key — which is the same
  // reason migration 025 declines a unique index. Two nulls are not a match,
  // and treating them as one would file every numberless bill from a vendor
  // onto the first one ever recorded.
  eq(filedInvoiceFor(reading({ invoice_number: null }), [inv({ invoice_number: null })]), null, "both null");
  eq(filedInvoiceFor(reading({ invoice_number: "   " }), [inv({ invoice_number: null })]), null, "blank");
});

test("filedInvoiceFor: a credit memo does not merge into the bill it credits", () => {
  // The case migration 025's constraint discussion names: a credit memo
  // legitimately repeats the number of the invoice it credits.
  eq(filedInvoiceFor(reading({ is_credit: true }), [inv()]), null, "credit vs invoice");
  eq(filedInvoiceFor(reading(), [inv({ is_credit: true })]), null, "invoice vs credit");
  eq(filedInvoiceFor(reading({ is_credit: true }), [inv({ is_credit: true })])?.id, "i-1", "credit vs credit");
});

test("filedInvoiceFor: a void invoice no longer holds its number", () => {
  // Void means somebody decided that record should not exist. Filing the
  // document again is how you replace it, so it must be free to create.
  eq(filedInvoiceFor(reading(), [inv({ status: "void" })]), null, "void");
  eq(
    filedInvoiceFor(reading(), [inv({ id: "i-void", status: "void" }), inv({ id: "i-live" })])?.id,
    "i-live",
    "the live one wins over the voided one"
  );
});

test("filedInvoiceFor: another vendor's invoice number is not ours", () => {
  // Two distributors numbering from 1 is the ordinary case, not an edge one.
  eq(filedInvoiceFor(reading(), [inv({ vendor_id: OTHER_VENDOR })]), null, "other vendor");
});

test("filedInvoiceFor: a different number is a different bill", () => {
  eq(filedInvoiceFor(reading(), [inv({ invoice_number: "96490390" })]), null, "off by one digit");
  eq(filedInvoiceFor(reading(), []), null, "nothing on file");
});
