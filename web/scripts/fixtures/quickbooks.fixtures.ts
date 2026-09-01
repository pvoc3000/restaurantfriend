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
  eq(pushedLabel(null), null, "never pushed");
});

test("the entity path is what QBO's URL wants", () => {
  eq(qboEntityPath("Bill"), "bill", "bill");
  eq(qboEntityPath("VendorCredit"), "vendorcredit", "credit");
});
