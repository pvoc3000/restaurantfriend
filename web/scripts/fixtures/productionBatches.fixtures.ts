// lib/productionBatches — the batch log's display and arithmetic.
//
// The two rules that matter here both produce a plausible wrong number rather
// than an error: an amount whose count is dropped ("4x 3 GAL" read as three
// gallons instead of twelve), and a par comparison that treats a missing or
// differently-united par as zero, which calls every batch a success.

import { test, eq, ok } from "./harness";
import {
  BATCH_STATUSES,
  BATCH_STATUS_LABEL,
  isBatchOutstanding,
  describeAmount,
  amountTotal,
  yieldAgainstPar,
  batchWeek,
  weekStart,
  weekLabel,
  batchDate,
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

/* -- the week ------------------------------------------------------------- */

test("ISO 1 = MONDAY: every day of one week resolves to the same Monday", () => {
  // Off by one here shifts a kitchen's whole week by a day.
  for (const d of [
    "2026-08-10", "2026-08-11", "2026-08-12",
    "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
  ]) {
    eq(weekStart(d), "2026-08-10", `week of ${d}`);
  }
});

test("SUNDAY belongs to the week that STARTED, not the one about to", () => {
  // The classic off-by-one: getUTCDay() is 0 for Sunday, so a naive
  // `-(day - 1)` moves Sunday FORWARD a day instead of back six.
  eq(weekStart("2026-08-16"), "2026-08-10");
  eq(weekStart("2026-08-09"), "2026-08-03");
});

test("batchWeek is seven consecutive dates, Monday first", () => {
  const w = batchWeek("2026-08-13");
  eq(w.length, 7);
  eq(w[0], "2026-08-10");
  eq(w[6], "2026-08-16");
});

test("a week crossing a month and a year still runs seven days", () => {
  eq(batchWeek("2026-12-31")[0], "2026-12-28");
  eq(batchWeek("2026-12-31")[6], "2027-01-03");
});

test("the week does not shift west of Greenwich", () => {
  const before = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  eq(weekStart("2026-08-16"), "2026-08-10");
  eq(batchDate("2026-08-10"), "Mon 8/10");
  process.env.TZ = before;
});

test("weekLabel names both ends and the year once", () => {
  eq(weekLabel("2026-08-13"), "10 Aug – 16 Aug 2026");
});
