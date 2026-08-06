// lib/employeeDocuments — the derivation that replaced FMP's eight onboarding
// checkboxes.
//
// The whole point of deriving it is that "paperwork complete" cannot be true
// without the documents, so the cases that matter are the ones where something
// LOOKS like completion and isn't: a file of the wrong kind, a pile of extras,
// or a kind this build has never heard of.

import {
  expiryRoll,
  expiryState,
  foodHandlerExpiry,
  missingPaperwork,
  paperworkStatus,
  soonestExpiry,
  REQUIRED_ONBOARDING_KINDS,
  type DocumentKind,
} from "../../src/lib/employeeDocuments";
import { eq, no, ok, test } from "./harness";

const ALL_REQUIRED = [...REQUIRED_ONBOARDING_KINDS];

test("nothing on file → every required kind is missing", () => {
  eq(missingPaperwork([]), ALL_REQUIRED);
});

test("the full set → nothing missing", () => {
  eq(missingPaperwork(ALL_REQUIRED), []);
});

test("one gap is reported, and only that one", () => {
  const withoutW4 = ALL_REQUIRED.filter((k) => k !== "w4");
  eq(missingPaperwork(withoutW4), ["w4"]);
});

test("missing kinds come back in the declared order, not the filed order", () => {
  // Application is first in the list, notice_to_employee last; filing them the
  // other way round must not reorder the report.
  eq(missingPaperwork(["i9", "i9_docs", "food_handler_card", "handbook", "orientation"]), [
    "application",
    "w4",
    "notice_to_employee",
  ]);
});

test("extras never satisfy a requirement", () => {
  // A write-up and three reviews are not onboarding paperwork, however many
  // documents the card ends up showing.
  const extras: DocumentKind[] = ["write_up", "review", "review", "other"];
  eq(missingPaperwork(extras), ALL_REQUIRED);
});

test("`other` is never required and never satisfies", () => {
  ok(!REQUIRED_ONBOARDING_KINDS.includes("other"), "other is not required");
  eq(missingPaperwork(["other"]), ALL_REQUIRED);
});

test("the meal break waiver is deliberately NOT required", () => {
  // FMP kept it as a separate field (51 of 445 signed) because only some
  // shifts need one.
  ok(
    !REQUIRED_ONBOARDING_KINDS.includes("meal_break_waiver"),
    "meal_break_waiver is optional"
  );
  eq(missingPaperwork(ALL_REQUIRED), []);
});

test("the eighth onboarding document is orientation, not training_ack", () => {
  // The FMP layout labelled the checkbox "Training Acknowledgement" but the
  // data says Orientation 45 : Training Acknowledgement 3 — the label was
  // changed and the value list never followed. training_ack stays FILEABLE
  // (three people have one) and is not required.
  ok(REQUIRED_ONBOARDING_KINDS.includes("orientation"), "orientation required");
  ok(!REQUIRED_ONBOARDING_KINDS.includes("training_ack"), "training_ack optional");
  // Filing a training acknowledgement does not tick the orientation box.
  eq(missingPaperwork(ALL_REQUIRED.filter((k) => k !== "orientation").concat("training_ack")), [
    "orientation",
  ]);
});

test("duplicates of one kind still satisfy it exactly once", () => {
  const twoW4s = [...ALL_REQUIRED, "w4", "w4"];
  eq(missingPaperwork(twoW4s), []);
});

test("an unknown kind is ignored rather than throwing", () => {
  // A kind added by a later migration must not break this screen for everyone
  // before the deploy catches up.
  eq(missingPaperwork([...ALL_REQUIRED, "kind_from_the_future"]), []);
  eq(missingPaperwork(["kind_from_the_future"]), ALL_REQUIRED);
});

// ---------------------------------------------------------------------------
// Expiry (migration 034)
//
// The rule that pays for this feature is that NULL MEANS NEVER — every document
// filed before 034 has a null `expires_on`, and a bug that reads null as "no
// date, therefore overdue" would paint the entire personnel file red on the day
// the column shipped. Most of what follows is that case from a different angle.
// ---------------------------------------------------------------------------

const TODAY = "2026-08-05";

/** A document, as much of one as any of these functions look at. */
function doc(kind: DocumentKind, expires_on: string | null = null) {
  return { kind, expires_on };
}

test("null expiry is NEVER, not overdue", () => {
  eq(expiryState(null, TODAY), "none");
  // And it does not appear in the roll at all — nothing to chase.
  eq(expiryRoll([doc("w4"), doc("handbook"), doc("i9")]), []);
});

test("expired, expiring soon, and simply in date", () => {
  eq(expiryState("2026-08-04", TODAY), "expired");
  // The day printed on the card is NOT expired — a card is good through it.
  eq(expiryState(TODAY, TODAY), "soon");
  eq(expiryState("2026-10-03", TODAY), "soon", "59 days out");
  eq(expiryState("2026-10-04", TODAY), "soon", "the 60th day is still soon");
  eq(expiryState("2026-10-05", TODAY), "ok", "the 61st day is not");
});

test("the soon window straddles a month boundary correctly", () => {
  // 60 days from 2026-12-31 is 2027-03-01 — the arithmetic has to roll the
  // year, which is why it goes through Date rather than through string maths.
  eq(expiryState("2027-02-28", "2026-12-31"), "soon");
  eq(expiryState("2027-03-02", "2026-12-31"), "ok");
});

test("the roll is soonest first, so its head is the worst thing outstanding", () => {
  const roll = expiryRoll([
    doc("food_handler_card", "2027-01-01"),
    doc("w4"),
    doc("other", "2026-01-01"),
    doc("review", "2026-09-01"),
  ]);
  eq(
    roll.map((e) => e.on),
    ["2026-01-01", "2026-09-01", "2027-01-01"]
  );
  eq(soonestExpiry([doc("other", "2026-01-01")], null, TODAY)?.state, "expired");
  eq(soonestExpiry([], null, TODAY), null);
});

test("the legacy food-handler date speaks only while no card is on file", () => {
  // No card: the employees column answers, and says it isn't a filed document.
  const withoutCard = expiryRoll([doc("handbook")], "2023-04-12");
  eq(withoutCard, [{ kind: "food_handler_card", on: "2023-04-12", filed: false }]);
  eq(foodHandlerExpiry([doc("handbook")], "2023-04-12"), {
    on: "2023-04-12",
    source: "record",
  });

  // Card on file: ITS date is the record, and the column is ignored even when
  // the two disagree. Two stores of one fact, and this is which one wins.
  const withCard = [doc("food_handler_card", "2027-05-01")];
  eq(expiryRoll(withCard, "2023-04-12"), [
    { kind: "food_handler_card", on: "2027-05-01", filed: true },
  ]);
  eq(foodHandlerExpiry(withCard, "2023-04-12"), {
    on: "2027-05-01",
    source: "document",
  });
});

test("a card on file with NO expiry silences the legacy date rather than falling back", () => {
  // The card is the record from the moment it is photographed. Falling back
  // here would report a date belonging to the previous card, which is the one
  // reading that is definitely wrong.
  const card = [doc("food_handler_card", null)];
  eq(foodHandlerExpiry(card, "2023-04-12"), { on: null, source: "document" });
  eq(expiryRoll(card, "2023-04-12"), []);
});

test("nobody has a legacy date and nothing is filed → nothing to say", () => {
  eq(foodHandlerExpiry([], null), { on: null, source: null });
  eq(expiryRoll([], null), []);
});

test("expired and missing are counted SEPARATELY", () => {
  // A lapsed card is ON FILE. Reporting it as missing would send someone to
  // upload a first copy of a document they are looking at.
  const filed = ALL_REQUIRED.map((k) =>
    k === "food_handler_card" ? doc(k, "2023-04-12") : doc(k)
  );
  const status = paperworkStatus(filed, null, TODAY);
  eq(status.missing, []);
  eq(status.expired, [{ kind: "food_handler_card", on: "2023-04-12", filed: true }]);
  eq(status.expiring, []);
  no(status.complete, "a lapsed card is not complete paperwork");
});

test("`complete` is stricter than `nothing missing`", () => {
  const allFiled = ALL_REQUIRED.map((k) => doc(k));
  ok(paperworkStatus(allFiled, null, TODAY).complete, "no dates, all filed");

  // Expiring SOON does not make it incomplete — it hasn't lapsed yet, and a
  // renewal booked for next month should not read as a compliance failure.
  const soon = ALL_REQUIRED.map((k) =>
    k === "food_handler_card" ? doc(k, "2026-09-01") : doc(k)
  );
  const status = paperworkStatus(soon, null, TODAY);
  ok(status.complete, "expiring soon is still complete");
  eq(status.expiring.length, 1);
});

test("a legacy food-handler date can expire the file with nothing filed at all", () => {
  // The 16 current staff on the day 034 shipped: a date on the record, no card
  // behind it. The roster has to flag them or the feature loses everyone it was
  // supposed to be about.
  const status = paperworkStatus([], "2023-04-12", TODAY);
  eq(status.expired, [{ kind: "food_handler_card", on: "2023-04-12", filed: false }]);
  ok(status.missing.includes("food_handler_card"), "still missing the card itself");
});
