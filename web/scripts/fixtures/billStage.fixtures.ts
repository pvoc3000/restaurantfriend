import { test, eq } from "./harness";
import {
  billStage,
  billPaymentNote,
  pushIsStale,
  BILL_STAGE_LABEL,
  BILL_STAGE_ORDER,
  type BillStageInput,
} from "../../src/lib/invoices";

const money = (n: number) => `$${n.toFixed(2)}`;
const bill = (over: Partial<BillStageInput> = {}): BillStageInput => ({
  status: "approved",
  linked: false,
  qbo_balance: null,
  qbo_checked_at: null,
  ...over,
});

test("the ladder is our two acts, then QuickBooks' two facts", () => {
  eq(billStage(bill({ status: "open" })), "open", "not approved yet");
  eq(billStage(bill()), "approved", "approved, not on the books");
  eq(billStage(bill({ linked: true })), "submitted", "linked is on the books");
  eq(
    billStage(bill({ linked: true, qbo_balance: 0, qbo_checked_at: "2026-09-02T20:00:00Z" })),
    "paid",
    "nothing owed is paid"
  );
  eq(BILL_STAGE_ORDER.join(","), "open,approved,submitted,paid,void", "in order");
  eq(BILL_STAGE_LABEL.submitted, "Submitted", "Mark's word");
});

test("void is an exit, not a rung", () => {
  // A voided bill that still carries a link must not read as Submitted, and a
  // voided one QuickBooks says is settled must not read as Paid.
  eq(billStage(bill({ status: "void", linked: true })), "void", "linked and void");
  eq(
    billStage(bill({ status: "void", linked: true, qbo_balance: 0, qbo_checked_at: "x" })),
    "void",
    "settled and void"
  );
});

test("only a NUMBER is paid — null is never", () => {
  // The tri-state 088 exists for. Treating a null balance as paid would call
  // every bill nobody has asked about settled.
  eq(billStage(bill({ linked: true, qbo_balance: null })), "submitted", "nobody asked");
  eq(
    billStage(bill({ linked: true, qbo_balance: null, qbo_checked_at: "2026-09-02T20:00:00Z" })),
    "submitted",
    "asked, and QuickBooks no longer has it — still not paid"
  );
  // Part paid is Submitted with a figure, never a fifth rung.
  eq(
    billStage(bill({ linked: true, qbo_balance: 412.5, qbo_checked_at: "2026-09-02T20:00:00Z" })),
    "submitted",
    "something still owed"
  );
});

test("a payment claim never appears without the moment it was true", () => {
  // The rule 088 bends and then keeps: the figure and its `as of` are one fact.
  eq(billPaymentNote(bill(), money), null, "unlinked says nothing");
  eq(billPaymentNote(bill({ linked: true }), money), null, "linked but unasked says nothing");

  const at = "2026-09-02T20:00:00Z";
  eq(
    billPaymentNote(bill({ linked: true, qbo_balance: 0, qbo_checked_at: at }), money),
    "paid · as of 2026-09-02",
    "paid, dated"
  );
  eq(
    billPaymentNote(bill({ linked: true, qbo_balance: 412.5, qbo_checked_at: at }), money),
    "$412.50 owed · as of 2026-09-02",
    "owed, dated"
  );
  // The stuck case, in a list column's words.
  eq(
    billPaymentNote(bill({ linked: true, qbo_balance: null, qbo_checked_at: at }), money),
    "no longer in QuickBooks · as of 2026-09-02",
    "gone, dated"
  );
});

test("a half-cent is not a debt", () => {
  // The app's own money epsilon, so a rounding tail does not leave a bill
  // reading Submitted for ever with a cent on it.
  const at = "2026-09-02T20:00:00Z";
  eq(billStage(bill({ linked: true, qbo_balance: 0.004, qbo_checked_at: at })), "paid", "under half a cent");
  eq(billStage(bill({ linked: true, qbo_balance: 0.01, qbo_checked_at: at })), "submitted", "a real cent is not paid");
});

test("pushIsStale: neither pushed nor touched is not stale", () => {
  eq(pushIsStale({ synced_at: null, financials_touched_at: null }), false, "never pushed");
  eq(pushIsStale({ synced_at: null, financials_touched_at: "2026-09-03T00:00:00Z" }), false, "touched but never pushed");
  eq(pushIsStale({ synced_at: "2026-09-01T00:00:00Z", financials_touched_at: null }), false, "pushed, untouched since creation");
});

test("pushIsStale: touched after the push is stale, before it is not", () => {
  eq(
    pushIsStale({ synced_at: "2026-09-01T00:00:00Z", financials_touched_at: "2026-09-02T00:00:00Z" }),
    true,
    "edited a day after the push"
  );
  eq(
    pushIsStale({ synced_at: "2026-09-02T00:00:00Z", financials_touched_at: "2026-09-01T00:00:00Z" }),
    false,
    "the push already covers this edit"
  );
});
