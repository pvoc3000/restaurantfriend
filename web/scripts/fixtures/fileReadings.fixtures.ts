// unfiledReadings / fileReadingsLabel — the offer made when an order is closed.
//
// `closeReadiness` has named this gap since it was written ("the paperwork on
// file isn't recorded as a bill yet") and until now only PO detail's Paperwork
// card could act on it — the receiving screen, where Complete lives, named it
// in a confirm and offered no way to settle it. Measured on the live database
// 2026-08-27: 8 closed orders are in exactly that state.

import { unfiledReadings } from "../../src/lib/attachments";
import { fileReadingsLabel } from "../../src/lib/invoices";
import { eq, test } from "./harness";

const reading = (number: string | null) =>
  ({ invoice_number: number, lines: [] }) as never;

const att = (over: Record<string, unknown> = {}) => ({
  id: "a-1",
  kind: "invoice" as const,
  extraction: reading("73535581"),
  invoice_id: null,
  ...over,
});

test("unfiledReadings: a read invoice with no bill is offered", () => {
  eq(unfiledReadings([att()]).length, 1, "the whole point");
});

test("unfiledReadings: anything already recorded is not offered again", () => {
  // The rule that stops a second record being minted for one invoice — the
  // duplicate bug this module spent two commits on.
  eq(unfiledReadings([att({ invoice_id: "i-1" })]).length, 0, "already filed");
});

test("unfiledReadings: a document nobody has read is not offered", () => {
  // There is nothing to file: a bill is made from a READING, and "Read invoice"
  // is the step in front of this one.
  eq(unfiledReadings([att({ extraction: null })]).length, 0, "unread");
});

test("unfiledReadings: only an INVOICE is a bill", () => {
  // A packing slip or a photo may well have been read, and neither is a bill.
  // `kind` is what the person said the document was when they attached it.
  eq(unfiledReadings([att({ kind: "packing_slip" })]).length, 0, "packing slip");
  eq(unfiledReadings([att({ kind: "photo" })]).length, 0, "photo");
  eq(unfiledReadings([]).length, 0, "nothing attached");
});

test("fileReadingsLabel: one invoice is named by the number on the paper", () => {
  // PRINTED, not normalized — the reader is checking this against paper.
  eq(fileReadingsLabel([att()]), "Also file invoice 73535581 as a bill", "named");
  eq(
    fileReadingsLabel([att({ extraction: reading(" 0450364 ") })]),
    "Also file invoice 0450364 as a bill",
    "as printed, leading zero and all"
  );
});

test("fileReadingsLabel: two PAGES of one invoice are ONE bill", () => {
  // The distinction the whole label exists for: two attachments that will JOIN
  // into a single record. "File 2 invoices" would promise something the write
  // does not do, and would read as the duplicate bug still being there.
  eq(
    fileReadingsLabel([att(), att({ id: "a-2" })]),
    "Also file invoice 73535581 as a bill",
    "same number twice"
  );
});

test("fileReadingsLabel: two different invoices are two bills", () => {
  eq(
    fileReadingsLabel([att(), att({ id: "a-2", extraction: reading("96490389") })]),
    "Also file these 2 invoices as bills",
    "different numbers"
  );
});

test("fileReadingsLabel: a numberless reading is its own bill", () => {
  // Nothing to join it to — the same reason `filedInvoiceFor` refuses to match
  // one — so two of them are two bills, not one.
  eq(fileReadingsLabel([att({ extraction: reading(null) })]), "Also file this invoice as a bill", "one");
  eq(
    fileReadingsLabel([att({ extraction: reading(null) }), att({ id: "a-2", extraction: reading(null) })]),
    "Also file these 2 invoices as bills",
    "two"
  );
});
