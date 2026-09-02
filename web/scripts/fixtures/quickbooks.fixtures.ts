// lib/quickbooks — the QuickBooks Online payload.
//
// The credit case is the one that matters most, and it is asserted against the
// EMITTED JSON rather than an object shape: everything else in this app reaches
// for `signedTotal()`, so the likeliest refactor here is one that helpfully
// reintroduces a minus sign and posts every vendor credit as a bill for minus
// money — which reconciles perfectly on every report anybody looks at.

import { test, eq, ok, no } from "./harness";
import {
  qboRef,
  pushMode,
  billEntity,
  qboEntityPath,
  billPushRefusals,
  docNumberFor,
  billLineDescription,
  buildBillPayload,
  accountingRefFromResponse,
  pushedLabel,
  expenseAccountFor,
  qboTrackingFor,
  qboVendorId,
  splitAccountName,
  DOC_NUMBER_MAX,
  type BillInvoice,
  type BillPushInputs,
} from "../../src/lib/quickbooks";

function invoice(over: Partial<BillInvoice> = {}): BillInvoice {
  return {
    id: "inv-1",
    invoice_number: "73535581",
    invoice_date: "2026-08-17",
    due_date: "2026-09-16",
    total: 472.13,
    is_credit: false,
    status: "approved",
    external_ref: null,
    ...over,
  };
}

function inputs(over: Partial<BillPushInputs> = {}): BillPushInputs {
  return {
    invoice: invoice(),
    vendorRef: "58",
    vendorName: "Chefs Warehouse",
    accountRef: "63",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The ordinary bill
// ---------------------------------------------------------------------------

test("a bill posts as Bill, one line, at its total", () => {
  const { entity, path, body } = buildBillPayload(inputs());
  eq(entity, "Bill", "entity");
  eq(path, "bill", "path");
  eq((body.VendorRef as Record<string, unknown>).value, "58", "VendorRef");
  eq((body.Line as unknown[]).length, 1, "one line only");

  const line = (body.Line as Record<string, unknown>[])[0];
  eq(line.Amount, 472.13, "amount");
  eq(line.DetailType, "AccountBasedExpenseLineDetail", "detail type");
  eq(
    ((line.AccountBasedExpenseLineDetail as Record<string, unknown>)
      .AccountRef as Record<string, unknown>).value,
    "63",
    "AccountRef"
  );
});

test("the dates and doc number ride the bill", () => {
  const { body } = buildBillPayload(inputs());
  eq(body.DocNumber, "73535581", "DocNumber");
  eq(body.TxnDate, "2026-08-17", "TxnDate");
  eq(body.DueDate, "2026-09-16", "DueDate");
  eq(body.PrivateNote, "restaurantfriend inv-1", "PrivateNote traces the record");
});

test("a null date is omitted rather than sent empty", () => {
  const { body } = buildBillPayload(
    inputs({ invoice: invoice({ invoice_date: null, due_date: null }) })
  );
  no("TxnDate" in body, "TxnDate absent");
  no("DueDate" in body, "DueDate absent");
});

// ---------------------------------------------------------------------------
// The credit — the load-bearing case
// ---------------------------------------------------------------------------

test("a credit posts as VendorCredit with a POSITIVE amount", () => {
  const built = buildBillPayload(inputs({ invoice: invoice({ is_credit: true }) }));
  eq(built.entity, "VendorCredit", "entity");
  eq(built.path, "vendorcredit", "path");

  // Against the emitted JSON, on purpose: an object assertion would let a
  // `signedTotal()` refactor through, and -472.13 posts a credit as a bill for
  // minus money that reconciles on every report.
  const json = JSON.stringify(built.body);
  ok(json.includes('"Amount":472.13'), "amount is positive in the emitted JSON");
  no(json.includes("-472.13"), "no minus sign anywhere in the payload");
});

test("a credit carries no due date", () => {
  // QBO ignores it, and sending one implies a payment schedule for money going
  // the other way.
  const { body } = buildBillPayload(inputs({ invoice: invoice({ is_credit: true }) }));
  no("DueDate" in body, "DueDate absent on a credit");
  eq(body.TxnDate, "2026-08-17", "but the transaction date stays");
});

test("billEntity is where the sign lives", () => {
  eq(billEntity({ is_credit: false }), "Bill", "bill");
  eq(billEntity({ is_credit: true }), "VendorCredit", "credit");
});

// ---------------------------------------------------------------------------
// Create vs update
// ---------------------------------------------------------------------------

test("a first push carries no Id, SyncToken or sparse", () => {
  const { body } = buildBillPayload(inputs());
  no("Id" in body, "Id absent");
  no("SyncToken" in body, "SyncToken absent");
  no("sparse" in body, "sparse absent");
  eq(pushMode(invoice()), "create", "mode");
});

test("a second push is an update carrying all three", () => {
  const pushed = invoice({
    external_ref: { qbo: { id: "1043", sync_token: "3" } },
  });
  const { body } = buildBillPayload(inputs({ invoice: pushed }));
  eq(body.Id, "1043", "Id");
  eq(body.SyncToken, "3", "SyncToken");
  eq(body.sparse, true, "sparse");
  eq(pushMode(pushed), "update", "mode");
});

test("an id without a sync token is not a reference", () => {
  // Both or neither: an id alone cannot be updated, so treating it as pushed
  // would send an update QBO refuses forever.
  eq(qboRef({ qbo: { id: "1043" } }), null, "id alone");
  eq(qboRef({ qbo: { sync_token: "3" } }), null, "token alone");
  eq(qboRef({ qbo: { id: " ", sync_token: "3" } }), null, "blank id");
  eq(qboRef(null), null, "nothing");
  eq(qboRef({ qbo: { id: "1043", sync_token: "3" } }), { id: "1043", syncToken: "3" }, "both");
});

// ---------------------------------------------------------------------------
// DocNumber
// ---------------------------------------------------------------------------

test("DocNumber is capped at 21 and trimmed", () => {
  eq(DOC_NUMBER_MAX, 21, "QBO's own limit");
  eq(docNumberFor("  73535581  "), "73535581", "trimmed");
  eq(docNumberFor("1234567890123456789012345"), "123456789012345678901", "capped");
  eq(docNumberFor("1234567890123456789012345")!.length, 21, "exactly 21");
});

test("a missing invoice number omits DocNumber rather than sending empty", () => {
  eq(docNumberFor(null), undefined, "null");
  eq(docNumberFor("   "), undefined, "blank");
  const { body } = buildBillPayload(inputs({ invoice: invoice({ invoice_number: null }) }));
  no("DocNumber" in body, "absent from the payload");
});

test("the line describes itself, and a caller may override", () => {
  eq(billLineDescription({ invoice_number: "73535581" }), "Invoice 73535581", "default");
  eq(billLineDescription({ invoice_number: null }), "Vendor bill", "no number");
  eq(billLineDescription({ invoice_number: "x" }, "Rent, September"), "Rent, September", "override");
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("nothing but an approved invoice is pushed", () => {
  ok(
    billPushRefusals(inputs({ invoice: invoice({ status: "open" }) }))
      .some((r) => r.includes("approve it first")),
    "an open invoice is refused"
  );
  ok(
    billPushRefusals(inputs({ invoice: invoice({ status: "void" }) }))
      .some((r) => r.includes("void")),
    "a void invoice is refused"
  );
  eq(billPushRefusals(inputs()), [], "an approved one is not");
});

test("an unmapped vendor is refused BY NAME", () => {
  const refusals = billPushRefusals(inputs({ vendorRef: null }));
  eq(refusals.length, 1, "one refusal");
  ok(refusals[0].includes("Chefs Warehouse"), "names the vendor");
});

test("a missing expense account is refused", () => {
  ok(
    billPushRefusals(inputs({ accountRef: null })).some((r) => r.includes("expense account")),
    "named"
  );
});

test("a null total is refused, and so is a negative one", () => {
  ok(
    billPushRefusals(inputs({ invoice: invoice({ total: null }) }))
      .some((r) => r.includes("no total")),
    "null"
  );
  // Amounts are stored positive and the sign lives in `is_credit` (025), so a
  // negative here means the column and the flag disagree — and guessing which
  // is right would post real money the wrong way round.
  ok(
    billPushRefusals(inputs({ invoice: invoice({ total: -472.13 }) }))
      .some((r) => r.includes("negative")),
    "negative"
  );
  eq(billPushRefusals(inputs({ invoice: invoice({ total: 0 }) })), [], "zero is allowed");
});

test("a refused push never builds a payload", () => {
  let threw = false;
  try {
    buildBillPayload(inputs({ vendorRef: null }));
  } catch {
    threw = true;
  }
  ok(threw, "throws rather than posting something QBO will reject");
});

// ---------------------------------------------------------------------------
// Reading QBO's answer back
// ---------------------------------------------------------------------------

test("the saved document becomes the reference we store", () => {
  const ref = accountingRefFromResponse("Bill", {
    Id: 1043,
    SyncToken: 0,
    DocNumber: "73535581",
  });
  // Numbers, because QBO returns them either way and our column is text.
  eq(ref, {
    qbo: { id: "1043", sync_token: "0", doc_number: "73535581", entity: "Bill" },
  }, "reference");
});

test("a sync token of zero is a real token", () => {
  // `0` is falsy and is what QBO returns on every create, so a truthiness check
  // here would refuse every first push.
  const ref = accountingRefFromResponse("Bill", { Id: 1043, SyncToken: 0, DocNumber: null });
  eq(ref.qbo!.sync_token, "0", "kept");
  eq(ref.qbo!.doc_number, null, "no doc number is null, not the string");
});

test("an answer with no id is refused rather than stored", () => {
  let threw = false;
  try {
    accountingRefFromResponse("Bill", { SyncToken: 3 });
  } catch {
    threw = true;
  }
  ok(threw, "throws");
});

test("the pushed label reads as QuickBooks shows it", () => {
  eq(
    pushedLabel({ qbo: { id: "1043", sync_token: "3", doc_number: "73535581", entity: "Bill" } }),
    "In QuickBooks as Bill 73535581",
    "bill"
  );
  eq(
    pushedLabel({ qbo: { id: "77", sync_token: "1", entity: "VendorCredit" } }),
    "In QuickBooks as Credit 77",
    "credit falls back to the id"
  );
  // The one that shipped wrong: a two-way ternary labelled the first real
  // customer invoice "Bill 8797". Which ledger a document landed in is the
  // whole content of this sentence.
  eq(
    pushedLabel({ qbo: { id: "155", sync_token: "0", doc_number: "8797", entity: "Invoice" } }),
    "In QuickBooks as Invoice 8797",
    "an invoice is not a bill"
  );
  // A row written before `entity` was recorded. A/P is the older path, so it
  // is the honest guess — and the only case where a guess is made at all.
  eq(
    pushedLabel({ qbo: { id: "12", sync_token: "0" } }),
    "In QuickBooks as Bill 12",
    "no entity stored falls back to Bill"
  );
  eq(pushedLabel(null), null, "never pushed");
});

test("the entity path is what QBO's URL wants", () => {
  eq(qboEntityPath("Bill"), "bill", "bill");
  eq(qboEntityPath("Invoice"), "invoice", "invoice");
  eq(qboEntityPath("VendorCredit"), "vendorcredit", "credit");
});

// ---------------------------------------------------------------------------
// Which account a vendor's bills post to (migration 082)
// ---------------------------------------------------------------------------

const ORG = { ref: "80", name: "Cost of Goods Sold" };
const NO_VL = {
  external_ref: null,
  expense_account_ref: null,
  expense_account_name: null,
  qbo_location_ref: null,
  qbo_location_name: null,
  qbo_class_ref: null,
  qbo_class_name: null,
};

test("the account is this vendor at this shop, then the org's floor", () => {
  // Mark, 2026-09-01: every QuickBooks setting lives on the vendor's
  // per-location row. The org default in Settings is the only thing under it,
  // so a vendor nobody has configured still posts somewhere.
  eq(
    expenseAccountFor(
      { expense_account_ref: "91", expense_account_name: "Cost of Goods Sold:Baker Items COGs" },
      ORG
    ),
    { ref: "91", name: "Cost of Goods Sold:Baker Items COGs", source: "vendor_location" },
    "the shop's own"
  );
  eq(
    expenseAccountFor(NO_VL, ORG),
    { ref: "80", name: "Cost of Goods Sold", source: "org" },
    "falls to the org"
  );
  eq(expenseAccountFor(null, null), null, "nothing anywhere");
});

test("a BLANK falls through rather than posting nowhere", () => {
  // An emptied field leaves "" behind; sending it would be an empty ref that
  // QuickBooks refuses, after the bill is half-built.
  eq(
    expenseAccountFor({ expense_account_ref: "  ", expense_account_name: "" }, ORG)?.source,
    "org",
    "blank at the shop"
  );
  eq(expenseAccountFor(NO_VL, { ref: " " }), null, "blank at the org");
});

test("nothing set anywhere is refused BY NAME rather than guessed", () => {
  ok(
    billPushRefusals(inputs({ accountRef: null })).some((r) => r.includes("expense account")),
    "named"
  );
});

test("Location and Class are set on the row or not sent", () => {
  // Deliberately no fallback: an org-wide default location would put every
  // shop's bills in the same place, which is the opposite of tracking them.
  const set = qboTrackingFor({
    ...NO_VL,
    qbo_location_ref: "3",
    qbo_location_name: "Highland Park",
    qbo_class_ref: "7",
    qbo_class_name: "DF01",
  });
  eq(set.location, { ref: "3", name: "Highland Park" }, "location");
  eq(set.klass, { ref: "7", name: "DF01" }, "class");

  const none = qboTrackingFor(NO_VL);
  eq(none.location, null, "unset location");
  eq(none.klass, null, "unset class");
  eq(qboTrackingFor(null).location, null, "no row at all");
  eq(qboTrackingFor({ ...NO_VL, qbo_class_ref: "   " }).klass, null, "blank is not a value");
});

test("the QuickBooks vendor is read from the SHOP's row, not the vendor", () => {
  // 026 added `vendor_locations.external_ref` for exactly this and it had never
  // had a reader; `vendors.external_ref` is now the unused one.
  eq(qboVendorId({ qbo: { id: "58" } }), "58", "mapped");
  eq(qboVendorId({ qbo: { id: "  " } }), null, "blank is unmapped");
  eq(qboVendorId(null), null, "no row");
  eq(qboVendorId(NO_VL.external_ref), null, "row with nothing set");
});

test("ClassRef rides the LINE and DepartmentRef the HEADER", () => {
  // The one detail QuickBooks punishes silently: a Bill takes its class per
  // expense line, and a ClassRef on the header is accepted and ignored.
  const { body } = buildBillPayload({
    ...inputs(),
    department: { ref: "3", name: "Highland Park" },
    klass: { ref: "7", name: "DF01" },
  });
  eq((body.DepartmentRef as Record<string, unknown>).value, "3", "department on the header");
  no("ClassRef" in body, "class is NOT on the header");
  const line = (body.Line as Record<string, unknown>[])[0];
  const detail = line.AccountBasedExpenseLineDetail as Record<string, unknown>;
  eq((detail.ClassRef as Record<string, unknown>).value, "7", "class on the line");
});

test("neither is sent when unset", () => {
  const { body } = buildBillPayload(inputs());
  no("DepartmentRef" in body, "no department");
  const detail = (body.Line as Record<string, unknown>[])[0]
    .AccountBasedExpenseLineDetail as Record<string, unknown>;
  no("ClassRef" in detail, "no class");
});

test("a sub-account keeps its parent", () => {
  // The whole point: a bare "Baker Items COGs" is indistinguishable from a
  // top-level account, and that is how a bill posts to the wrong one.
  eq(
    splitAccountName("Cost of Goods Sold:Baker Items COGs"),
    { parent: "Cost of Goods Sold", leaf: "Baker Items COGs" },
    "one level"
  );
  eq(
    splitAccountName("Cost of Goods Sold:Food:Produce Items COGs"),
    { parent: "Cost of Goods Sold:Food", leaf: "Produce Items COGs" },
    "two levels — the LAST colon splits"
  );
  eq(splitAccountName("Advertising"), { parent: null, leaf: "Advertising" }, "top level");
  eq(splitAccountName(null), { parent: null, leaf: "" }, "nothing");
});

// ---------------------------------------------------------------------------
// Customer invoices (A/R)
// ---------------------------------------------------------------------------

import {
  buildInvoicePayload,
  invoicePushRefusals,
  invoiceSplit,
  taxDisagreement,
  attachmentRefusal,
  attachableMetadata,
  attachableFromResponse,
  recordedAttachments,
  withAttachments,
  attachmentsToSend,
  INVOICE_SHEET_KEY,
  type InvoiceOrder,
  type InvoicePushInputs,
} from "../../src/lib/quickbooks";

function order(over: Partial<InvoiceOrder> = {}): InvoiceOrder {
  return {
    id: "so-1",
    number: "9885",
    invoice_date: "2026-08-16",
    due_date: "2026-08-22",
    kind: "order",
    status: "invoice",
    ignore_balance: false,
    external_ref: null,
    ...over,
  };
}

function ar(over: Partial<InvoicePushInputs> = {}): InvoicePushInputs {
  return {
    order: order(),
    customerRef: "142",
    customerName: "Cafe Knotted",
    itemRef: "1",
    taxCodeRef: "2",
    total: 161.77,
    tax: 14.37,
    taxableNet: 147.4,
    nonTaxableNet: 0,
    ...over,
  };
}

test("the lines are NET, and only the taxable part is marked TAX", () => {
  // QuickBooks computes the tax from the lines it is given, and orderTotals
  // does NOT tax delivery or rush — so one combined taxable line would have
  // QuickBooks tax them too and inflate its figure against ours.
  const { body } = buildInvoicePayload(ar({ taxableNet: 120, nonTaxableNet: 27.4 }));
  const lines = body.Line as Record<string, unknown>[];
  eq(lines.length, 2, "two lines");
  eq(lines[0].Amount, 120, "taxable part");
  eq(lines[1].Amount, 27.4, "delivery, rush and non-taxable items");
  const code = (l: Record<string, unknown>) =>
    ((l.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef as Record<string, unknown>).value;
  // A US line's code may only be TAX or NON — a real code id is refused,
  // measured: "Valid line TaxCodes for US should be TAX or NON".
  eq(code(lines[0]), "TAX", "taxable");
  eq(code(lines[1]), "NON", "not taxable");
  eq(Number(lines[0].Amount) + Number(lines[1].Amount), 147.4, "and they sum to the net");
});

test("TxnTaxDetail NAMES A CODE and supplies no figure", () => {
  // Measured against a real company: an empty detail computed nothing, and a
  // supplied TotalTax was either dropped or overwritten with its own rate.
  const { body } = buildInvoicePayload(ar());
  eq(body.TxnTaxDetail, { TxnTaxCodeRef: { value: "2" } }, "code only");
  no(JSON.stringify(body).includes("TotalTax"), "we never state the amount");
});

test("a taxable order with no code configured is refused, an untaxed one is not", () => {
  ok(
    invoicePushRefusals(ar({ taxCodeRef: null })).some((r) => r.includes("tax code")),
    "taxable order refused"
  );
  eq(
    invoicePushRefusals(ar({ taxCodeRef: null, tax: 0, taxableNet: 0, nonTaxableNet: 161.77 })),
    [],
    "an untaxed order needs no code"
  );
});

test("a wholly untaxed order omits TxnTaxDetail and sends one NON line", () => {
  const { body } = buildInvoicePayload(ar({ total: 100, tax: 0, taxableNet: 0, nonTaxableNet: 100 }));
  no("TxnTaxDetail" in body, "absent");
  const lines = body.Line as Record<string, unknown>[];
  eq(lines.length, 1, "the zero taxable line is not sent");
  eq(lines[0].Amount, 100, "whole amount");
});

test("a disagreement about tax is reported, and agreement is silent", () => {
  eq(taxDisagreement(14.37, 14.37), null, "same");
  eq(taxDisagreement(14.37, 14.371), null, "within half a cent");
  // Money reads as money — the confirm two inches above it writes "$20.75".
  ok(taxDisagreement(14.37, 11.79)?.includes("$11.79"), "names theirs, in dollars");
  ok(taxDisagreement(14.37, 11.79)?.includes("$14.37"), "and ours");
  ok(taxDisagreement(14.37, null)?.includes("$0.00"), "a missing figure is zero, and still a difference");
  // The real sandbox reading, 2026-09-02: order #8786 billed 9.5% where the
  // sandbox's California code is 8%. This is the sentence Mark saw.
  eq(
    taxDisagreement(20.75, 17.47),
    "QuickBooks calculated $17.47 of sales tax where this order bills $20.75. " +
      "Its total will differ from the customer's copy.",
    "the sentence, whole"
  );
});

test("only an invoiced or committed order is sent", () => {
  for (const s of ["lead", "quote"]) {
    ok(
      invoicePushRefusals(ar({ order: order({ status: s }) })).some((r) =>
        r.includes("invoiced or committed")
      ),
      `${s} refused`
    );
  }
  ok(
    invoicePushRefusals(ar({ order: order({ status: "cancelled" }) })).some((r) =>
      r.includes("cancelled")
    ),
    "cancelled refused"
  );
  eq(invoicePushRefusals(ar()), [], "invoice stage passes");
  eq(invoicePushRefusals(ar({ order: order({ status: "order" }) })), [], "committed passes");
});

test("a standing order and a template exclude themselves", () => {
  // 051 makes `status` NULL exactly when `kind` is not `order`, so neither has
  // a stage to be at.
  ok(
    invoicePushRefusals(ar({ order: order({ kind: "standing_order", status: null }) })).some((r) =>
      r.includes("recurrence")
    ),
    "standing order"
  );
  ok(
    invoicePushRefusals(ar({ order: order({ kind: "template", status: null }) })).some((r) =>
      r.includes("template")
    ),
    "template"
  );
});

test("a wholesale day billed by statement is not sent on its own", () => {
  // 45 real orders carry `ignore_balance`. Sending each would invoice Cafe
  // Knotted seven times a week for something billed once.
  const refusals = invoicePushRefusals(ar({ order: order({ ignore_balance: true }) }));
  ok(refusals.some((r) => r.includes("billed by statement")), "refused");
  ok(refusals[0].includes("Cafe Knotted"), "and it names them");
});

test("an unmapped customer and a missing item are each refused by name", () => {
  ok(
    invoicePushRefusals(ar({ customerRef: null })).some((r) => r.includes("Cafe Knotted")),
    "customer named"
  );
  ok(
    invoicePushRefusals(ar({ itemRef: null })).some((r) => r.includes("Settings")),
    "item points at where to fix it"
  );
});

test("a negative total is refused rather than sent as an invoice", () => {
  // QuickBooks models a refund as a CreditMemo — its own entity, not an
  // invoice for minus money.
  ok(
    invoicePushRefusals(ar({ total: -50 })).some((r) => r.includes("credit memo")),
    "refused"
  );
});

test("a second push updates rather than duplicating", () => {
  const pushed = order({ external_ref: { qbo: { id: "300", sync_token: "2" } } });
  const { body } = buildInvoicePayload(ar({ order: pushed }));
  eq(body.Id, "300", "Id");
  eq(body.SyncToken, "2", "SyncToken");
  eq(body.sparse, true, "sparse");
});

test("the split always sums to the net, however the discount fell", () => {
  const totals = {
    subtotal: 200, taxableSubtotal: 150, discount: 20,
    deliveryCharge: 30, rushFee: 10, tax: 13.16, total: 233.16,
  };
  const { taxableNet, nonTaxableNet } = invoiceSplit(totals);
  // 150 taxable × (180/200 kept) = 135
  eq(taxableNet, 135, "the discounted taxable part");
  eq(nonTaxableNet, 85, "non-taxable items, delivery and rush");
  eq(taxableNet + nonTaxableNet, 220, "and they sum to total minus tax");
});

test("a fully taxable order with no extras puts everything on the taxable line", () => {
  const { taxableNet, nonTaxableNet } = invoiceSplit({
    subtotal: 100, taxableSubtotal: 100, discount: 0,
    deliveryCharge: 0, rushFee: 0, tax: 9.75, total: 109.75,
  });
  eq(taxableNet, 100, "all taxable");
  eq(nonTaxableNet, 0, "nothing else — and buildInvoicePayload omits a zero line");
});

test("a comped order does not divide by zero", () => {
  // 82 real orders carry discount_rate = 1, a full comp.
  const { taxableNet, nonTaxableNet } = invoiceSplit({
    subtotal: 0, taxableSubtotal: 0, discount: 0,
    deliveryCharge: 0, rushFee: 0, tax: 0, total: 0,
  });
  eq(taxableNet, 0, "no NaN");
  eq(nonTaxableNet, 0, "no NaN");
});

// ---------------------------------------------------------------------------
// Attachments — every case here was measured against the sandbox on 2026-09-02
// ---------------------------------------------------------------------------

test("a refused file type is named, and WebP gets its own sentence", () => {
  eq(attachmentRefusal("application/pdf", "scan.pdf"), null, "pdf goes (measured)");
  eq(attachmentRefusal("image/jpeg", "photo.jpg"), null, "jpeg goes (measured)");
  eq(attachmentRefusal("IMAGE/PNG", "x.png"), null, "case and space do not decide it");
  // MEASURED REFUSED, code 6041 — and this app's own picker offers WebP, so it
  // is the one refusal somebody can walk into having done nothing wrong.
  ok(attachmentRefusal("image/webp", "invoice.webp")?.includes("WebP"), "webp names itself");
  ok(attachmentRefusal("image/webp", "invoice.webp")?.includes("invoice.webp"), "and the file");
  ok(attachmentRefusal("application/zip", "books.zip")?.includes("application/zip"), "anything else names the type");
  ok(attachmentRefusal(null, null)?.includes("that file"), "a nameless file still gets a sentence");
});

test("the metadata part is what the upload endpoint wants", () => {
  const meta = attachableMetadata({
    entity: "Bill", entityId: "145", fileName: "scan.pdf", contentType: "application/pdf",
  });
  eq(JSON.stringify(meta.AttachableRef[0].EntityRef), '{"type":"Bill","value":"145"}', "the ref");
  // NEVER true: QuickBooks emails nothing on this org's behalf (decision 2), so
  // the only thing this could do is surprise somebody who pressed send in QBO.
  eq(meta.AttachableRef[0].IncludeOnSend, false, "never included on send");
  eq(meta.FileName, "scan.pdf", "the name");
  eq(meta.ContentType, "application/pdf", "the type");
});

test("a refusal arrives as HTTP 200, so the ITEM is read and not the status", () => {
  const good = attachableFromResponse({
    AttachableResponse: [{ Attachable: { Id: "1000000021", Size: 773217 } }],
  });
  ok(good.ok, "accepted");
  eq(good.ok ? good.id : null, "1000000021", "the attachable id");
  eq(good.ok ? good.size : null, 773217, "and its size");

  // The real sandbox refusal, verbatim.
  const bad = attachableFromResponse({
    AttachableResponse: [{
      Fault: { Error: [{ Message: "Invalid Uploaded File", code: "6041" }], type: "ValidationFault" },
    }],
  });
  eq(bad.ok, false, "a fault inside a 200 is still a failure");
  eq(bad.ok ? null : bad.message, "Invalid Uploaded File (6041)", "in QuickBooks' own words");

  // Neither an Attachable nor a Fault — believed once, this stores nothing and
  // reports success, so the next push attaches a second copy.
  eq(attachableFromResponse({ AttachableResponse: [{}] }).ok, false, "no id is not success");
  eq(attachableFromResponse({}).ok, false, "no response at all is not success");
  eq(attachableFromResponse(null).ok, false, "null is not success");
});

test("what has already been attached is remembered per document", () => {
  const ref = { qbo: { id: "147", sync_token: "0", attachments: { "doc-a": "1000000001" } } };
  eq(JSON.stringify(recordedAttachments(ref)), '{"doc-a":"1000000001"}', "read back");
  eq(JSON.stringify(recordedAttachments({ qbo: { id: "1" } })), "{}", "none yet");
  eq(JSON.stringify(recordedAttachments(null)), "{}", "never pushed");

  // MERGES. Replacing would forget the first scan the moment a second is filed.
  const next = withAttachments(ref, { "doc-b": "1000000011" });
  eq(
    JSON.stringify(recordedAttachments(next)),
    '{"doc-a":"1000000001","doc-b":"1000000011"}',
    "the second joins the first"
  );
  eq(next.qbo?.id, "147", "and nothing else on the ref moves");
});

test("a bill's scan goes up once, however often it is pushed", () => {
  const docs = [
    { id: "doc-a", kind: "invoice" },
    { id: "doc-b", kind: "invoice" },
    { id: "doc-c", kind: "receipt" },
  ];
  // MEASURED: posting the same file twice made TWO attachments, ids ...001 and
  // ...011. Nothing in QuickBooks stops it, so this does.
  eq(attachmentsToSend(docs, null).map((d) => d.id).join(","), "doc-a,doc-b", "both invoices, not the receipt");
  const after = { qbo: { id: "147", attachments: { "doc-a": "1000000001" } } };
  eq(attachmentsToSend(docs, after).map((d) => d.id).join(","), "doc-b", "the one already up is left alone");
  const both = { qbo: { id: "147", attachments: { "doc-a": "1", "doc-b": "2" } } };
  eq(attachmentsToSend(docs, both).length, 0, "a second push attaches nothing");
  eq(INVOICE_SHEET_KEY, "sheet", "the customer sheet's own key");
});

test("a ref with no sync token is a CREATE, which is why one is never rebuilt", () => {
  // The whole reason both push modes return the ref they recorded rather than
  // its parts. `push_invoice` returned no `sync_token` for a day, so a caller
  // reassembling the ref wrote one without it — and this is what that means:
  // not a failed update, a SECOND invoice in the customer's books.
  eq(qboRef({ qbo: { id: "156" } }), null, "an id alone is not a reference");
  eq(qboRef({ qbo: { id: "156", sync_token: "  " } }), null, "nor is a blank token");
  eq(pushMode({ external_ref: { qbo: { id: "156" } } }), "create", "so the push CREATES");
  eq(
    pushMode({ external_ref: { qbo: { id: "156", sync_token: "5" } } }),
    "update",
    "where a whole reference updates"
  );

  // And what the fix preserves: adding attachments to the server's own ref
  // cannot lose the token, whatever else it holds.
  const fromServer = { qbo: { id: "156", sync_token: "7", doc_number: "8786", entity: "Invoice" as const } };
  const after = withAttachments(fromServer, { sheet: "1000000032" });
  eq(qboRef(after)?.syncToken, "7", "the token survives");
  eq(pushMode({ external_ref: after }), "update", "so it is still an update");
});
