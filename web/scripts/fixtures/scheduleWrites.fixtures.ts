// Deleting a night — the sentence the confirm shows, from either door.
//
// The message is the shared half of the record's Delete and the schedules
// list's selection bar (Mark, 2026-09-09). What it must never do is describe
// the same act two different ways depending on which button you pressed, and
// what it must never OMIT is that a special-order night does not come back by
// regenerating.

import { deleteSchedulesMessage, type DeletableSchedule } from "../../src/components/production/scheduleWrites";
import { test, eq, ok } from "./harness";

function night(over: Partial<DeletableSchedule> = {}): DeletableSchedule {
  return {
    schedule_date: "2026-09-14",
    sellsCode: "DF02",
    source: "plan",
    lineCount: 35,
    countedLines: 0,
    ...over,
  };
}

test("one night NAMES itself — the date and the shop", () => {
  const m = deleteSchedulesMessage([night()]);
  ok(m.startsWith("Delete the 2026-09-14 schedule for DF02?"), m.split("\n")[0]);
});

test("a selection is COUNTED, never named", () => {
  // From a bar over fifteen ticked rows, one row's date is a worse answer to
  // "which ones?" than the number — the PO list's own finding in reverse.
  const m = deleteSchedulesMessage([night(), night({ schedule_date: "2026-09-15" })]);
  ok(m.startsWith("Delete 2 schedules?"), m.split("\n")[0]);
});

test("the items going with them are SUMMED across the selection", () => {
  const m = deleteSchedulesMessage([night({ lineCount: 35 }), night({ lineCount: 7 })]);
  ok(m.includes("42 items go with them"), m);
});

test("one item reads singular, and one night says 'it'", () => {
  ok(deleteSchedulesMessage([night({ lineCount: 1 })]).includes("1 item go"), "singular noun");
  ok(deleteSchedulesMessage([night()]).includes("go with it."), "singular pronoun");
});

test("COUNTED QUANTITIES ARE NAMED — somebody stood at a bench for those", () => {
  ok(!deleteSchedulesMessage([night()]).includes("counted"), "silent when none");
  ok(
    deleteSchedulesMessage([night(), night({ countedLines: 3 })]).includes("including counted quantities"),
    "named when any night in the selection carries one"
  );
});

test("a plan night says regenerating rebuilds it", () => {
  ok(deleteSchedulesMessage([night()]).includes("rebuild it from the plans"), "one");
  ok(deleteSchedulesMessage([night(), night()]).includes("rebuild them from the plans"), "several");
});

test("a SPECIAL-ORDER night does NOT claim regeneration brings it back", () => {
  // The generator only ever touches `source = 'plan'`, so the plan sentence is
  // simply false here — and this route bypasses `unschedule_special_order`'s
  // printed/counted guard, which is why the honest way back is named instead.
  const m = deleteSchedulesMessage([night({ source: "special_order" })]);
  ok(m.includes("came from a special order"), "names the real way back");
  ok(!m.includes("from the plans"), "and does not offer the false one");
});

test("a MIXED selection gets BOTH sentences", () => {
  // Either one alone is true of some of what is going and a silent omission
  // about the rest.
  const m = deleteSchedulesMessage([night(), night({ source: "special_order" })]);
  ok(m.includes("1 of them came from special orders"), "the orders half");
  ok(m.includes("rebuild them from the plans"), "the plans half");
});

test("an all-special-order selection does not offer the plan sentence", () => {
  const m = deleteSchedulesMessage([
    night({ source: "special_order" }),
    night({ source: "special_order" }),
  ]);
  ok(m.includes("These all came from special orders"), "all of them, said as such");
  ok(!m.includes("This came from a special order"), "never the one-night sentence over a selection");
  ok(!m.includes("from the plans"), "no plan sentence");
});

test("the message splits into a title and a body on blank lines", () => {
  // `splitConfirmMessage` takes the first paragraph as the dialog's title, so
  // the question has to stand alone as one.
  const parts = deleteSchedulesMessage([night()]).split(/\n\s*\n/);
  eq(parts[0], "Delete the 2026-09-14 schedule for DF02?");
  ok(parts.length >= 2, "and there is a body under it");
});
