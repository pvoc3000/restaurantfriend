// lib/employeeDocuments — the derivation that replaced FMP's eight onboarding
// checkboxes.
//
// The whole point of deriving it is that "paperwork complete" cannot be true
// without the documents, so the cases that matter are the ones where something
// LOOKS like completion and isn't: a file of the wrong kind, a pile of extras,
// or a kind this build has never heard of.

import {
  missingPaperwork,
  REQUIRED_ONBOARDING_KINDS,
  type DocumentKind,
} from "../../src/lib/employeeDocuments";
import { eq, ok, test } from "./harness";

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
  // Application is first in the list, training_ack last; filing them the other
  // way round must not reorder the report.
  eq(missingPaperwork(["i9", "i9_docs", "food_handler_card", "handbook", "notice_to_employee"]), [
    "application",
    "w4",
    "training_ack",
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
  // FMP kept it as a separate checkbox because only some shifts need one.
  ok(
    !REQUIRED_ONBOARDING_KINDS.includes("meal_break_waiver"),
    "meal_break_waiver is optional"
  );
  eq(missingPaperwork(ALL_REQUIRED), []);
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
