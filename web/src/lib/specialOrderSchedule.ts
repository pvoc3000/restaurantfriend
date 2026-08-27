/**
 * Turning a special order's items into a night's production schedule lines.
 *
 * Decision 9's arithmetic, and the reason it lives in TypeScript rather than in
 * the SQL that commits it: the cut normalisation below is real logic over dirty
 * twelve-year-old data, it already exists and is fixture-tested in
 * `specialOrderLines`, and writing a second copy of it in PL/pgSQL would be
 * 016's `nextDeliveryDate` trap on a document a kitchen bakes from. So this is
 * 029's `freeze_pay_period` shape — the client computes the payload and
 * `schedule_special_order` VALIDATES and commits it. That function does not
 * trust what it is handed; see migration 068's header for what it re-checks.
 *
 * ---------------------------------------------------------------------------
 * ONE LINE PER (ITEM, CUT), NOT PER ITEM
 * ---------------------------------------------------------------------------
 * `production_items` holds ONE generic `Letter` subtype — 56 rows, one per
 * flavour — and no per-character item, so every letter of a name resolves to
 * the same production item. Order #7769 spells HAPPY BIRTHDAY VINNY in 18 lines
 * that all point at `Rites of Sprinkles - Choc`; grouped by item alone that
 * reads "18 x Rites of Sprinkles - Letter" and the decorator does not know
 * which letters to cut.
 *
 * Measured over the live data: 943 of the 3,133 orders carrying linked lines
 * (30.1%) have two lines sharing a production item, and roughly three in four of
 * those collisions are DIFFERENT letters rather than duplicates. So the cut is
 * the discriminator, and migration 067 moves the schedule's unique key onto it.
 *
 * Repeated letters within one word SUM — "HAPPY" is one line of 2 for P — which
 * is what makes the group key (item, cut) rather than the order line.
 */

import { isProductionLine, unschedulableLines } from "./specialOrders";
import { cutLetter, isLetterCut, letterCut } from "./specialOrderLines";

/** A line, reduced to what scheduling needs. Structural, like `MoneyLine`. */
export type SchedulableLine = {
  name: string;
  production_item_id: string | null;
  item_type?: string | null;
  item_cut?: string | null;
  item_finish?: string | null;
  item_size?: string | null;
  qty?: number | null;
};

/**
 * One `production_schedule_items` row, before it exists.
 *
 * The snapshot comes from the ORDER LINE and never from the catalog item —
 * decision 5's "editable COPIES", and it is what puts the customer's actual
 * letter on the decorator's sheet rather than the menu's generic `Letter`.
 */
export type ScheduleDraftLine = {
  /** `production_items.id`. NOT NULL on the schedule line, hence `blocked`. */
  item_id: string;
  item_name: string;
  item_type: string | null;
  /** The CANONICAL cut. Migration 067 keys the schedule line on this. */
  subtype: string | null;
  finish: string | null;
  size: string | null;
  /** Sum of qty over the lines that grouped here. */
  par: number;
  /**
   * How many ORDER lines merged into this one.
   *
   * Only the first line's name survives a merge, so a group of two that were
   * customised differently keeps one of the two names. The dialog shows this
   * count so the merge is visible before it is committed rather than
   * discovered on the schedule afterwards.
   */
  sources: number;
  sort: number;
};

export type ScheduleDraft = {
  lines: ScheduleDraftLine[];
  /** Production lines with no `production_item_id` — NAMED, never silent. */
  blocked: SchedulableLine[];
  /** `Misc*` lines, skipped without comment: they were never production. */
  skippedMisc: number;
  /** Sum of par, for the dialog's "118 donuts". */
  total: number;
};

/**
 * The cut a line groups under.
 *
 * Letters go through `cutLetter` then `letterCut`, because the export holds 93
 * letter-ish spellings for what is really 40-odd characters: `Letter - "A"`
 * (1,170 rows), `Letter "A"` (17, no dash), `Letter. "A"` (1), lowercase
 * `Letter - "y"`, a stray `Letter - U"` and one escape-mangled `Letter - ""Y""`.
 * Two spellings of one letter must be ONE line of two donuts, not two lines of
 * one — and the canonical form is what the sheet then prints.
 *
 * A bare `Letter` with no character is a real state (935 rows: somebody has
 * ordered letters and nobody has settled the word yet), so it stays its own
 * group rather than being folded into any character.
 *
 * Everything else is trimmed and used as it stands. It is deliberately NOT
 * normalised further — two spellings of `Promise Ring` are both somebody's
 * deliberate typing, and collapsing them would be guessing where the letter
 * case is a measurement.
 */
export function canonicalCut(cut: string | null | undefined): string | null {
  const raw = (cut ?? "").trim();
  if (raw === "") return null;
  if (!isLetterCut(raw)) return raw;
  const character = cutLetter(raw);
  return character === null ? "Letter" : letterCut(character);
}

/** `#9885 · Fay wedding`, and just the number when an order has no name. */
export function scheduleTitle(number: string, title: string | null | undefined): string {
  const name = (title ?? "").trim();
  return name === "" ? `#${number}` : `#${number} · ${name}`;
}

/**
 * The whole payload, from an order's lines.
 *
 * Three populations out of one list, which is why this returns a record rather
 * than an array: what gets made, what CANNOT be made and must be said out loud,
 * and what was never production and is not worth mentioning.
 */
export function scheduleDraft<T extends SchedulableLine>(lines: T[]): {
  lines: ScheduleDraftLine[];
  blocked: T[];
  skippedMisc: number;
  total: number;
} {
  let skippedMisc = 0;
  const groups = new Map<string, ScheduleDraftLine>();

  for (const line of lines) {
    if (!isProductionLine(line)) {
      skippedMisc += 1;
      continue;
    }
    // Reported through `blocked` rather than dropped — the whole point of
    // `unschedulableLines` is that the app names these instead of shrugging.
    if (!line.production_item_id) continue;

    const subtype = canonicalCut(line.item_cut);
    const key = `${line.production_item_id} ${subtype ?? ""}`;
    const qty = Number(line.qty ?? 0);

    const existing = groups.get(key);
    if (existing) {
      existing.par += qty;
      existing.sources += 1;
      continue;
    }
    groups.set(key, {
      item_id: line.production_item_id,
      item_name: line.name,
      item_type: line.item_type ?? null,
      subtype,
      finish: line.item_finish ?? null,
      size: line.item_size ?? null,
      par: qty,
      sources: 1,
      sort: 0,
    });
  }

  // A group summing to nothing is not a thing to make, and `par > 0` is 068's
  // own check, so dropping them here keeps the payload one the function accepts.
  // Three real lines carry a NEGATIVE qty (a credit for a short delivery), and
  // they must not reach a kitchen sheet either.
  const kept = [...groups.values()].filter((l) => l.par > 0);

  kept.sort(
    (a, b) =>
      a.item_name.localeCompare(b.item_name) ||
      (a.subtype ?? "").localeCompare(b.subtype ?? "")
  );
  kept.forEach((line, i) => {
    line.sort = i + 1;
  });

  return {
    lines: kept,
    blocked: unschedulableLines(lines),
    skippedMisc,
    total: kept.reduce((sum, l) => sum + l.par, 0),
  };
}
