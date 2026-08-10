// The batch-log list's date window.
//
// These exist for two failure modes, both of which look like the feature merely
// being a bit off rather than broken:
//
//   * `parseBatchLogRange` FALLS BACK silently on anything it doesn't
//     recognise, so a range the parser hasn't been taught about quietly becomes
//     90 days — the chip you pressed unpresses itself and six years of history
//     stays hidden.
//   * `batchLogRangeHref` writes NO parameter for the default, which is what
//     keeps `/batch-logs` one canonical address. Get that backwards and every
//     link stored anywhere starts carrying `?range=90`, and the "keep the rest
//     of the query" behaviour is the kind of thing a rewrite drops.

import {
  BATCH_LOG_RANGES,
  DEFAULT_BATCH_LOG_RANGE,
  batchLogRangeHref,
  batchLogRangeStart,
  parseBatchLogRange,
} from "../../src/lib/batchLogFilters";
import { eq, ok, test } from "./harness";

test("parseBatchLogRange: every declared key survives a round trip", () => {
  for (const r of BATCH_LOG_RANGES) eq(parseBatchLogRange(r.key), r.key, r.key);
});

test("parseBatchLogRange: anything else falls back rather than erroring", () => {
  eq(parseBatchLogRange(undefined), DEFAULT_BATCH_LOG_RANGE, "absent");
  eq(parseBatchLogRange(""), DEFAULT_BATCH_LOG_RANGE, "empty");
  eq(parseBatchLogRange("60"), DEFAULT_BATCH_LOG_RANGE, "a plausible-but-undeclared window");
  eq(parseBatchLogRange("ALL"), DEFAULT_BATCH_LOG_RANGE, "wrong case is not a match");
  eq(parseBatchLogRange(["365", "30"]), "365", "an array takes the first");
});

test("batchLogRangeStart: a window counts back from the ORG's day", () => {
  // Los Angeles is a day behind UTC late in the evening, which is the whole
  // reason this takes a timezone: on a UTC host the window would start a day
  // early and drop the log somebody is working right now.
  eq(batchLogRangeStart("all", "America/Los_Angeles"), null, "all time has no floor");
  const thirty = batchLogRangeStart("30", "America/Los_Angeles");
  const ninety = batchLogRangeStart("90", "America/Los_Angeles");
  const year = batchLogRangeStart("365", "America/Los_Angeles");
  ok(thirty !== null && ninety !== null && year !== null, "the bounded ranges have a floor");
  ok(year! < ninety! && ninety! < thirty!, "a longer window reaches further back");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(thirty!), "an ISO date, which is what log_date compares as");
});

test("batchLogRangeHref: the DEFAULT writes no parameter", () => {
  eq(batchLogRangeHref(DEFAULT_BATCH_LOG_RANGE, {}), "/batch-logs", "bare");
  eq(batchLogRangeHref("all", {}), "/batch-logs?range=all", "a non-default is named");
});

test("batchLogRangeHref: the rest of the query survives", () => {
  eq(
    batchLogRangeHref("all", { from: "/plans", fromLabel: "Plans" }),
    "/batch-logs?from=%2Fplans&fromLabel=Plans&range=all",
    "breadcrumb params are carried, and the range joins them"
  );
  eq(
    batchLogRangeHref(DEFAULT_BATCH_LOG_RANGE, { from: "/plans" }),
    "/batch-logs?from=%2Fplans",
    "the default still writes nothing, and takes the rest with it"
  );
  // And the OLD range is replaced rather than appended twice — the bug that
  // produces `?range=30&range=all`, where the parser takes the first and the
  // chip you pressed appears not to work.
  eq(
    batchLogRangeHref("365", { range: "30" }),
    "/batch-logs?range=365",
    "an existing range is replaced"
  );
  eq(
    batchLogRangeHref(DEFAULT_BATCH_LOG_RANGE, { range: "all" }),
    "/batch-logs",
    "returning to the default clears it"
  );
});

test("batchLogRangeHref: takes URLSearchParams too", () => {
  eq(
    batchLogRangeHref("all", new URLSearchParams("range=30&from=%2Fplans")),
    "/batch-logs?from=%2Fplans&range=all",
    "same rules from the other input shape"
  );
});
