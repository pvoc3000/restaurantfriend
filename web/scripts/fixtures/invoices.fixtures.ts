// lib/invoices — aging, duplicates, the money checks, the approval caveats, and
// the reading → record normalization. Plus the two additive matchers in
// lib/invoiceMatch that the Invoices module adds.
//
// Written to FAIL when the code is wrong: checked by breaking `agingBucket`'s
// due-today boundary, `lineSumReconciliation`'s item-only filter, and
// `invoiceHeaderFromExtraction`'s credit normalization, and confirming cases
// went red each time.

import { eq, no, ok, test } from "./harness";
import { invoiceLine, poLine, withCatalog } from "./factories";
import {
  agingBucket,
  amountReconciliation,
  approvalReadiness,
  findPossibleDuplicates,
  invoiceHeaderFromExtraction,
  invoiceLinesFromExtraction,
  lineSumReconciliation,
  matchPrintedPoNumber,
  normalizeInvoiceNumber,
  printedPoDisagreement,
  printedPoNumber,
  signedTotal,
  sumSignedTotals,
  type VendorInvoice,
  type VendorInvoiceLine,
} from "../../src/lib/invoices";
import {
  invoiceDueDate,
  isCreditReading,
  type InvoiceExtraction,
} from "../../src/lib/invoiceExtraction";
import {
  matchInvoiceToOrders,
  matchesFromLinks,
} from "../../src/lib/invoiceMatch";

// --------------------------------------------------------------- builders

function extraction(over: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    vendor_name: null,
    invoice_number: null,
    invoice_date: null,
    invoice_total: null,
    lines: [],
    notes: null,
    ...over,
  };
}

let invSeq = 0;
function invoice(over: Partial<VendorInvoice> = {}): VendorInvoice {
  invSeq += 1;
  return {
    id: `inv-${invSeq}`,
    org_id: "org-1",
    location_id: "loc-1",
    vendor_id: "vendor-1",
    invoice_number: null,
    invoice_date: null,
    due_date: null,
    terms: null,
    subtotal: null,
    tax: null,
    freight: null,
    other_charges: null,
    total: null,
    is_credit: false,
    status: "open",
    approved_at: null,
    approved_by: null,
    source: "manual",
    notes: null,
    synced_at: null,
    financials_touched_at: null,
    qbo_linked: false,
    qbo_balance: null,
    qbo_checked_at: null,
    ...over,
  };
}

let lineSeq = 0;
function invLine(over: Partial<VendorInvoiceLine> = {}): VendorInvoiceLine {
  lineSeq += 1;
  return {
    id: `il-${lineSeq}`,
    invoice_id: "inv-1",
    purchase_order_id: null,
    purchase_order_item_id: null,
    line_no: lineSeq,
    product_id: null,
    alt_product_id: null,
    description: null,
    pack: null,
    qty: null,
    unit_price: null,
    extended: null,
    kind: "item",
    notes: null,
    ...over,
  };
}

// ============================================================== 1. Aging

const TODAY = "2026-08-04";

test("aging: overdue by one day", () => {
  eq(agingBucket("2026-08-03", TODAY), "overdue");
});

test("aging: due TODAY is due7, not overdue — you have until end of day", () => {
  eq(agingBucket(TODAY, TODAY), "due7");
});

test("aging: exactly +7 is still due7", () => {
  eq(agingBucket("2026-08-11", TODAY), "due7");
});

test("aging: +8 falls to due30", () => {
  eq(agingBucket("2026-08-12", TODAY), "due30");
});

test("aging: exactly +30 is still due30", () => {
  eq(agingBucket("2026-09-03", TODAY), "due30");
});

test("aging: +31 is later", () => {
  eq(agingBucket("2026-09-04", TODAY), "later");
});

test("aging: no due date is its own bucket, never 'later'", () => {
  eq(agingBucket(null, TODAY), "nodate");
});

test("aging: a malformed due date is nodate, not a crash or a wrong bucket", () => {
  eq(agingBucket("2026-02-31", TODAY), "nodate");
  eq(agingBucket("09/13/2026", TODAY), "nodate");
});

test("aging: crosses a month and a year boundary correctly", () => {
  eq(agingBucket("2027-01-01", "2026-12-31"), "due7");
  eq(agingBucket("2026-12-31", "2027-01-01"), "overdue");
});

// The one that pays for the whole timezone discipline. A bill due today is not
// overdue — but a UTC host computing "today" after 5pm Pacific has already
// rolled to tomorrow, which would make it so.
test("aging: the org's day, not the host's — a bill due today isn't overdue at 4pm Pacific", () => {
  // 2026-08-04 23:30 UTC = 2026-08-04 16:30 America/Los_Angeles.
  const instant = new Date("2026-08-04T23:30:00Z");
  const pacific = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const utc = instant.toISOString().slice(0, 10);

  eq(pacific, "2026-08-04", "the Pacific calendar day");
  eq(utc, "2026-08-04", "the UTC calendar day at 23:30 is still the 4th");

  // And the case that actually bites, half an hour later:
  const later = new Date("2026-08-05T00:30:00Z"); // 17:30 Pacific on the 4th
  const pacificLater = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(later);
  eq(pacificLater, "2026-08-04", "still the 4th in the org's timezone");
  eq(later.toISOString().slice(0, 10), "2026-08-05", "but the 5th in UTC");

  eq(agingBucket("2026-08-04", pacificLater), "due7", "org day: due today");
  eq(
    agingBucket("2026-08-04", later.toISOString().slice(0, 10)),
    "overdue",
    "host day: wrongly overdue"
  );
});

test("aging: an approved invoice still buckets — approval is not payment", () => {
  // Nothing in agingBucket reads status, which is the point: "approved and
  // overdue" is a real state and the list must be able to show it.
  eq(agingBucket("2026-07-01", TODAY), "overdue");
});

// ========================================================= 2. Duplicates

test("duplicates: exact number at the same vendor is rank 0", () => {
  const a = invoice({ invoice_number: "112-181120-01" });
  const b = invoice({ invoice_number: "112-181120-01" });
  const found = findPossibleDuplicates(a, [b]);
  eq(found.length, 1);
  eq(found[0].rank, 0);
  eq(found[0].invoice.id, b.id);
});

test("duplicates: the same number at a DIFFERENT vendor is not a duplicate", () => {
  const a = invoice({ invoice_number: "1001" });
  const b = invoice({ invoice_number: "1001", vendor_id: "vendor-2" });
  eq(findPossibleDuplicates(a, [b]).length, 0);
});

test("duplicates: case, spaces, dashes and leading zeros are formatting", () => {
  const a = invoice({ invoice_number: "0112-181120-01" });
  const b = invoice({ invoice_number: " 112 181120 01 " });
  eq(findPossibleDuplicates(a, [b]).length, 1);
});

test("duplicates: an invoice never reports itself", () => {
  const a = invoice({ invoice_number: "1001" });
  eq(findPossibleDuplicates(a, [{ ...a, status: "open" }]).length, 0);
});

test("duplicates: a credit memo carrying its invoice's number IS reported", () => {
  // Right answer: the warning is exactly where a human says "no, that's the
  // credit". A unique constraint would have refused it instead — see 025.
  const credit = invoice({ invoice_number: "73341407", is_credit: true, total: 42 });
  const bill = invoice({ invoice_number: "73341407", total: 942.1 });
  eq(findPossibleDuplicates(credit, [bill]).length, 1);
});

test("duplicates: numberless, same vendor, same total, 3 days apart is rank 1", () => {
  const a = invoice({ total: 2400, invoice_date: "2026-08-01" });
  const b = invoice({ total: 2400, invoice_date: "2026-08-04" });
  const found = findPossibleDuplicates(a, [b]);
  eq(found.length, 1);
  eq(found[0].rank, 1);
});

test("duplicates: the same total 30 days apart is the monthly rent, not a duplicate", () => {
  const a = invoice({ total: 2400, invoice_date: "2026-07-01" });
  const b = invoice({ total: 2400, invoice_date: "2026-08-01" });
  eq(findPossibleDuplicates(a, [b]).length, 0);
});

test("duplicates: a VOID invoice is not raised — it has already been dealt with", () => {
  const a = invoice({ invoice_number: "1001" });
  const b = { ...invoice({ invoice_number: "1001" }), status: "void" as const };
  eq(findPossibleDuplicates(a, [b]).length, 0);
});

test("duplicates: rank 0 sorts ahead of rank 1", () => {
  const a = invoice({ invoice_number: "1001", total: 500, invoice_date: "2026-08-01" });
  const near = invoice({ total: 500, invoice_date: "2026-08-02" });
  const exact = invoice({ invoice_number: "1001" });
  const found = findPossibleDuplicates(a, [near, exact]);
  eq(found.length, 2);
  eq(found[0].rank, 0);
  eq(found[1].rank, 1);
});

test("normalizeInvoiceNumber: empty and whitespace-only are null", () => {
  eq(normalizeInvoiceNumber(null), null);
  eq(normalizeInvoiceNumber("   "), null);
  eq(normalizeInvoiceNumber("--"), null);
});

// ====================================================== 3. Money checks

test("amounts: 100 + 8.25 + 15 = 123.25 reconciles", () => {
  const check = amountReconciliation(
    invoice({ subtotal: 100, tax: 8.25, freight: 15, other_charges: 0, total: 123.25 })
  );
  no(check.differs);
  eq(check.computed, 123.25);
});

test("amounts: a third of a cent out is the same number", () => {
  const check = amountReconciliation(
    invoice({ subtotal: 100, tax: 8.25, freight: 15, other_charges: 0, total: 123.253 })
  );
  no(check.differs);
});

test("amounts: a whole cent out is a disagreement", () => {
  const check = amountReconciliation(
    invoice({ subtotal: 100, tax: 8.25, freight: 15, other_charges: 0, total: 123.26 })
  );
  ok(check.differs);
});

test("amounts: no subtotal is UNVERIFIABLE, not a disagreement", () => {
  // BakeMark 452660, verbatim (Mark, 2026-09-02). The reader found no subtotal
  // and wrote `tax: 0`, which is the honest reading of an invoice printing no
  // tax — and that one zero used to take it out of the "nothing at the foot"
  // branch, so it reported the parts adding to $0.00 against $1,001.26 on an
  // invoice whose seven lines sum to $1,001.26 exactly.
  const check = amountReconciliation(
    invoice({ subtotal: null, tax: 0, freight: null, other_charges: null, total: 1001.26 })
  );
  no(check.differs);
  eq(check.computed, null, "there is nothing to add up");
  ok(check.missing.includes("subtotal"), "and it still says the subtotal was never read");

  // The same shape with every part absent — the rent bill — is unchanged.
  const rent = amountReconciliation(
    invoice({ subtotal: null, tax: null, freight: null, other_charges: null, total: 4200 })
  );
  no(rent.differs);
  eq(rent.computed, null);

  // A subtotal PRESENT and wrong is still a disagreement. The fix must not have
  // turned the check off.
  const wrong = amountReconciliation(
    invoice({ subtotal: 900, tax: 0, freight: null, other_charges: null, total: 1001.26 })
  );
  ok(wrong.differs, "a real subtotal that does not add up still reports");
});

test("amounts: a null part counts as zero but is NAMED", () => {
  const check = amountReconciliation(
    invoice({ subtotal: 100, tax: null, freight: null, other_charges: null, total: 100 })
  );
  no(check.differs, "100 with nothing added is 100");
  eq(check.missing, ["tax", "freight", "other"]);
});

test("amounts: a total with no parts printed at all makes no claim", () => {
  const check = amountReconciliation(invoice({ total: 2400 }));
  no(check.differs);
  eq(check.computed, null, "nothing to add");
  eq(check.stated, 2400);
});

test("amounts: a credit's stored magnitudes still reconcile", () => {
  const credit = invoice({
    is_credit: true,
    subtotal: 40,
    tax: 2,
    freight: null,
    other_charges: null,
    total: 42,
  });
  no(amountReconciliation(credit).differs);
  eq(signedTotal(credit), -42, "and it subtracts from what we owe");
});

// The case most likely to be got wrong, and the reason lineSumReconciliation
// filters by kind: the reader put the delivery fee on a line AND in the foot,
// because it was printed in both places.
test("lines: a freight LINE and a header freight amount are not double-counted", () => {
  const lines = [
    invLine({ extended: 100, kind: "item" }),
    invLine({ extended: 15, kind: "freight" }),
  ];
  const check = lineSumReconciliation(lines, 100);
  no(check.differs, "the item lines alone are the subtotal");
  eq(check.computed, 100);

  // ...and the foot still adds up with that same 15 counted once.
  no(
    amountReconciliation(
      invoice({ subtotal: 100, tax: 0, freight: 15, other_charges: 0, total: 115 })
    ).differs
  );
});

test("lines: an 'other' line is excluded from the subtotal check too", () => {
  const lines = [
    invLine({ extended: 100, kind: "item" }),
    invLine({ extended: 5, kind: "other" }),
  ];
  no(lineSumReconciliation(lines, 100).differs);
});

test("lines: item lines that don't reach the subtotal DO disagree", () => {
  const lines = [invLine({ extended: 90, kind: "item" })];
  ok(lineSumReconciliation(lines, 100).differs);
});

test("lines: a zero-line invoice makes no claim about its subtotal", () => {
  no(lineSumReconciliation([], 2400).differs);
});

test("lines: lines with no stated subtotal make no claim either", () => {
  no(lineSumReconciliation([invLine({ extended: 90 })], null).differs);
});

test("signedTotal: a bill adds and a credit subtracts", () => {
  eq(sumSignedTotals([invoice({ total: 100 }), invoice({ total: 40, is_credit: true })]), 60);
});

test("signedTotal: a null total is zero, not NaN", () => {
  eq(signedTotal(invoice({ total: null })), 0);
});

// ================================================== 4. Approval caveats

const NO_DUPES: ReturnType<typeof findPossibleDuplicates> = [];

test("approval: a clean rent bill reports nothing", () => {
  const caveats = approvalReadiness(
    invoice({ total: 2400 }),
    [],
    [],
    1,
    NO_DUPES,
    null
  );
  eq(caveats, []);
});

test("approval: a bill with NO lines attributed to a PO is silent about it", () => {
  // The rent bill again. Complaining every time is how a caveat becomes noise.
  const caveats = approvalReadiness(
    invoice({ total: 2400 }),
    [invLine({ extended: 2400 })],
    [],
    1,
    NO_DUPES,
    null
  );
  no(
    caveats.some((c) => c.includes("attributed")),
    "no purchase-order caveat on a bill that has no purchase order"
  );
});

test("approval: a PARTLY attributed invoice does report the stragglers", () => {
  const caveats = approvalReadiness(
    invoice({ total: 115 }),
    [
      invLine({ extended: 100, purchase_order_id: "po-1" }),
      invLine({ extended: 15, purchase_order_id: null }),
    ],
    [],
    1,
    NO_DUPES,
    null
  );
  ok(caveats.some((c) => c.includes("1 line isn't attributed")));
});

test("approval: no document attached is named", () => {
  const caveats = approvalReadiness(invoice({ total: 100 }), [], [], 0, NO_DUPES, null);
  ok(caveats.some((c) => c.includes("no document")));
});

test("approval: a price differing from the linked order is named with the PO number", () => {
  const line = withCatalog(poLine({ product_id: "A1", unit_price: 10, qty_received: 2 }));
  const caveats = approvalReadiness(
    invoice({ total: 24 }),
    [],
    [
      {
        poNumber: "112-181120-01",
        matches: [
          {
            line,
            invoice: invoiceLine({ product_id: "A1", qty: 2, extended: 24 }),
            by: "product_id",
            qtyDiffers: false,
            priceDiffers: true,
            unitPrice: 12,
            priceUncertain: false,
          },
        ],
      },
    ],
    1,
    NO_DUPES,
    null
  );
  ok(caveats.some((c) => c.includes("112-181120-01") && c.includes("price")));
});

test("approval: billed for MORE than was received is named", () => {
  const line = withCatalog(poLine({ product_id: "A1", unit_price: 10, qty_received: 2 }));
  const caveats = approvalReadiness(
    invoice({ total: 40 }),
    [],
    [
      {
        poNumber: "PO-9",
        matches: [
          {
            line,
            invoice: invoiceLine({ product_id: "A1", qty: 4, extended: 40 }),
            by: "product_id",
            qtyDiffers: true,
            priceDiffers: false,
            unitPrice: 10,
            priceUncertain: false,
          },
        ],
      },
    ],
    1,
    NO_DUPES,
    null
  );
  ok(caveats.some((c) => c.includes("billed for more than was received")));
});

// The mirror of LineMatch.qtyDiffers' own reasoning: an unreceived line has
// nothing to disagree with, and reporting it would flag every open order.
test("approval: a line with NO received quantity is not 'over-billed'", () => {
  const line = withCatalog(poLine({ product_id: "A1", unit_price: 10, qty_received: null }));
  const caveats = approvalReadiness(
    invoice({ total: 40 }),
    [],
    [
      {
        poNumber: "PO-9",
        matches: [
          {
            line,
            invoice: invoiceLine({ product_id: "A1", qty: 4, extended: 40 }),
            by: "product_id",
            qtyDiffers: false,
            priceDiffers: false,
            unitPrice: 10,
            priceUncertain: false,
          },
        ],
      },
    ],
    1,
    NO_DUPES,
    null
  );
  no(caveats.some((c) => c.includes("billed for more")));
});

test("approval: received but not billed is named", () => {
  const line = withCatalog(poLine({ product_id: "A1", unit_price: 10, qty_received: 3 }));
  const caveats = approvalReadiness(
    invoice({ total: 0 }),
    [],
    [
      {
        poNumber: "PO-9",
        matches: [
          {
            line,
            invoice: null,
            by: null,
            qtyDiffers: false,
            priceDiffers: false,
            unitPrice: null,
            priceUncertain: false,
          },
        ],
      },
    ],
    1,
    NO_DUPES,
    null
  );
  ok(caveats.some((c) => c.includes("received on PO-9")));
});

test("approval: a possible duplicate and a vendor-name disagreement are both named", () => {
  const dupes = findPossibleDuplicates(
    invoice({ invoice_number: "1001" }),
    [invoice({ invoice_number: "1001" })]
  );
  const caveats = approvalReadiness(
    invoice({ total: 100 }),
    [],
    [],
    1,
    dupes,
    "Sysco"
  );
  ok(caveats.some((c) => c.includes("duplicate")));
  ok(caveats.some((c) => c.includes("Sysco")));
});

test("approval: it reports and NEVER blocks — it only ever returns strings", () => {
  const caveats = approvalReadiness(
    invoice({ subtotal: 100, tax: 1, freight: 1, other_charges: 1, total: 999 }),
    [],
    [],
    0,
    NO_DUPES,
    "Someone Else"
  );
  ok(caveats.length >= 3, "several caveats");
  ok(Array.isArray(caveats), "a list to show, not a refusal to act on");
});

// ============================= 5. The reading → record normalization

test("header: a plain reading passes through, with dates round-tripped", () => {
  const draft = invoiceHeaderFromExtraction(
    extraction({
      invoice_number: " 73341407 ",
      invoice_date: "2026-08-03",
      due_date: "2026-09-02",
      terms: "Net 30",
      subtotal: 100,
      tax: 8.25,
      invoice_total: 108.25,
    })
  );
  eq(draft.invoice_number, "73341407", "trimmed");
  eq(draft.invoice_date, "2026-08-03");
  eq(draft.due_date, "2026-09-02");
  eq(draft.terms, "Net 30");
  eq(draft.total, 108.25);
  no(draft.is_credit);
});

test("header: a due date that doesn't exist is refused, not rolled over", () => {
  // new Date("2026-02-31") silently becomes March 2nd — a regex would pass it.
  eq(invoiceDueDate(extraction({ due_date: "2026-02-31" })), null);
  eq(invoiceDueDate(extraction({ due_date: "2026-13-09" })), null);
  eq(invoiceDueDate(extraction({ due_date: "09/13/2026" })), null);
  eq(invoiceDueDate(extraction({ due_date: "2026-08-04" })), "2026-08-04");
  eq(invoiceHeaderFromExtraction(extraction({ due_date: "2026-02-31" })).due_date, null);
});

test("credit: the flag with positive amounts stores positive", () => {
  const draft = invoiceHeaderFromExtraction(
    extraction({ is_credit: true, invoice_total: 142.1, subtotal: 142.1 })
  );
  ok(draft.is_credit);
  eq(draft.total, 142.1);
  eq(draft.subtotal, 142.1);
});

test("credit: a negative total with no flag is still a credit", () => {
  const draft = invoiceHeaderFromExtraction(extraction({ invoice_total: -142.1 }));
  ok(draft.is_credit, "the words at the top were missed; the sign was not");
  eq(draft.total, 142.1, "stored positive");
});

// The classic bug this normalization exists to prevent.
test("credit: flag AND negative amounts are not double-flipped", () => {
  const draft = invoiceHeaderFromExtraction(
    extraction({ is_credit: true, invoice_total: -142.1, subtotal: -130, tax: -12.1 })
  );
  ok(draft.is_credit);
  eq(draft.total, 142.1);
  eq(draft.subtotal, 130);
  eq(draft.tax, 12.1);
  eq(signedTotal({ total: draft.total, is_credit: draft.is_credit }), -142.1);
});

test("credit: an ordinary positive bill is not a credit", () => {
  no(isCreditReading(extraction({ invoice_total: 942.1 })));
  no(invoiceHeaderFromExtraction(extraction({ invoice_total: 942.1 })).is_credit);
});

test("header: a null total stays null rather than becoming 0", () => {
  eq(invoiceHeaderFromExtraction(extraction({})).total, null);
  eq(invoiceHeaderFromExtraction(extraction({})).tax, null);
});

test("lines from a reading are numbered in printed order and start as items", () => {
  const lines = invoiceLinesFromExtraction(
    extraction({
      lines: [
        invoiceLine({ product_id: " A1 ", description: "Flour", qty: 2, extended: 40 }),
        invoiceLine({ product_id: "B2", description: "Sugar", qty: 1, extended: 12 }),
      ],
    })
  );
  eq(lines.length, 2);
  eq(lines[0].line_no, 1);
  eq(lines[1].line_no, 2);
  eq(lines[0].product_id, "A1", "trimmed");
  eq(lines[0].kind, "item");
  eq(lines[0].purchase_order_id, null, "nothing is linked until someone links it");
});

// ================================== 6. The printed purchase order number

test("printed PO: a header number with no per-line numbers is taken", () => {
  eq(printedPoNumber(extraction({ purchase_order_number: "112-181120-01" })), "112-181120-01");
});

test("printed PO: one number repeated on every line is taken", () => {
  eq(
    printedPoNumber(
      extraction({
        lines: [
          invoiceLine({ purchase_order_number: "PO-7" }),
          invoiceLine({ purchase_order_number: "PO-7" }),
        ],
      })
    ),
    "PO-7"
  );
});

test("printed PO: lines that DISAGREE yield nothing — that's the consolidated case", () => {
  eq(
    printedPoNumber(
      extraction({
        purchase_order_number: "PO-7",
        lines: [
          invoiceLine({ purchase_order_number: "PO-7" }),
          invoiceLine({ purchase_order_number: "PO-8" }),
        ],
      })
    ),
    null,
    "picking one of two orders would be worse than saying nothing"
  );
});

test("printed PO: nothing printed anywhere yields null", () => {
  eq(printedPoNumber(extraction({})), null);
});

// --- printedPoDisagreement -------------------------------------------------
// The cases are the real 2026-08 invoices, because the two that matter were
// both found on paper rather than imagined: Chefs Warehouse printing spaces
// for hyphens (agreement that a naive === would have flagged) and the 08-17
// FileMaker week (disagreement nothing was watching for).
//
// Checked by breaking it: dropping the `printed.length === 0` guard reddens
// the BakeMark case, and comparing raw strings instead of
// `normalizeInvoiceNumber` reddens the 08-10 spaces case.

test("PO disagreement: an invoice printing our own number says nothing", () => {
  eq(
    printedPoDisagreement(
      extraction({ purchase_order_number: "132-181142-01" }),
      "132-181142-01"
    ),
    null
  );
});

test("PO disagreement: spaces for hyphens is the SAME number (Chefs Warehouse, 2026-08-10)", () => {
  eq(
    printedPoDisagreement(
      extraction({ purchase_order_number: "132 181164 01" }),
      "132-181164-01"
    ),
    null,
    "punctuation is not a mismatch"
  );
});

test("PO disagreement: a genuinely different order is reported AS PRINTED (2026-08-17)", () => {
  eq(
    printedPoDisagreement(
      extraction({ purchase_order_number: "132-18033-01" }),
      "132-181184-01"
    ),
    ["132-18033-01"]
  );
});

test("PO disagreement: Unified Paper's 2026-08-17 invoice, the second real one", () => {
  eq(
    printedPoDisagreement(
      extraction({ purchase_order_number: "142-18041-01" }),
      "142-181187-01"
    ),
    ["142-18041-01"]
  );
});

test("PO disagreement: an invoice printing NO number is silent, not disagreeing (BakeMark)", () => {
  eq(
    printedPoDisagreement(extraction({}), "112-181186-01"),
    null,
    "the one vendor whose paperwork omits it must not flag every delivery"
  );
});

test("PO disagreement: a consolidated invoice naming us among others agrees", () => {
  eq(
    printedPoDisagreement(
      extraction({
        lines: [
          invoiceLine({ purchase_order_number: "132-181184-01" }),
          invoiceLine({ purchase_order_number: "132-181195-02" }),
        ],
      }),
      "132-181184-01"
    ),
    null,
    "ours being among several is agreement, not a partial one"
  );
});

test("PO disagreement: a consolidated invoice naming only OTHER orders reports all of them", () => {
  eq(
    printedPoDisagreement(
      extraction({
        purchase_order_number: "132-18033-01",
        lines: [invoiceLine({ purchase_order_number: "132-18034-02" })],
      }),
      "132-181184-01"
    ),
    ["132-18033-01", "132-18034-02"]
  );
});

test("PO disagreement: a line number is read even when the header is blank", () => {
  eq(
    printedPoDisagreement(
      extraction({ lines: [invoiceLine({ purchase_order_number: "999-99999-01" })] }),
      "132-181184-01"
    ),
    ["999-99999-01"]
  );
});

const CANDIDATES = [
  { id: "po-a", po_number: "112-181120-01", vendor_id: "vendor-1", location_id: "loc-1" },
  { id: "po-b", po_number: "132-181132-02", vendor_id: "vendor-1", location_id: "loc-1" },
];
const SCOPE = { vendor_id: "vendor-1", location_id: "loc-1" };

test("printed PO match: an exact number resolves", () => {
  eq(matchPrintedPoNumber("112-181120-01", CANDIDATES, SCOPE)?.id, "po-a");
});

test("printed PO match: case, spaces and a stray leading zero are formatting", () => {
  eq(matchPrintedPoNumber(" 0112 181120 01 ", CANDIDATES, SCOPE)?.id, "po-a");
});

test("printed PO match: two candidates answering to it are REFUSED", () => {
  const ambiguous = [
    CANDIDATES[0],
    { ...CANDIDATES[0], id: "po-c" },
  ];
  eq(matchPrintedPoNumber("112-181120-01", ambiguous, SCOPE), null);
});

test("printed PO match: another vendor's order is refused", () => {
  eq(
    matchPrintedPoNumber("112-181120-01", CANDIDATES, {
      vendor_id: "vendor-2",
      location_id: "loc-1",
    }),
    null
  );
});

test("printed PO match: the same number at another location is refused", () => {
  eq(
    matchPrintedPoNumber("112-181120-01", CANDIDATES, {
      vendor_id: "vendor-1",
      location_id: "loc-2",
    }),
    null
  );
});

test("printed PO match: nothing printed matches nothing", () => {
  eq(matchPrintedPoNumber(null, CANDIDATES, SCOPE), null);
  eq(matchPrintedPoNumber("   ", CANDIDATES, SCOPE), null);
});

// ============================ 7. The two additive matchers (invoiceMatch)

test("matchInvoiceToOrders: each order claims its own lines, most confident first", () => {
  const a = { id: "po-a", lines: [withCatalog(poLine({ product_id: "A1" }))] };
  const b = { id: "po-b", lines: [withCatalog(poLine({ product_id: "B2" }))] };
  const invoiceLines = [
    invoiceLine({ product_id: "A1", description: "Flour", qty: 1, extended: 10 }),
    invoiceLine({ product_id: "B2", description: "Sugar", qty: 1, extended: 12 }),
  ];
  const results = matchInvoiceToOrders([a, b], invoiceLines);
  eq(results.get("po-a")!.matches[0].invoice?.product_id, "A1");
  eq(results.get("po-b")!.matches[0].invoice?.product_id, "B2");
  eq(results.get("po-b")!.unmatchedInvoice.length, 0, "everything was claimed");
});

test("matchInvoiceToOrders: a line matchable by BOTH goes to the first order", () => {
  const a = { id: "po-a", lines: [withCatalog(poLine({ product_id: "A1" }))] };
  const b = { id: "po-b", lines: [withCatalog(poLine({ product_id: "A1" }))] };
  const results = matchInvoiceToOrders([a, b], [
    invoiceLine({ product_id: "A1", description: "Flour", qty: 1, extended: 10 }),
  ]);
  ok(results.get("po-a")!.matches[0].invoice, "the first order claims it");
  eq(results.get("po-b")!.matches[0].invoice, null, "and the second does not");
});

test("matchInvoiceToOrders: a SKU ambiguous WITHIN one order is still refused", () => {
  const a = {
    id: "po-a",
    lines: [
      withCatalog(poLine({ product_id: "A1" })),
      withCatalog(poLine({ product_id: "A1" })),
    ],
  };
  const results = matchInvoiceToOrders([a], [
    invoiceLine({ product_id: "A1", description: "Flour", qty: 1, extended: 10 }),
  ]);
  const claimed = results.get("po-a")!.matches.filter((m) => m.invoice !== null);
  eq(claimed.length, 0, "no basis for choosing, so neither is paired");
});

test("matchesFromLinks: a stored link wins over what a fresh match would find", () => {
  const first = withCatalog(poLine({ product_id: "A1", unit_price: 10 }));
  const second = withCatalog(poLine({ product_id: "ZZ", unit_price: 20 }));
  // The invoice line prints A1, which would ordinarily pair with `first` — but
  // a human matched it to `second` at the delivery.
  const linked = {
    ...invoiceLine({ product_id: "A1", description: "Flour", qty: 1, extended: 20 }),
    purchase_order_item_id: second.id,
  };
  const result = matchesFromLinks([first, second], [linked]);
  const bySecond = result.matches.find((m) => m.line.id === second.id)!;
  const byFirst = result.matches.find((m) => m.line.id === first.id)!;
  ok(bySecond.invoice, "the human's link is honoured");
  eq(byFirst.invoice, null, "and the SKU join does not steal it back");
});

test("matchesFromLinks: unlinked lines still get the ordinary SKU join", () => {
  const linkedLine = withCatalog(poLine({ product_id: "A1", unit_price: 10 }));
  const freeLine = withCatalog(poLine({ product_id: "B2", unit_price: 20 }));
  const result = matchesFromLinks(
    [linkedLine, freeLine],
    [
      {
        ...invoiceLine({ product_id: "XX", description: "Flour", qty: 1, extended: 10 }),
        purchase_order_item_id: linkedLine.id,
      },
      {
        ...invoiceLine({ product_id: "B2", description: "Sugar", qty: 1, extended: 20 }),
        purchase_order_item_id: null,
      },
    ]
  );
  eq(result.matches.find((m) => m.line.id === linkedLine.id)!.invoice?.product_id, "XX");
  eq(result.matches.find((m) => m.line.id === freeLine.id)!.invoice?.product_id, "B2");
});

test("matchesFromLinks: the caller's line order is preserved", () => {
  const a = withCatalog(poLine({ product_id: "A1" }));
  const b = withCatalog(poLine({ product_id: "B2" }));
  const c = withCatalog(poLine({ product_id: "C3" }));
  const result = matchesFromLinks(
    [a, b, c],
    [{ ...invoiceLine({ product_id: "B2", description: "Sugar" }), purchase_order_item_id: b.id }]
  );
  eq(
    result.matches.map((m) => m.line.id),
    [a.id, b.id, c.id]
  );
});

test("matchesFromLinks: two invoice lines against ONE order line — the second is left over", () => {
  // The partial-shipment case. Neither line speaks for the other, so the second
  // shows up as billed-but-unmatched rather than silently replacing the first.
  const line = withCatalog(poLine({ product_id: "A1", unit_price: 10 }));
  const result = matchesFromLinks(
    [line],
    [
      { ...invoiceLine({ product_id: "A1", description: "Flour", qty: 1, extended: 10 }), purchase_order_item_id: line.id },
      { ...invoiceLine({ product_id: "A1", description: "Flour", qty: 2, extended: 20 }), purchase_order_item_id: line.id },
    ]
  );
  eq(result.matches[0].invoice?.qty, 1, "the first link stands");
  eq(result.unmatchedInvoice.length, 1, "the second is reported, not swallowed");
});

test("matchesFromLinks: with no links at all it behaves exactly like the plain join", () => {
  const a = withCatalog(poLine({ product_id: "A1" }));
  const result = matchesFromLinks(
    [a],
    [{ ...invoiceLine({ product_id: "A1", description: "Flour" }), purchase_order_item_id: null }]
  );
  eq(result.matches[0].invoice?.product_id, "A1");
});
