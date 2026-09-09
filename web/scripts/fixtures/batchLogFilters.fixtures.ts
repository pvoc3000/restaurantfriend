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
  batchLogWindowBounds,
  batchLogWindowFromPicker,
  parseBatchLogRange,
  parseBatchLogWindow,
} from "../../src/lib/batchLogFilters";
import { eq, test } from "./harness";

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

test("batchLogWindowBounds: a preset counts back from the ORG's day, through today", () => {
  const TUE = "2026-09-08";
  eq(batchLogWindowBounds("all", TUE), null, "all time has no floor");
  eq(batchLogWindowBounds("30", TUE), { from: "2026-08-09", to: TUE });
  eq(batchLogWindowBounds("90", TUE), { from: "2026-06-10", to: TUE });
  eq(batchLogWindowBounds("365", TUE), { from: "2025-09-08", to: TUE });
  eq(batchLogWindowBounds({ from: "2026-08-01", to: "2026-08-31" }, TUE), { from: "2026-08-01", to: "2026-08-31" });
});

test("parseBatchLogWindow: a key, a pair, half a pair, and a key over a pair", () => {
  eq(parseBatchLogWindow({ range: "30" }), "30");
  eq(parseBatchLogWindow({ from: "2026-08-01", to: "2026-08-31" }), { from: "2026-08-01", to: "2026-08-31" });
  eq(parseBatchLogWindow({ from: "2026-08-01" }), DEFAULT_BATCH_LOG_RANGE);
  eq(parseBatchLogWindow({ range: "all", from: "2026-08-01", to: "2026-08-31" }), "all");
  // The breadcrumb's `from` is a PATH and never reads as a window.
  eq(parseBatchLogWindow({ from: "/plans", fromLabel: "Plans" }), DEFAULT_BATCH_LOG_RANGE);
});

test("batchLogWindowFromPicker: a pair that is a preset is stored by key", () => {
  const TUE = "2026-09-08";
  eq(batchLogWindowFromPicker({ from: "2026-06-10", to: TUE }, TUE), "90");
  eq(batchLogWindowFromPicker(null, TUE), "all");
  eq(batchLogWindowFromPicker({ from: "2026-08-01", to: "2026-08-31" }, TUE), { from: "2026-08-01", to: "2026-08-31" });
});

test("batchLogRangeHref: a custom pair writes from/to and replaces a stale pair", () => {
  eq(batchLogRangeHref({ from: "2026-08-01", to: "2026-08-31" }, {}), "/batch-logs?from=2026-08-01&to=2026-08-31");
  eq(batchLogRangeHref("30", { from: "2026-08-01", to: "2026-08-31" }), "/batch-logs?range=30", "a preset drops the old pair");
  eq(
    batchLogRangeHref({ from: "2026-08-01", to: "2026-08-31" }, { from: "/plans", fromLabel: "Plans" }),
    "/batch-logs?from=2026-08-01&fromLabel=Plans&to=2026-08-31",
    "the breadcrumb's from is a path and is superseded by the window's"
  );
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
