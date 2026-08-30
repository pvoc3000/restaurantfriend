/**
 * Checklists, walkthroughs and inspections — the pure half.
 *
 * Everything here is a rule with no database and no React in it, so it can be
 * exercised by `npm run fixtures`. The screens hold the queries; this holds the
 * decisions. `lib/shiftReports` is the same split for the same reason.
 *
 * Migration 076 is the schema this describes, and its header carries the five
 * decisions behind it. The two that most of this file exists to serve:
 *
 *   · A CHECK IS FOUR STATES. pending / done / issue / n/a — the order guide's
 *     three-state lesson. "Nobody has been there yet" and "looked at, fine" are
 *     different sentences.
 *   · AN ITEM CAN ASK FOR A VALUE, with an expected range, and an out-of-range
 *     reading raises the issue state BY ITSELF. That is the one place this
 *     module lets the app decide anything.
 */

import type { ShiftSlot } from "./employeeEvents";

export type ChecklistKind = "checklist" | "walkthrough" | "inspection";

export const CHECKLIST_KIND_LABEL: Record<ChecklistKind, string> = {
  checklist: "Checklist",
  walkthrough: "Walkthrough",
  inspection: "Inspection",
};

/**
 * What each kind is FOR, in the words the screens use. A walkthrough is the
 * manager's eye and a checklist is the supervisor's routine; saying so on the
 * picker saves explaining it twice.
 */
export const CHECKLIST_KIND_HINT: Record<ChecklistKind, string> = {
  checklist: "walked at the end of a shift",
  walkthrough: "a manager's round, scored",
  inspection: "an outside inspection or certification",
};

export type CheckStatus = "pending" | "done" | "issue" | "na";

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  pending: "Not yet",
  done: "Done",
  issue: "Issue",
  na: "N/A",
};

export type ResponseType = "check" | "number" | "text" | "choice";

// ---------------------------------------------------------------------------
// Which checklist is asked for tonight
// ---------------------------------------------------------------------------

/**
 * A template's schedule, as 076 stores it.
 *
 * NULL on either array means "not scheduled — started by hand", which is what
 * lets a walkthrough and an inspection need no extra machinery: a manager walks
 * when they walk and an inspector arrives unannounced. An EMPTY array cannot
 * occur — 076 refuses it, so there is exactly one spelling of "any".
 */
export type ScheduledTemplate = {
  id: string;
  kind: ChecklistKind;
  is_active: boolean;
  /** ISO weekday numbers, 1 = Monday. */
  weekdays: number[] | null;
  shifts: string[] | null;
};

/**
 * Does this template want walking on `weekday`, for `shift`?
 *
 * ISO 1 = MONDAY, and an off-by-one here silently shifts a shop's whole closing
 * routine by a day — the same trap `lib/productionPlans` is fixture-pinned on.
 *
 * A template with no weekday set is NEVER offered automatically: it is started
 * by hand, which is exactly what "not scheduled" means. Returning true here
 * instead would put every walkthrough in front of every closing supervisor.
 */
export function templateAppliesOn(
  template: ScheduledTemplate,
  weekday: number,
  shift: ShiftSlot,
): boolean {
  if (!template.is_active) return false;
  if (!template.weekdays || !template.weekdays.includes(weekday)) return false;
  // A null shift set means "any shift this template's weekdays cover".
  if (template.shifts && !template.shifts.includes(shift)) return false;
  return true;
}

/** Every template a given (weekday, shift) is asked for. */
export function templatesForShift<T extends ScheduledTemplate>(
  templates: T[],
  weekday: number,
  shift: ShiftSlot,
): T[] {
  return templates.filter((t) => templateAppliesOn(t, weekday, shift));
}

/**
 * A template ITEM's own weekday narrowing, on top of its template's.
 *
 * This is how the Friday-only deep clean rides on the daily list without a
 * second template. Null — the common case — means every run.
 */
export function itemAppliesOn(
  item: { weekdays: number[] | null; is_active: boolean },
  weekday: number,
): boolean {
  if (!item.is_active) return false;
  if (!item.weekdays) return true;
  return item.weekdays.includes(weekday);
}

// ---------------------------------------------------------------------------
// The business date
// ---------------------------------------------------------------------------

/**
 * A closing walk finished after midnight belongs to YESTERDAY.
 *
 * This is the highest-risk rule in the module. `current_date` in Postgres is
 * UTC, so after 4pm Pacific it is already tomorrow — and a run and its shift
 * report have to agree about which day they are, or they never find each other.
 * So the date is derived HERE, in the org's own timezone (`lib/today`), and
 * passed in to every writer. Nothing in 076 calls `current_date`.
 *
 * `localDate` and `localHour` are both already in the org's zone. The cutoff is
 * 5am rather than midnight because a closing shift genuinely runs past twelve
 * and an opening one starts at five; between those, "which day was this" has
 * one sensible answer.
 *
 * It applies to CLOSING only. A mid shift recorded at 3am is somebody working
 * unusual hours, and guessing on their behalf would move a date they can see
 * and would have to correct. `business_date` is editable on the run for exactly
 * the cases no rule should try to cover.
 */
export const CLOSING_ROLLOVER_HOUR = 5;

export function businessDateFor(
  shift: ShiftSlot | null,
  localDate: string,
  localHour: number,
): string {
  if (shift !== "closing" || localHour >= CLOSING_ROLLOVER_HOUR) return localDate;
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

export type RangeSpec = { min_value: number | null; max_value: number | null };

export type ReadingVerdict = "no_range" | "in_range" | "below" | "above";

/**
 * What a number means against the item's expected range.
 *
 * `no_range` is a real answer and not a failure: plenty of `number` items are
 * just a count somebody records. Merging it into `in_range` would let the UI
 * claim a reading had been checked when nothing checked it.
 */
export function assessReading(item: RangeSpec, value: number | null): ReadingVerdict {
  if (item.min_value == null && item.max_value == null) return "no_range";
  if (value == null) return "no_range";
  if (item.min_value != null && value < item.min_value) return "below";
  if (item.max_value != null && value > item.max_value) return "above";
  return "in_range";
}

export function readingIsOutOfRange(item: RangeSpec, value: number | null): boolean {
  const v = assessReading(item, value);
  return v === "below" || v === "above";
}

/**
 * The sentence beside an out-of-range reading. It names the BOUND, because
 * "39 (expected 34–40)" tells you how far off you are and "out of range" does
 * not.
 */
export function readingLabel(
  item: RangeSpec & { unit: string | null },
  value: number | null,
): string | null {
  const verdict = assessReading(item, value);
  if (verdict !== "below" && verdict !== "above") return null;
  const unit = item.unit ? ` ${item.unit}` : "";
  const lo = item.min_value;
  const hi = item.max_value;
  if (lo != null && hi != null) return `expected ${lo}–${hi}${unit}`;
  if (verdict === "below") return `expected at least ${lo}${unit}`;
  return `expected at most ${hi}${unit}`;
}

/**
 * The status a typed reading implies.
 *
 * THE APP DECIDES THIS AND ONLY THIS. It must never decide what counts as
 * dirty; it can absolutely decide what counts as above 40°F. An out-of-range
 * value becomes an `issue`, which is what puts it in the emailed report without
 * anybody having to remember that 41 is bad.
 *
 * It returns `done` for a reading inside its range and for one with no range at
 * all — typing a number IS looking at the thing. It never returns `pending`,
 * because a value has been entered.
 */
export function statusForReading(item: RangeSpec, value: number | null): CheckStatus {
  if (value == null) return "pending";
  return readingIsOutOfRange(item, value) ? "issue" : "done";
}

// ---------------------------------------------------------------------------
// The walk's own order
// ---------------------------------------------------------------------------

/**
 * `checklist_run_items.sort` is `numeric(8, 2)`, so it holds at most
 * **999999.99**. Everything below is that one fact.
 */
const RUN_SORT_MAX_SECTION = 997;
const RUN_SORT_NO_SECTION = 998;
const RUN_SORT_MAX_ITEM = 999;

/**
 * Where an item sits in the walk, composed into ONE number.
 *
 * The walk's order is the SHOP's: the shelf's position first, the item's own
 * `sort` within it. Composed rather than joined so a run can be rendered in
 * order without reaching back to `shop_sections` — which it must not do anyway,
 * since a run snapshots its section as text and the shelf may since have moved.
 *
 * IT IS CLAMPED, AND THAT IS THE WHOLE POINT OF THIS FUNCTION EXISTING.
 * Both callers used to inline `(sectionOrder.get(id) ?? 9999) * 1000 + sort`,
 * and 9999 × 1000 is 9,999,000 — an overflow of a `numeric(8, 2)` column. The
 * insert failed with "numeric field overflow", `StartWalk` reported it in the
 * dialog, and the run was already created, so **an item with no shop section
 * produced a walk with NO ITEMS AT ALL**. Invisible on the real DF01 lists,
 * where every item has a section; certain on the first template anybody types
 * in a hurry. Found by starting one.
 *
 * A section with no known position sorts LAST, which is `lib/tableSort`'s
 * empty-last rule and the reason the sentinel is the largest value here.
 */
export function runItemSort(
  sectionIndex: number | null | undefined,
  itemSort: number,
): number {
  const section =
    sectionIndex == null
      ? RUN_SORT_NO_SECTION
      : Math.min(Math.max(0, Math.trunc(sectionIndex)), RUN_SORT_MAX_SECTION);
  const within = Math.min(Math.max(0, Math.trunc(itemSort)), RUN_SORT_MAX_ITEM);
  return section * 1000 + within;
}

// ---------------------------------------------------------------------------
// Choice items
// ---------------------------------------------------------------------------

/**
 * The options on a `choice` item, typed as one comma-separated line.
 *
 * A SET, not a fixed-width strip — so this is deliberately NOT `InlineValue`'s
 * `arrayColumn`/`arrayIndex` slot idiom, which exists for `par_by_weekday` and
 * the recipe scale columns, where slot n means something. `TemplateShiftSet`
 * makes the same argument. Somebody adding a fourth answer should type a comma,
 * not find an empty fourth box.
 *
 * Blanks are dropped and repeats are collapsed, both keeping FIRST position:
 * a trailing comma is how anybody types a list, and two identical options are a
 * button you cannot tell from the button beside it. Order is preserved because
 * it is the order they will be shown in.
 */
export function parseChoiceOptions(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "") continue;
    if (out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

/** The inverse, for putting a stored set back in the box. */
export function choiceOptionsText(choices: readonly string[] | null): string {
  return (choices ?? []).join(", ");
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type RunItemLike = {
  status: CheckStatus;
  requires_photo: boolean;
  photoCount: number;
};

/**
 * What is still outstanding, in words.
 *
 * `closeReadiness`'s rule and its reason: it NAMES what is unresolved and then
 * lets you through anyway. Gate finishing a walk on a complete set and the
 * night the walk-in floods is a report that never gets sent, which is how a
 * status stops meaning anything. A confirm that names something and then blocks
 * you is how people learn to stop reading confirms.
 */
export function checklistReadiness(items: RunItemLike[]): string[] {
  const out: string[] = [];
  const pending = items.filter((i) => i.status === "pending").length;
  if (pending > 0) {
    out.push(`${pending} item${pending === 1 ? "" : "s"} not looked at yet`);
  }
  const unphotographed = items.filter(
    (i) => i.requires_photo && i.photoCount === 0 && i.status !== "pending",
  ).length;
  if (unphotographed > 0) {
    // The verb agrees too: "1 item still wants a photo", "2 items still want".
    out.push(
      unphotographed === 1
        ? "1 item still wants a photo"
        : `${unphotographed} items still want a photo`,
    );
  }
  const issues = items.filter((i) => i.status === "issue").length;
  if (issues > 0) {
    out.push(`${issues} issue${issues === 1 ? "" : "s"} flagged`);
  }
  return out;
}

/** `3 of 27 done` — the shift report's submit page and the list both say this. */
export function progressLabel(items: { status: CheckStatus }[]): string {
  const done = items.filter((i) => i.status !== "pending").length;
  return `${done} of ${items.length} done`;
}

export function outstandingCount(items: { status: CheckStatus }[]): number {
  return items.filter((i) => i.status === "pending").length;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * The section roll-up, DERIVED and never stored.
 *
 * Mark chose per-ITEM scoring (2026-08-29). The measured hazard is that item
 * scores stop discriminating — 89% of FMP's 40,793 shift ratings are a 5 — so
 * the score is optional, its resting state is "not scored", and the trend a
 * manager can act on is computed from whatever was actually scored rather than
 * from a second number somebody has to maintain. `sold` stays derived for the
 * same reason.
 *
 * A section with nothing scored returns null, NOT zero. Zero is a real score in
 * 035's range — a supervisor writing the shift off — so defaulting to it would
 * report the worst possible verdict on a section nobody looked at.
 */
export function sectionScores(
  items: { section_name: string | null; score: number | null }[],
): { section: string; average: number | null; scored: number }[] {
  const order: string[] = [];
  const bucket = new Map<string, number[]>();
  for (const i of items) {
    const key = i.section_name ?? "No section";
    if (!bucket.has(key)) {
      bucket.set(key, []);
      order.push(key);
    }
    if (i.score != null) bucket.get(key)!.push(i.score);
  }
  return order.map((section) => {
    const scores = bucket.get(section)!;
    const average =
      scores.length === 0
        ? null
        : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
    return { section, average, scored: scores.length };
  });
}

// ---------------------------------------------------------------------------
// Duplicating a template to another shop
// ---------------------------------------------------------------------------

export type SectionLike = { id: string; display_name: string };

/**
 * Mark's shortcut (2026-08-29): "we should be able to duplicate checklists then
 * change the location to something else as a short cut to creating a new one."
 *
 * The thing that makes this more than a row copy: `shop_section_id` is
 * LOCATION-SCOPED, so a DF01 checklist copied to DF02 arrives pointing at DF01's
 * shelves — every item attached to a room that isn't in the building.
 *
 * So sections are matched by DISPLAY NAME, which 017 made unique per location,
 * and anything with no counterpart lands in "No section" and is NAMED in a
 * receipt. That is the loaders' own posture — report what didn't map rather
 * than failing or silently guessing. Sixty percent right with the other forty
 * on screen is a far better start than nothing.
 *
 * Matching is case- and space-insensitive because these names are typed by
 * hand at two shops months apart.
 */
export function sectionMapForDuplicate(
  from: SectionLike[],
  to: SectionLike[],
): { map: Record<string, string>; unmapped: string[] } {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const target = new Map(to.map((s) => [key(s.display_name), s.id]));
  const map: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const s of from) {
    const hit = target.get(key(s.display_name));
    if (hit) map[s.id] = hit;
    else unmapped.push(s.display_name);
  }
  return { map, unmapped };
}

/**
 * The sentence the duplicate dialog shows afterwards.
 *
 * It says what LANDED as well as what didn't, because "3 sections didn't map"
 * alone reads as a failure when the other nine were fine.
 */
export function duplicateReceipt(
  itemCount: number,
  unmapped: string[],
  toLocationCode: string,
): string {
  const items = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  if (unmapped.length === 0) {
    return `Copied ${items} to ${toLocationCode}. Every section matched.`;
  }
  const names = unmapped.join(", ");
  return (
    `Copied ${items} to ${toLocationCode}. ` +
    `${unmapped.length} section${unmapped.length === 1 ? "" : "s"} had no match there ` +
    `and those items are in "No section": ${names}. ` +
    `The copy is inactive until you have set them.`
  );
}

// ---------------------------------------------------------------------------
// Labels for the two schedule sets
// ---------------------------------------------------------------------------

/** ISO order, so index 0 is Monday and the array reads the way a week does. */
export const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A weekday set in a table cell.
 *
 * "Not scheduled" rather than an em dash or a blank, because null is a REAL
 * state here — it is what a walkthrough and an inspection are — and a blank
 * would read as somebody not having got round to filling it in.
 *
 * "Every day" for all seven: seven abbreviations is 27 characters saying one
 * thing, and the whole point of a cell is being scannable.
 */
export function weekdaySetLabel(days: number[] | null): string {
  if (!days || days.length === 0) return "Not scheduled";
  if (days.length === 7) return "Every day";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_ABBR[d - 1] ?? String(d))
    .join(", ");
}

/**
 * A shift set in a table cell. Null means any — which for a checklist is
 * unusual and for a walkthrough is the norm.
 */
export function shiftSetLabel(
  shifts: string[] | null,
  label: (s: string) => string,
): string {
  if (!shifts || shifts.length === 0) return "Any shift";
  return shifts.map(label).join(", ");
}

// ---------------------------------------------------------------------------
// The two halves of one screen
// ---------------------------------------------------------------------------

/**
 * WALKS AND MASTER LISTS SHARE A SCREEN (Mark, 2026-08-30: "instead of having a
 * checklist and master checklist menu options, what about just having a
 * Checklist screen with tab picker … Basically combine the two screens").
 *
 * They are the same subject at two moments — what gets walked, and what has
 * been — and two adjacent nav entries made you decide which one you wanted
 * before you could look at either. `/events` sets the precedent for the
 * mechanism: a `TabPicker` choosing between two populations that are fetched
 * under different rules and rendered with different columns.
 *
 * The RECORDS keep their own addresses (`/checklists/[id]` and
 * `/checklist-templates/[id]`); only the two LISTS merge.
 */
export type ChecklistView = "walks" | "templates";

export const CHECKLIST_VIEWS: ChecklistView[] = ["walks", "templates"];

export const CHECKLIST_VIEW_LABEL: Record<ChecklistView, string> = {
  // "Checklists" (Mark, 2026-08-30), not "Walks". It repeats the screen's own
  // name, which is why it was "Walks" first — and that was the wrong trade:
  // "walk" is a word this module invented, where a supervisor says they are
  // doing the checklist. A tab that echoes the heading costs nothing next to a
  // tab nobody recognises.
  //
  // The KEY stays `walks`, and it is invisible: it is the default view, so it
  // writes no parameter and only `?view=templates` is ever in an address bar.
  walks: "Checklists",
  // "Templates" (Mark, 2026-08-30), which is also what the route and the
  // `?view=` parameter have always said — only the visible word was out of
  // step. Neither label repeats the screen's own name the way "Checklists"
  // would.
  templates: "Templates",
};

/**
 * The view a request is asking for. Anything unrecognised falls back to the
 * walks — a bad parameter should show you the screen, not an error.
 */
export function parseChecklistView(raw: string | string[] | undefined): ChecklistView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (CHECKLIST_VIEWS as string[]).includes(value ?? "")
    ? (value as ChecklistView)
    : "walks";
}

/**
 * The address of one view.
 *
 * `walks` writes NO parameter, so the plain `/checklists` stays the canonical
 * address — which is what the nav links to and what every link already stored
 * points at. `recipeHref`'s rule.
 */
export function checklistViewHref(view: ChecklistView): string {
  return view === "walks" ? "/checklists" : `/checklists?view=${view}`;
}
