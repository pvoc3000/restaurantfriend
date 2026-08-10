// lib/productionBatches — the batch log's display and arithmetic.
//
// The two rules that matter here both produce a plausible wrong number rather
// than an error: an amount whose count is dropped ("4x 3 GAL" read as three
// gallons instead of twelve), and a par comparison that treats a missing or
// differently-united par as zero, which calls every batch a success.

import { eq, no, ok, test } from "./harness";
import {
  BATCH_STATUSES,
  BATCH_STATUS_LABEL,
  amountTotal,
  batchDate,
  batchMadeNothing,
  batchStatusTone,
  describeAmount,
  isBatchOutstanding,
  yieldAgainstPar,
} from "../../src/lib/productionBatches";

/* -- status --------------------------------------------------------------- */

test("all five FileMaker statuses survive, with no sort prefixes", () => {
  eq([...BATCH_STATUSES], ["to_do", "in_progress", "complete", "skipped", "test"]);
  for (const s of BATCH_STATUSES) ok(BATCH_STATUS_LABEL[s], `label for ${s}`);
  eq(BATCH_STATUS_LABEL.to_do, "To do");
});

test("outstanding is to-do AND in-progress — a half-made batch is not done", () => {
  ok(isBatchOutstanding("to_do"));
  ok(isBatchOutstanding("in_progress"));
  eq(isBatchOutstanding("complete"), false);
  eq(isBatchOutstanding("skipped"), false);
  eq(isBatchOutstanding("test"), false);
});

/* -- amounts -------------------------------------------------------------- */

test("describeAmount reproduces FileMaker's own '2x 22qt'", () => {
  eq(describeAmount(2, 22, "qt"), "2 × 22 qt");
});

test("a count of 1 is dropped — '1 × 22 qt' is 22 qt said twice", () => {
  eq(describeAmount(1, 22, "qt"), "22 qt");
  eq(describeAmount(null, 22, "qt"), "22 qt");
});

test("no size means the count IS the amount", () => {
  // FMP's real free text includes "8 ea." and "10 BAGS" — a count and a unit
  // with nothing to multiply.
  eq(describeAmount(8, null, "ea"), "8 ea");
  eq(describeAmount(10, null, "BAGS"), "10 BAGS");
});

test("nothing at all is an em dash, not '0'", () => {
  eq(describeAmount(null, null, null), "—");
  eq(describeAmount(null, null, "qt"), "—");
});

test("amountTotal multiplies — the whole reason 036 parsed the free text", () => {
  // "4x 3 GAL" is twelve gallons. Returning the size alone gives three.
  eq(amountTotal(4, 3), 12);
});

test("amountTotal is NULL when there is nothing, never zero", () => {
  eq(amountTotal(null, null), null);
});

test("amountTotal falls back to whichever half exists", () => {
  eq(amountTotal(8, null), 8, "a bare count is the amount");
  eq(amountTotal(null, 22), 22, "a bare size is the amount");
});

/* -- yield against par ---------------------------------------------------- */

const par = { par_count: 2, par_size: 22, par_unit: "qt" };

test("a batch over, under and exactly at par", () => {
  eq(yieldAgainstPar({ yield_count: 3, yield_size: 22, yield_unit: "qt", ...par }), "over");
  eq(yieldAgainstPar({ yield_count: 1, yield_size: 22, yield_unit: "qt", ...par }), "under");
  eq(yieldAgainstPar({ yield_count: 2, yield_size: 22, yield_unit: "qt", ...par }), "at");
});

test("a MISSING par is unknown, not 'over'", () => {
  // Reading a null par as zero makes every batch ever logged a success.
  eq(
    yieldAgainstPar({
      yield_count: 3, yield_size: 22, yield_unit: "qt",
      par_count: null, par_size: null, par_unit: null,
    }),
    "unknown"
  );
});

test("a batch with no yield yet is unknown", () => {
  eq(
    yieldAgainstPar({ yield_count: null, yield_size: null, yield_unit: null, ...par }),
    "unknown"
  );
});

test("different units refuse to compare rather than guessing a conversion", () => {
  // 2 × 22 qt against 2 × 22 lbs is not a comparison, and `lib/units` declines
  // the same class of question for the same reason.
  eq(
    yieldAgainstPar({ yield_count: 2, yield_size: 22, yield_unit: "lbs", ...par }),
    "unknown"
  );
});

test("unit comparison ignores case and padding", () => {
  eq(yieldAgainstPar({ yield_count: 2, yield_size: 22, yield_unit: " QT ", ...par }), "at");
});

/* -- band ordering -------------------------------------------------------- */

test("a week's day BANDS order chronologically, not alphabetically", () => {
  // The bug this exists for, found on the real DF01 week: the band's LABEL is
  // "Mon 8/3", and sorting a week by that string reads Mon → Thu → Tue. The
  // grouping must sort by the ISO date underneath and print the friendly form.
  const week = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];
  const byLabel = [...week].sort((a, b) => (batchDate(a) < batchDate(b) ? -1 : 1));
  const byKey = [...week].sort((a, b) => (a < b ? -1 : 1));

  // What the label ordering actually does — the symptom, asserted so the
  // fixture fails loudly if someone "simplifies" back to it.
  eq(byLabel.map(batchDate), ["Mon 8/3", "Thu 8/6", "Tue 8/4", "Wed 8/5"]);
  // What the date ordering does, which is the week a kitchen works.
  eq(byKey.map(batchDate), ["Mon 8/3", "Tue 8/4", "Wed 8/5", "Thu 8/6"]);
  ok(byLabel.join() !== byKey.join(), "the two orderings genuinely differ");
});

test("the same trap across a month boundary", () => {
  // "Mon 8/31" vs "Tue 9/1": alphabetically 8 < 9 is right by luck here, but
  // "Fri 9/11" vs "Sat 9/2" is not — 1 sorts before 2 inside the string.
  const days = ["2026-09-02", "2026-09-11"];
  const byLabel = [...days].sort((a, b) => (batchDate(a) < batchDate(b) ? -1 : 1));
  eq(byLabel, ["2026-09-11", "2026-09-02"], "the label order is wrong");
  eq([...days].sort(), ["2026-09-02", "2026-09-11"], "the ISO order is right");
});

test("batchDate does not shift west of Greenwich", () => {
  // `new Date("2026-08-10")` is UTC midnight, which is the 9th in Los Angeles.
  // The module anchors to UTC and formats from UTC parts so the answer cannot
  // depend on where the server is.
  const before = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  eq(batchDate("2026-08-10"), "Mon 8/10");
  eq(batchDate("2026-01-01"), "Thu 1/1");
  process.env.TZ = before;
});

/* -- status colour, and what counts as "made nothing" ---------------------- */

test("batchStatusTone: three statuses carry a colour and two deliberately don't", () => {
  eq(batchStatusTone("complete"), "text-[var(--rf-green-600)]", "complete is green");
  eq(batchStatusTone("to_do"), "text-accent", "to do is red");
  eq(batchStatusTone("skipped"), "text-faint", "skipped is the LIGHTER grey");
  eq(batchStatusTone("in_progress"), "", "in progress is uncoloured");
  eq(batchStatusTone("test"), "", "test is uncoloured");
  eq(batchStatusTone("something_new"), "", "an unknown status never guesses a colour");
});

test("batchMadeNothing: a recorded ZERO is not a blank, and neither is a lone size", () => {
  // FileMaker writes `0 × 3 gal` constantly — somebody stating that nothing came
  // out. Dimming only the empty cell left these reading as a normal round.
  ok(
    batchMadeNothing({ status: "complete", yield_count: 0, yield_size: 3 }),
    "0 × 3 made nothing"
  );
  ok(
    batchMadeNothing({ status: "complete", yield_count: null, yield_size: null }),
    "nothing recorded made nothing"
  );
  ok(
    batchMadeNothing({ status: "skipped", yield_count: 4, yield_size: 1.5 }),
    "skipped wins even with a yield on the row"
  );
  // The one a naive `!yield_count` gets wrong: a single 3-gallon tub, count null.
  no(
    batchMadeNothing({ status: "complete", yield_count: null, yield_size: 3 }),
    "a lone size IS a real amount"
  );
  no(
    batchMadeNothing({ status: "complete", yield_count: 4, yield_size: 1.5 }),
    "4 × 1.5 made something"
  );
  no(
    batchMadeNothing({ status: "to_do", yield_count: 2, yield_size: 22 }),
    "an unfinished batch that already has a yield made something"
  );
});
