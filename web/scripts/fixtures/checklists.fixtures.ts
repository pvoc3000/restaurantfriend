/**
 * Checklists, walkthroughs and inspections.
 *
 * Four of the rules below are ones the app shares with the database rather than
 * owns, and those are the ones worth pinning hardest — if the TypeScript and
 * migration 076 ever disagree, the walk lets somebody commit a write the CHECK
 * bounces back as a raw 23514, which is the one refusal an inline cell cannot
 * explain.
 *
 * The two that would be silent if they broke:
 *
 *   · `businessDateFor` — a closing walk finished after midnight belongs to
 *     YESTERDAY. Get it wrong and the run and its shift report land on
 *     different days and never find each other, which looks like the link
 *     being broken rather than like a date being wrong.
 *   · `templateAppliesOn` — ISO 1 = Monday. An off-by-one silently shifts a
 *     shop's whole closing routine by a day, and every individual night still
 *     looks plausible.
 */

import { test, eq, ok, no } from "./harness";
import {
  CLOSING_ROLLOVER_HOUR,
  assessReading,
  businessDateFor,
  checklistReadiness,
  duplicateReceipt,
  itemAppliesOn,
  outstandingCount,
  progressLabel,
  readingIsOutOfRange,
  readingLabel,
  sectionMapForDuplicate,
  sectionScores,
  statusForReading,
  templateAppliesOn,
  templatesForShift,
  weekdaySetLabel,
  shiftSetLabel,
  type CheckStatus,
  type ScheduledTemplate,
} from "../../src/lib/checklists";

const closing: ScheduledTemplate = {
  id: "t1",
  kind: "checklist",
  is_active: true,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  shifts: ["closing"],
};

const weekendOpening: ScheduledTemplate = {
  id: "t2",
  kind: "checklist",
  is_active: true,
  weekdays: [6, 7],
  shifts: ["opening"],
};

/** A walkthrough: no schedule at all, started by hand. */
const walkthrough: ScheduledTemplate = {
  id: "t3",
  kind: "walkthrough",
  is_active: true,
  weekdays: null,
  shifts: null,
};

// ---------------------------------------------------------------------------
// Which checklist tonight
// ---------------------------------------------------------------------------

test("templateAppliesOn: the closing list runs every night", () => {
  for (let d = 1; d <= 7; d++) ok(templateAppliesOn(closing, d, "closing"), `day ${d}`);
});

test("templateAppliesOn: but not on another shift", () => {
  no(templateAppliesOn(closing, 3, "opening"));
  no(templateAppliesOn(closing, 3, "mid"));
});

test("templateAppliesOn: ISO 1 is MONDAY, 6/7 is the weekend", () => {
  // Saturday and Sunday only. If the index ever slips by one this passes on
  // Friday/Saturday instead and every individual night still looks plausible.
  no(templateAppliesOn(weekendOpening, 5, "opening"), "Friday");
  ok(templateAppliesOn(weekendOpening, 6, "opening"), "Saturday");
  ok(templateAppliesOn(weekendOpening, 7, "opening"), "Sunday");
  no(templateAppliesOn(weekendOpening, 1, "opening"), "Monday");
});

test("templateAppliesOn: an UNSCHEDULED template is never offered automatically", () => {
  // Null weekdays means "started by hand". Returning true here instead would
  // put every walkthrough in front of every closing supervisor.
  for (let d = 1; d <= 7; d++) no(templateAppliesOn(walkthrough, d, "closing"), `day ${d}`);
});

test("templateAppliesOn: an inactive template is never offered", () => {
  no(templateAppliesOn({ ...closing, is_active: false }, 3, "closing"));
});

test("templateAppliesOn: a null SHIFT set means any shift its weekdays cover", () => {
  const anyShift = { ...closing, shifts: null };
  ok(templateAppliesOn(anyShift, 3, "closing"));
  ok(templateAppliesOn(anyShift, 3, "opening"));
  ok(templateAppliesOn(anyShift, 3, "off_site"));
});

test("templatesForShift picks only the ones asked for", () => {
  const all = [closing, weekendOpening, walkthrough];
  eq(
    templatesForShift(all, 6, "closing").map((t) => t.id),
    ["t1"],
  );
  eq(
    templatesForShift(all, 6, "opening").map((t) => t.id),
    ["t2"],
  );
  eq(templatesForShift(all, 3, "opening").map((t) => t.id), []);
});

test("itemAppliesOn: null weekdays is the common case and means every run", () => {
  const item = { weekdays: null, is_active: true };
  for (let d = 1; d <= 7; d++) ok(itemAppliesOn(item, d), `day ${d}`);
});

test("itemAppliesOn: the Friday-only deep clean rides on the daily list", () => {
  const friday = { weekdays: [5], is_active: true };
  ok(itemAppliesOn(friday, 5));
  no(itemAppliesOn(friday, 4));
  no(itemAppliesOn({ weekdays: [5], is_active: false }, 5), "inactive");
});

// ---------------------------------------------------------------------------
// The business date — the highest-risk rule in the module
// ---------------------------------------------------------------------------

test("businessDateFor: a closing walk at 1:15am belongs to YESTERDAY", () => {
  eq(businessDateFor("closing", "2026-08-30", 1), "2026-08-29");
});

test("businessDateFor: a closing walk at 11pm is the same day", () => {
  eq(businessDateFor("closing", "2026-08-29", 23), "2026-08-29");
});

test("businessDateFor: the rollover hour itself is already the new day", () => {
  eq(businessDateFor("closing", "2026-08-30", CLOSING_ROLLOVER_HOUR), "2026-08-30");
  eq(businessDateFor("closing", "2026-08-30", CLOSING_ROLLOVER_HOUR - 1), "2026-08-29");
});

test("businessDateFor: only CLOSING rolls back", () => {
  // A mid shift recorded at 3am is somebody working unusual hours; guessing on
  // their behalf would move a date they can see and would have to correct.
  eq(businessDateFor("opening", "2026-08-30", 3), "2026-08-30");
  eq(businessDateFor("mid", "2026-08-30", 3), "2026-08-30");
  eq(businessDateFor(null, "2026-08-30", 3), "2026-08-30");
});

test("businessDateFor: rolling back crosses a month and a year boundary", () => {
  eq(businessDateFor("closing", "2026-09-01", 2), "2026-08-31");
  eq(businessDateFor("closing", "2027-01-01", 2), "2026-12-31");
  eq(businessDateFor("closing", "2028-03-01", 2), "2028-02-29", "leap year");
});

// ---------------------------------------------------------------------------
// Readings — the one place the app decides anything
// ---------------------------------------------------------------------------

const walkIn = { min_value: 34, max_value: 40, unit: "F" };

test("assessReading: in, below and above", () => {
  eq(assessReading(walkIn, 38), "in_range");
  eq(assessReading(walkIn, 34), "in_range", "the bound itself is in range");
  eq(assessReading(walkIn, 40), "in_range", "and so is the upper one");
  eq(assessReading(walkIn, 33.9), "below");
  eq(assessReading(walkIn, 44), "above");
});

test("assessReading: no range is a real answer, not a failure", () => {
  // Plenty of `number` items are just a count somebody records. Merging this
  // into in_range would let the UI claim a reading had been checked when
  // nothing checked it.
  eq(assessReading({ min_value: null, max_value: null }, 999), "no_range");
  eq(assessReading(walkIn, null), "no_range", "and so is a missing value");
});

test("assessReading: a one-sided range works from either end", () => {
  eq(assessReading({ min_value: null, max_value: 40 }, 44), "above");
  eq(assessReading({ min_value: null, max_value: 40 }, 10), "in_range");
  eq(assessReading({ min_value: 165, max_value: null }, 140), "below");
  eq(assessReading({ min_value: 165, max_value: null }, 200), "in_range");
});

test("statusForReading: 44 degrees raises the ISSUE by itself", () => {
  // The whole argument for values on duties: nobody has to remember that 41 is
  // bad, and the flag reaches the emailed report without a judgement call.
  eq(statusForReading(walkIn, 44), "issue");
  eq(statusForReading(walkIn, 38), "done");
  eq(statusForReading(walkIn, null), "pending", "no value typed is still untouched");
});

test("statusForReading: a number with no range is DONE, never an issue", () => {
  eq(statusForReading({ min_value: null, max_value: null }, 12), "done");
});

test("readingIsOutOfRange agrees with assessReading on every case", () => {
  for (const v of [33, 34, 38, 40, 41, 44]) {
    eq(readingIsOutOfRange(walkIn, v), assessReading(walkIn, v) !== "in_range", `at ${v}`);
  }
});

test("readingLabel names the BOUND, and is silent when nothing is wrong", () => {
  eq(readingLabel(walkIn, 44), "expected 34–40 F");
  eq(readingLabel(walkIn, 38), null);
  eq(readingLabel({ min_value: null, max_value: 40, unit: "F" }, 44), "expected at most 40 F");
  eq(readingLabel({ min_value: 165, max_value: null, unit: null }, 140), "expected at least 165");
});

// ---------------------------------------------------------------------------
// Readiness — names it, then lets you through
// ---------------------------------------------------------------------------

const item = (status: CheckStatus, requires_photo = false, photoCount = 0) => ({
  status,
  requires_photo,
  photoCount,
});

test("checklistReadiness: a finished walk has nothing to say", () => {
  eq(checklistReadiness([item("done"), item("done")]), []);
});

test("checklistReadiness names untouched items, missing photos and issues", () => {
  eq(
    checklistReadiness([
      item("pending"),
      item("pending"),
      item("issue", true, 0),
      item("done"),
    ]),
    ["2 items not looked at yet", "1 item still wants a photo", "1 issue flagged"],
  );
});

test("checklistReadiness: singular and plural both read correctly", () => {
  eq(checklistReadiness([item("pending")]), ["1 item not looked at yet"]);
});

test("checklistReadiness: an untouched item is not also nagged about its photo", () => {
  // Otherwise every unwalked run reports each item twice and the list is noise.
  eq(checklistReadiness([item("pending", true, 0)]), ["1 item not looked at yet"]);
});

test("progressLabel and outstandingCount count the same thing two ways", () => {
  const items = [item("done"), item("issue"), item("na"), item("pending")];
  eq(progressLabel(items), "3 of 4 done");
  eq(outstandingCount(items), 1);
});

// ---------------------------------------------------------------------------
// Scores — derived, never stored
// ---------------------------------------------------------------------------

test("sectionScores averages what was actually scored", () => {
  eq(
    sectionScores([
      { section_name: "Kitchen", score: 5 },
      { section_name: "Kitchen", score: 4 },
      { section_name: "Kitchen", score: null },
      { section_name: "Walk In", score: 3 },
    ]),
    [
      { section: "Kitchen", average: 4.5, scored: 2 },
      { section: "Walk In", average: 3, scored: 1 },
    ],
  );
});

test("sectionScores: a section with nothing scored is NULL, never zero", () => {
  // Zero is a real score in 035's range — a supervisor writing the shift off —
  // so defaulting to it reports the worst possible verdict on a section nobody
  // looked at.
  eq(sectionScores([{ section_name: "Kitchen", score: null }]), [
    { section: "Kitchen", average: null, scored: 0 },
  ]);
});

test("sectionScores counts a real ZERO rather than ignoring it", () => {
  eq(sectionScores([{ section_name: "K", score: 0 }, { section_name: "K", score: 4 }]), [
    { section: "K", average: 2, scored: 2 },
  ]);
});

test("sectionScores keeps the walk order and names the sectionless bucket", () => {
  eq(
    sectionScores([
      { section_name: "Walk In", score: 5 },
      { section_name: null, score: 5 },
      { section_name: "Kitchen", score: 5 },
    ]).map((s) => s.section),
    ["Walk In", "No section", "Kitchen"],
  );
});

// ---------------------------------------------------------------------------
// Duplicating to another shop
// ---------------------------------------------------------------------------

const df01 = [
  { id: "a", display_name: "Kitchen" },
  { id: "b", display_name: "Walk In - R1" },
  { id: "c", display_name: "Basement" },
];
const df02 = [
  { id: "x", display_name: "kitchen" },
  { id: "y", display_name: "Walk In  - R1" },
];

test("sectionMapForDuplicate matches by name, ignoring case and spacing", () => {
  const { map, unmapped } = sectionMapForDuplicate(df01, df02);
  eq(map, { a: "x", b: "y" });
  eq(unmapped, ["Basement"]);
});

test("sectionMapForDuplicate: nothing in common maps nothing, and says so", () => {
  const { map, unmapped } = sectionMapForDuplicate(df01, [
    { id: "z", display_name: "Garage" },
  ]);
  eq(map, {});
  eq(unmapped, ["Kitchen", "Walk In - R1", "Basement"]);
});

test("duplicateReceipt says what LANDED as well as what didn't", () => {
  // "3 sections didn't map" alone reads as a failure when the other nine were
  // fine.
  eq(
    duplicateReceipt(12, [], "DF02"),
    "Copied 12 items to DF02. Every section matched.",
  );
  ok(duplicateReceipt(12, ["Basement"], "DF02").includes("Copied 12 items to DF02."));
  ok(duplicateReceipt(12, ["Basement"], "DF02").includes("Basement"));
  ok(
    duplicateReceipt(12, ["Basement"], "DF02").includes("inactive"),
    "and warns that the copy is inactive",
  );
});

// ---------------------------------------------------------------------------
// The two schedule labels
// ---------------------------------------------------------------------------

test("weekdaySetLabel: null is NOT SCHEDULED, never a blank", () => {
  // Null is a real state here — it is what a walkthrough IS — where a blank
  // reads as somebody not having got round to filling it in.
  eq(weekdaySetLabel(null), "Not scheduled");
  eq(weekdaySetLabel([]), "Not scheduled");
});

test("weekdaySetLabel: all seven collapses, and ISO 1 is Monday", () => {
  eq(weekdaySetLabel([1, 2, 3, 4, 5, 6, 7]), "Every day");
  eq(weekdaySetLabel([6, 7]), "Sat, Sun");
  eq(weekdaySetLabel([1]), "Mon");
  eq(weekdaySetLabel([7, 1]), "Mon, Sun", "and it sorts into week order");
});

test("shiftSetLabel: null is ANY SHIFT", () => {
  const label = (s: string) => s.toUpperCase();
  eq(shiftSetLabel(null, label), "Any shift");
  eq(shiftSetLabel(["closing"], label), "CLOSING");
  eq(shiftSetLabel(["opening", "closing"], label), "OPENING, CLOSING");
});
