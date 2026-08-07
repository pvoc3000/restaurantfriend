// Everything that has happened with an employee — one table (migration 035),
// merged from FileMaker's two.
//
// FMP kept `Events` (2,398 rows over twelve years: warnings, incidents,
// call-outs, check-ins, praise) apart from `Ratings` (44,251 rows, one per
// person per shift, written daily by whoever ran the shift). Mark's reading,
// 2026-08-06: "these should really be all in one table: Events. What were
// 'ratings' are really just shift events… Events already had different types,
// what's one more."
//
// So a rating is `kind: "shift"` and the five 1–5 category scores collapse to
// ONE. That collapse is defensible because the categories never discriminated:
// 89% of all 40,793 scored ratings are a 5, and the NOTE is the payload
// (35,832 filled, 32,044 distinct, median 66 characters — one or two real
// sentences). The five components survive verbatim in `source_payload`, so the
// collapse is reversible without a re-export, which matters because FileMaker
// is being decommissioned.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE IS NOT
//
// It is not the shift log. Supervisors write ratings in BATCHES at end of
// shift — 2–3 people, alongside sales, tips and donut production counts — and
// production is an unbuilt module. Building a ratings-only batch screen now
// means building it twice, so the write surface here is the employee's own
// record and the batch screen waits (Mark, 2026-08-06).

import type { PickOption } from "@/components/ui/PickList";
import { daysBefore } from "./today";

/* -- the vocabulary -------------------------------------------------------- */

export type EventKind =
  | "shift"
  | "call_out"
  | "attendance"
  | "verbal_warning"
  | "written_warning"
  | "incident"
  | "positive"
  | "negative"
  | "check_in"
  | "note"
  | "document_note";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  shift: "Shift",
  call_out: "Call out",
  attendance: "Attendance",
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  incident: "Incident",
  positive: "Positive",
  negative: "Negative",
  check_in: "Check-in",
  note: "Note",
  document_note: "Document note",
};

/** Exactly migration 035's check constraint — a value outside it fails insert. */
export const EVENT_KIND_OPTIONS: PickOption[] = [
  { value: "shift", label: "Shift", hint: "a rating for one shift", group: "Shift" },
  { value: "attendance", label: "Attendance", hint: "late, left early", group: "Attendance" },
  { value: "call_out", label: "Call out", hint: "did not work the shift", group: "Attendance" },
  { value: "verbal_warning", label: "Verbal warning", group: "Discipline" },
  { value: "written_warning", label: "Written warning", group: "Discipline" },
  { value: "incident", label: "Incident", hint: "an incident report", group: "Discipline" },
  { value: "positive", label: "Positive", hint: "a shout-out", group: "Notes" },
  { value: "negative", label: "Negative", group: "Notes" },
  { value: "check_in", label: "Check-in", group: "Notes" },
  { value: "note", label: "Note", group: "Notes" },
  { value: "document_note", label: "Document note", hint: "a filing recorded in FileMaker", group: "Notes" },
];

/**
 * The kinds the New-event dialog offers, which is NOT every kind.
 *
 * `shift` is out because a rating comes from the shift log, which is deferred —
 * typing one onto a record by hand would produce a shift event with no shift.
 * `document_note` is out because it is a HISTORICAL kind only: FMP used its
 * Events table as a filing cabinet (81 rows), and those rows carry metadata
 * with no file behind them. A new filing goes to `employee_documents`, which
 * has the bucket. See migration 035 §2 for why they could not be loaded there.
 *
 * Two exports rather than one because a FILTER must still be able to name every
 * kind — the asymmetry that hid `PACKAGE_DESC_OPTIONS`' missing GAL and QT for
 * four days was a vocabulary the picker could not offer while stored values
 * kept rendering.
 */
export const AD_HOC_EVENT_KINDS: EventKind[] = [
  "attendance",
  "call_out",
  "verbal_warning",
  "written_warning",
  "incident",
  "positive",
  "negative",
  "check_in",
  "note",
];

/**
 * A warning or an incident — an ACT somebody took, as against a fact that was
 * recorded. Attendance and call-outs are deliberately not disciplinary: being
 * absent is a fact, and being warned about it is the act.
 */
export function isDisciplinary(kind: string): boolean {
  return kind === "verbal_warning" || kind === "written_warning" || kind === "incident";
}

/* -- which shift ----------------------------------------------------------- */

export type ShiftSlot = "opening" | "mid" | "closing" | "off_site";

export const SHIFT_SLOT_LABEL: Record<ShiftSlot, string> = {
  opening: "Opening",
  mid: "Mid",
  closing: "Closing",
  off_site: "Off-site",
};

export const SHIFT_SLOT_OPTIONS: PickOption[] = [
  { value: "opening", label: "Opening" },
  { value: "mid", label: "Mid" },
  { value: "closing", label: "Closing" },
  { value: "off_site", label: "Off-site", hint: "an event, not a shop" },
];

/**
 * The shift report's own `Shift` label → a slot. THIS is the authority.
 *
 * Measured over all 44,251 ratings joined to their report (2026-08-06):
 * Opening 23,718 · Closing 20,027 · Off-site 481 · Mid 19 · Manager 3.
 *
 * `Manager` is three rows in eight years and is a ROLE rather than a shift, so
 * it resolves to null and survives in `source_payload` like every other raw
 * value. Off-site is a real slot — 481 ratings — and is the one the sort field
 * below cannot express at all.
 */
export function shiftSlotFromLabel(raw: string | null | undefined): ShiftSlot | null {
  switch (String(raw ?? "").trim().toLowerCase().replace(/[^a-z]+/g, "")) {
    case "opening":
      return "opening";
    case "mid":
      return "mid";
    case "closing":
      return "closing";
    case "offsite":
      return "off_site";
    default:
      return null;
  }
}

/**
 * FMP's `cShift_sortfield` → a slot, for a rating whose shift report cannot be
 * found. A FALLBACK: the label above is richer and covers 100% of the rows.
 *
 * The two agree exactly where both exist — 23,718 Opening on sort 1, 20,027
 * Closing on sort 3, 19 Mid on sort 2 — and the 487 rows with no sort field at
 * all are precisely the Off-site and Manager ones, which is why this cannot be
 * the primary reader.
 */
export function shiftSlotFromSortField(raw: string | number | null | undefined): ShiftSlot | null {
  const v = String(raw ?? "").trim();
  if (v === "1") return "opening";
  if (v === "2") return "mid";
  if (v === "3") return "closing";
  return null;
}

/* -- FileMaker's vocabulary → ours ----------------------------------------- */

/**
 * Both sources' type strings, normalised. Keys are lowercased with every run of
 * non-alphanumerics collapsed to one space, so "Check-In", "check in" and
 * "CHECK_IN" are one key.
 *
 * The three merge pairs are the ones `migration/field-map.md` names: the
 * vocabulary drifted over twelve years and Negative/Negative Event,
 * Positive/Positive Event and Incident/Incident Report are the same thing
 * entered twice.
 *
 * `daily rating` is Ratings' own `event_type`, which reads "daily_rating" on
 * every one of its 44,251 rows — so one function covers both files.
 */
const FMP_EVENT_TYPE: Record<string, EventKind> = {
  "daily rating": "shift",
  attendance: "attendance",
  "call out": "call_out",
  negative: "negative",
  "negative event": "negative",
  positive: "positive",
  "positive event": "positive",
  incident: "incident",
  "incident report": "incident",
  "verbal warning": "verbal_warning",
  "written warning": "written_warning",
  neutral: "note",
  "check in": "check_in",
  document: "document_note",
};

/** The lookup key: lowercase, non-alphanumeric runs collapsed to one space. */
function typeKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * THROWS on anything it does not recognise, including blank.
 *
 * The allow-list posture every transform here takes: `transform-hr.mjs` refuses
 * to guess a missing column rather than loading 445 people with no addresses,
 * and a silently-unmapped event type would put a decade of write-ups under a
 * bucket nobody looks at. The caller reports and skips; it does not fall
 * through to "note".
 */
export function normalizeEventKind(raw: string | null | undefined): EventKind {
  const key = typeKey(String(raw ?? ""));
  const kind = FMP_EVENT_TYPE[key];
  if (!kind) {
    throw new Error(
      `Unrecognised FileMaker event type ${JSON.stringify(String(raw ?? ""))}. ` +
        `Add it to FMP_EVENT_TYPE in lib/employeeEvents.ts, or skip the row deliberately.`,
    );
  }
  return kind;
}

/* -- the score ------------------------------------------------------------- */

/**
 * A score is 0–5, and **zero is a real score** — measured, not assumed.
 *
 * FMP stored five category scores and a `score_TOTAL` that is their ROUNDED
 * mean (it agrees with the rounded mean on 40,618 of 40,793 rows but with the
 * exact mean on only 33,545 — [4,5,5,4,5] is 4.6 and was stored as "5"). Since
 * we hold all five, we compute the true mean to 2dp and get better history than
 * FileMaker ever had.
 *
 * Two conventions in that data, both settled against `score_TOTAL` rather than
 * by argument (2026-08-06):
 *
 *   "n/a" is EXCLUDED from the mean — the mean over the remaining categories
 *   matches the stored total on 15,427 rows and differs on one.
 *
 *   0 is INCLUDED, because it means something. Of the 132 rows carrying a zero,
 *   the stored total says it was counted on 107 and excluded on 10. And the 65
 *   rows where all five are zero read "NO CALL/NO SHOW" and "Called out 5
 *   minutes after she was supposed to start her shift" — a zero is a supervisor
 *   marking a write-off, not a box they failed to tick.
 *
 * That is why 035's constraint is `between 0 and 5`. Refusing zero would refuse
 * real history halfway through a batch.
 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 5;

export function averageScore(values: readonly (string | number | null | undefined)[]): number | null {
  const nums: number[] = [];
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s === "" || s.toLowerCase() === "n/a") continue;
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    nums.push(n);
  }
  if (nums.length === 0) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(mean * 100) / 100;
}

/* -- reading an event ------------------------------------------------------ */

export type EventText = {
  headline: string | null;
  detail: string | null;
  outcome: string | null;
};

/**
 * The one line a table cell shows.
 *
 * FMP had three text fields and they are not interchangeable: `EventSummary` is
 * the headline (2,374 of 2,398 rows), `EventDetail` elaborates on it (1,188,
 * of which only TWO have no summary), and `EventAction` is what was DONE
 * ("Documented", "Terminated"). The fallback chain exists for those two rows
 * and for the ~22 that carry none of the three, so no screen re-derives it.
 */
export function eventSummaryLine(e: EventText): string | null {
  return e.headline?.trim() || e.detail?.trim() || e.outcome?.trim() || null;
}

/* -- how someone is doing -------------------------------------------------- */

export type ScoredEvent = {
  kind: string;
  occurred_on: string;
  score: number | null;
};

export type RatingSummary = {
  /** Shifts in the window carrying a score. */
  shifts: number;
  /** Their mean to 2dp, or null when none was scored. */
  mean: number | null;
  /** The most recent shift event in the window, scored or not. */
  last: string | null;
};

/** How far back the record screen looks by default. */
export const RATING_WINDOW_DAYS = 90;

/**
 * A person's recent shift ratings.
 *
 * A WINDOW, never a lifetime. FMP had a `cRatingSummary` calculation and
 * `migration/field-map.md` dropped it; a lifetime mean over eight years of
 * 89%-fives is a constant that says nothing about anybody, where "4.87 over 23
 * shifts" is a fact about them now.
 *
 * The window is `days` calendar days ENDING TODAY inclusive, so a 90-day window
 * starts 89 days back. Events after `today` are ignored — a shift rating dated
 * in the future is a typo, and letting one in would make "last" wrong.
 */
export function ratingSummary(
  events: readonly ScoredEvent[],
  opts: { today: string; days?: number },
): RatingSummary {
  const days = opts.days ?? RATING_WINDOW_DAYS;
  const from = daysBefore(opts.today, days - 1);

  let last: string | null = null;
  const scores: number[] = [];

  for (const e of events) {
    if (e.kind !== "shift") continue;
    if (e.occurred_on < from || e.occurred_on > opts.today) continue;
    if (last === null || e.occurred_on > last) last = e.occurred_on;
    if (e.score !== null && e.score !== undefined) scores.push(e.score);
  }

  const mean =
    scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;

  return { shifts: scores.length, mean, last };
}
