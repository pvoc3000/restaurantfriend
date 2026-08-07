// The rules that decide what a twelve-year-old FileMaker vocabulary becomes,
// and what a person's recent shift ratings say about them.
//
// Two of these pin measurements rather than opinions, and both were settled
// against FMP's own stored `score_TOTAL` on 2026-08-06:
//   · "n/a" is excluded from the mean (matches on 15,427 rows, differs on 1)
//   · 0 is INCLUDED, because the 65 all-zero rows read "NO CALL/NO SHOW"
// Get either backwards and every historical score moves.

import { test, eq, ok, no } from "./harness";
import {
  AD_HOC_EVENT_KINDS,
  EVENT_KIND_LABEL,
  EVENT_KIND_OPTIONS,
  RATING_WINDOW_DAYS,
  averageScore,
  eventSummaryLine,
  isDisciplinary,
  normalizeEventKind,
  ratingSummary,
  shiftSlotFromLabel,
  shiftSlotFromSortField,
  type EventKind,
  type ScoredEvent,
} from "../../src/lib/employeeEvents";

/** The harness has no `throws`; this is the local one. */
function throws(run: () => unknown, what = "call") {
  let threw = false;
  try {
    run();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${what}: expected it to throw, and it did not`);
}

/* -- the FileMaker vocabulary ---------------------------------------------- */

test("every FMP event type in the real export maps to a kind", () => {
  // The thirteen values measured in Events.mer, with their row counts, plus
  // Ratings.mer's own single value.
  const expected: [string, EventKind][] = [
    ["Attendance", "attendance"], //        876
    ["Negative", "negative"], //             336
    ["Incident Report", "incident"], //      336
    ["Verbal Warning", "verbal_warning"], // 194
    ["Call Out", "call_out"], //             182
    ["Positive", "positive"], //             113
    ["Written Warning", "written_warning"], // 100
    ["Document", "document_note"], //         81
    ["Negative Event", "negative"], //        73
    ["Positive Event", "positive"], //        46
    ["Neutral", "note"], //                   38
    ["Check-In", "check_in"], //              14
    ["Incident", "incident"], //               8
    ["daily_rating", "shift"], //         44,251
  ];
  for (const [raw, kind] of expected) eq(normalizeEventKind(raw), kind, raw);
});

test("the three merge pairs land on ONE kind each", () => {
  // field-map.md: the vocabulary drifted and these are the same thing entered
  // twice. Fold `Negative Event` into `note` instead and this goes red.
  eq(normalizeEventKind("Negative"), normalizeEventKind("Negative Event"), "negative pair");
  eq(normalizeEventKind("Positive"), normalizeEventKind("Positive Event"), "positive pair");
  eq(normalizeEventKind("Incident"), normalizeEventKind("Incident Report"), "incident pair");
});

test("the lookup ignores case, spacing and punctuation", () => {
  for (const raw of ["Check-In", "check in", "CHECK_IN", "  Check   In  ", "check-in"]) {
    eq(normalizeEventKind(raw), "check_in", JSON.stringify(raw));
  }
  eq(normalizeEventKind("daily rating"), "shift", "space instead of underscore");
});

test("an unrecognised type THROWS rather than falling through to a note", () => {
  // The allow-list posture. A silent fallthrough would file a decade of
  // write-ups under a bucket nobody looks at.
  throws(() => normalizeEventKind("Promotion"), "unknown type");
  throws(() => normalizeEventKind(""), "blank type");
  throws(() => normalizeEventKind(null), "null type");
  throws(() => normalizeEventKind("   "), "whitespace type");
});

test("the error names the value it could not map", () => {
  try {
    normalizeEventKind("Promotion");
    throw new Error("did not throw");
  } catch (e) {
    ok((e as Error).message.includes("Promotion"), "message quotes the raw value");
  }
});

/* -- the two vocabularies stay in step ------------------------------------- */

test("EVENT_KIND_OPTIONS covers every kind exactly once", () => {
  const labelled = Object.keys(EVENT_KIND_LABEL).sort();
  const offered = EVENT_KIND_OPTIONS.map((o) => o.value).sort();
  eq(offered, labelled, "options vs labels");
  eq(new Set(offered).size, offered.length, "no duplicates");
});

test("the dialog offers neither `shift` nor `document_note`, and both are still labelled", () => {
  // This is the assertion that would have caught PACKAGE_DESC_OPTIONS' missing
  // GAL and QT: a stored value that keeps RENDERING while the picker cannot
  // offer it. Put "shift" into AD_HOC_EVENT_KINDS and this goes red.
  no(AD_HOC_EVENT_KINDS.includes("shift"), "shift is not typed by hand");
  no(AD_HOC_EVENT_KINDS.includes("document_note"), "document_note is historical only");
  ok(EVENT_KIND_LABEL.shift, "shift still has a label to render with");
  ok(EVENT_KIND_LABEL.document_note, "document_note still has a label to render with");
});

test("every ad-hoc kind is a real kind", () => {
  for (const k of AD_HOC_EVENT_KINDS) ok(EVENT_KIND_LABEL[k], `${k} is labelled`);
  eq(new Set(AD_HOC_EVENT_KINDS).size, AD_HOC_EVENT_KINDS.length, "no duplicates");
});

test("a warning is disciplinary; being absent is not", () => {
  // An absence is a fact, a warning is an act.
  ok(isDisciplinary("verbal_warning"), "verbal");
  ok(isDisciplinary("written_warning"), "written");
  ok(isDisciplinary("incident"), "incident");
  no(isDisciplinary("attendance"), "attendance");
  no(isDisciplinary("call_out"), "call out");
  no(isDisciplinary("shift"), "shift");
});

/* -- which shift ----------------------------------------------------------- */

test("the shift report's own label is the authority, Off-site included", () => {
  // Measured over all 44,251 ratings joined to their report: Opening 23,718 ·
  // Closing 20,027 · Off-site 481 · Mid 19 · Manager 3.
  eq(shiftSlotFromLabel("Opening"), "opening", "Opening");
  eq(shiftSlotFromLabel("Closing"), "closing", "Closing");
  eq(shiftSlotFromLabel("Mid"), "mid", "Mid");
  eq(shiftSlotFromLabel("Off-site"), "off_site", "the 481 rows the sort field cannot express");
  eq(shiftSlotFromLabel("off site"), "off_site", "spelled without the hyphen");
  eq(shiftSlotFromLabel("OFFSITE"), "off_site", "shouted");
  // A role, not a shift, and three rows in eight years. The raw value survives
  // in source_payload either way.
  eq(shiftSlotFromLabel("Manager"), null, "Manager is not a shift");
  eq(shiftSlotFromLabel(""), null, "blank");
  eq(shiftSlotFromLabel(null), null, "null");
});

test("the label and the sort field agree wherever both exist", () => {
  // 23,718 Opening on sort 1, 19 Mid on sort 2, 20,027 Closing on sort 3 —
  // zero disagreements. If these two ever diverge the loader is reading the
  // wrong column.
  for (const [label, sort] of [["Opening", "1"], ["Mid", "2"], ["Closing", "3"]] as const) {
    eq(shiftSlotFromLabel(label), shiftSlotFromSortField(sort), `${label} vs sort ${sort}`);
  }
  // And the one case the fallback cannot reach, which is why it is a fallback.
  eq(shiftSlotFromSortField(""), null, "Off-site carries no sort field");
  eq(shiftSlotFromLabel("Off-site"), "off_site", "but the label has it");
});

test("cShift_sortfield 1/2/3 become opening/mid/closing, anything else is null", () => {
  eq(shiftSlotFromSortField("1"), "opening", "1");
  eq(shiftSlotFromSortField("2"), "mid", "2");
  eq(shiftSlotFromSortField(3), "closing", "numeric 3");
  eq(shiftSlotFromSortField(""), null, "blank — 487 rows carry none");
  eq(shiftSlotFromSortField(null), null, "null");
  eq(shiftSlotFromSortField("4"), null, "out of range");
  eq(shiftSlotFromSortField("opening"), null, "already-mapped value is not re-read");
});

/* -- the score ------------------------------------------------------------- */

test('"n/a" is excluded from the mean', () => {
  // Measured: the mean over the remaining categories matches FMP's stored total
  // on 15,427 rows and differs on one.
  eq(averageScore(["5", "n/a", "5", "5", "5"]), 5, "one n/a among fives");
  eq(averageScore(["4", "n/a", "5", "5"]), 4.67, "n/a does not count as a zero");
  eq(averageScore(["N/A", "5"]), 5, "case-insensitive");
});

test("0 IS counted — it is a supervisor writing the shift off", () => {
  // 132 rows carry a zero; the stored total says it was counted on 107 and
  // excluded on 10. The 65 all-zero rows read "NO CALL/NO SHOW".
  // Exclude zero here instead and both of these go red.
  eq(averageScore(["0", "0", "0", "0", "0"]), 0, "the no-call/no-show row");
  eq(averageScore(["5", "5", "0"]), 3.33, "a zero drags the mean down");
});

test("the true mean is kept where FMP rounded it away", () => {
  // FMP stored round(mean), so this row's 4.6 was filed as "5". Holding all
  // five components is what lets us do better than the source.
  eq(averageScore(["4", "5", "5", "4", "5"]), 4.6, "the rounded-away case");
  eq(averageScore(["3", "5", "3", "5", "5"]), 4.2, "another");
});

test("a mean with nothing to average is null, never 0", () => {
  // Null and zero mean opposite things here — "nobody scored this" against
  // "they scored it a zero" — so this is the one that must not drift.
  eq(averageScore([]), null, "empty");
  eq(averageScore(["n/a", "n/a", "n/a", "n/a", "n/a"]), null, "all n/a");
  eq(averageScore(["", null, undefined]), null, "all blank");
  eq(averageScore(["", "n/a", "0"]), 0, "but a lone zero is a score");
});

test("junk is skipped rather than poisoning the mean with NaN", () => {
  eq(averageScore(["5", "?", "5"]), 5, "unparsable value ignored");
  eq(averageScore(["  4  ", "5"]), 4.5, "whitespace tolerated");
});

/* -- the one line a cell shows --------------------------------------------- */

test("the headline wins, then the detail, then the outcome", () => {
  eq(eventSummaryLine({ headline: "Late", detail: "d", outcome: "o" }), "Late", "all three");
  // The two real rows that have a detail and no summary.
  eq(eventSummaryLine({ headline: null, detail: "d", outcome: "o" }), "d", "detail only");
  eq(eventSummaryLine({ headline: null, detail: null, outcome: "Documented" }), "Documented", "outcome only");
});

test("a row carrying none of the three reads null, not an empty string", () => {
  // ~22 Events rows are like this, which is also why 035 has no
  // "at least one of these is present" constraint.
  eq(eventSummaryLine({ headline: null, detail: null, outcome: null }), null, "all null");
  eq(eventSummaryLine({ headline: "   ", detail: "", outcome: null }), null, "whitespace is blank");
  eq(eventSummaryLine({ headline: "  Late  ", detail: null, outcome: null }), "Late", "trimmed");
});

/* -- how someone is doing -------------------------------------------------- */

const TODAY = "2026-08-06";

function shift(occurred_on: string, score: number | null): ScoredEvent {
  return { kind: "shift", occurred_on, score };
}

test("the summary averages only scored shifts inside the window", () => {
  const events = [shift("2026-08-06", 5), shift("2026-08-05", 4), shift("2026-08-04", null)];
  eq(ratingSummary(events, { today: TODAY }), { shifts: 2, mean: 4.5, last: "2026-08-06" });
});

test("the window is `days` days ENDING TODAY, inclusive at both ends", () => {
  // A 90-day window starts 89 days back. Both boundary cases, because an
  // off-by-one here silently drops or admits a day's shifts.
  const first = "2026-05-09"; // 89 days before 2026-08-06
  const before = "2026-05-08"; // one day earlier — outside
  eq(ratingSummary([shift(first, 3)], { today: TODAY }).shifts, 1, "first day in the window");
  eq(ratingSummary([shift(before, 3)], { today: TODAY }).shifts, 0, "the day before it");
  eq(ratingSummary([shift(TODAY, 3)], { today: TODAY }).shifts, 1, "today itself");
});

test("a future-dated shift is ignored so `last` cannot be a typo", () => {
  const events = [shift("2026-09-01", 5), shift("2026-08-04", 4)];
  eq(ratingSummary(events, { today: TODAY }), { shifts: 1, mean: 4, last: "2026-08-04" });
});

test("only `shift` events count — a warning is not a rating", () => {
  const events: ScoredEvent[] = [
    shift("2026-08-05", 5),
    { kind: "written_warning", occurred_on: "2026-08-05", score: 1 },
    { kind: "attendance", occurred_on: "2026-08-04", score: null },
  ];
  eq(ratingSummary(events, { today: TODAY }), { shifts: 1, mean: 5, last: "2026-08-05" });
});

test("`last` is the most recent shift even when it was not scored", () => {
  // "When did we last rate them" and "what did they average" are different
  // questions, and an unscored shift still answers the first.
  const events = [shift("2026-08-06", null), shift("2026-08-01", 4)];
  eq(ratingSummary(events, { today: TODAY }), { shifts: 1, mean: 4, last: "2026-08-06" });
});

test("nothing to summarise reports zero shifts and a null mean", () => {
  eq(ratingSummary([], { today: TODAY }), { shifts: 0, mean: null, last: null }, "no events");
  eq(
    ratingSummary([shift("2026-08-05", null)], { today: TODAY }),
    { shifts: 0, mean: null, last: "2026-08-05" },
    "rated nobody scored",
  );
});

test("the mean is rounded to 2dp, and a custom window is honoured", () => {
  const events = [shift("2026-08-06", 5), shift("2026-08-05", 5), shift("2026-08-04", 4)];
  eq(ratingSummary(events, { today: TODAY }).mean, 4.67, "three-way mean");
  eq(ratingSummary(events, { today: TODAY, days: 2 }).shifts, 2, "a two-day window");
  eq(RATING_WINDOW_DAYS, 90, "the default the record screen uses");
});

test("a zero score pulls the mean down rather than being skipped", () => {
  // The same rule as averageScore, one level up: a no-show is a 0, not a gap.
  eq(ratingSummary([shift("2026-08-06", 0), shift("2026-08-05", 5)], { today: TODAY }).mean, 2.5);
});
