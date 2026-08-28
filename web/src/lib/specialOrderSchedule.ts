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
 * ONE ORDER LINE, ONE SCHEDULE LINE. NOTHING IS ROLLED UP
 * ---------------------------------------------------------------------------
 * Mark, 2026-08-27: "don't consolidate lines, even if they result in the same
 * donut. Keep each line intact, and be sure to copy the notes column."
 *
 * This function DID group on (production item, cut) and sum the quantities, and
 * the first real order showed why that was wrong. #7769's two Mini lines are 50
 * with a note reading "chocolate glaze" and 50 reading "vanilla glaze" — same
 * menu item, same cut, same size, and not the same thing to make. Rolled up
 * they printed as one line of 100 and the decorator was never told half were
 * chocolate.
 *
 * No key over the taxonomy could have fixed that, because the distinguishing
 * fact is in a free-text NOTE. That is the whole argument for transcribing
 * rather than summarising: the order already says what to make, at the grain
 * somebody typed it, and any grain we impose on top of it can only lose
 * something.
 *
 * Migration 069 makes the schedule's unique key partial so it can be true —
 * HAPPY has two P's, and two lines of one letter are two donuts.
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
  /** Free text from the order line. The kitchen reads this one. */
  notes?: string | null;
  /** The order's own line order, which on a letter order spells the word. */
  sort?: number | null;
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
  par: number;
  /**
   * The ORDER LINE's note, carried through to `production_schedule_items.note`.
   *
   * This is the field that made rolling up untenable, and it is the field the
   * decorator actually works from — "chocolate glaze" is not decoration on the
   * record, it is the instruction.
   */
  note: string | null;
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
 *
 * Since nothing groups any more this no longer decides which lines merge — it
 * decides only what the kitchen SHEET says, and one spelling across the page
 * beats a faithful copy of twelve years of typing. Reverting to the raw cut is
 * one line if that is ever wanted.
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
  const kept: ScheduleDraftLine[] = [];

  for (const line of lines) {
    if (!isProductionLine(line)) {
      skippedMisc += 1;
      continue;
    }
    // Reported through `blocked` rather than dropped — the whole point of
    // `unschedulableLines` is that the app names these instead of shrugging.
    if (!line.production_item_id) continue;

    // A line asking for nothing is not a thing to make, and `par > 0` is 069's
    // own check, so dropping it here keeps the payload one the function
    // accepts. Three real lines carry a NEGATIVE qty — a credit for a short
    // delivery — and those must not reach a kitchen sheet either.
    const par = Number(line.qty ?? 0);
    if (!(par > 0)) continue;

    kept.push({
      item_id: line.production_item_id,
      item_name: line.name,
      item_type: line.item_type ?? null,
      subtype: canonicalCut(line.item_cut),
      finish: line.item_finish ?? null,
      size: line.item_size ?? null,
      par,
      note: (line.notes ?? "").trim() || null,
      sort: 0,
    });
  }

  // THE ORDER'S OWN SEQUENCE, not alphabetical. On a letter order the line
  // order IS the word — #7769's eighteen letters spell HAPPY BIRTHDAY VINNY —
  // so sorting by name would shuffle it into A, B, D, H, H, ... and hand the
  // decorator an anagram. Ties keep the order they arrived in, which is the
  // order the caller read them in.
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

/* ==========================================================================
 * WHICH ORDERS A GENERATION SHOULD OFFER
 * ========================================================================== */

/** What the generate dialog needs to judge an order, and nothing more. */
export type PullCandidate = {
  id: string;
  number: string;
  title: string | null;
  kind: string;
  status: string | null;
  event_date: string | null;
  flag_reason: string | null;
  kitchen_location_id: string | null;
  location_id: string | null;
  production_schedule_id: string | null;
};

export type PullReadiness =
  /** Offer it, ticked. */
  | { state: "ready" }
  /** Offer it, UNTICKED, saying why — the PO generator's under-minimum vendor. */
  | { state: "hold"; reason: string }
  /** Do not offer it. Counted in a sentence so the omission is legible. */
  | { state: "not_ready"; reason: string };

/**
 * Where this order would be MADE — the same coalesce `schedule_special_order`
 * applies, since a schedule's two location columns are NOT NULL and an order's
 * are both nullable.
 */
export function scheduleKitchen(o: {
  kitchen_location_id: string | null;
  location_id: string | null;
}): string | null {
  return o.kitchen_location_id ?? o.location_id ?? null;
}

/**
 * Is this order READY FOR PRODUCTION? (Mark, 2026-08-27, asking that only those
 * be offered when generating a night.)
 *
 * READY IS `status = 'order'`, AND THAT IS A MEASUREMENT RATHER THAN A TASTE.
 * Of the eleven upcoming orders on 2026-08-27, the two Mark had scheduled by
 * hand were both `order` and both paid; of the eight he had not, SIX WERE STILL
 * QUOTES — four without even a returned quote — one was an unpaid invoice, and
 * exactly one was a committed order. So the rung the module already calls
 * "paid — printing and scheduling remain" is the rung he schedules at, and
 * offering a quote would ask a kitchen to make donuts nobody has agreed to buy.
 * It is also the app's own sequencing: `suggestedTodo` at `order` runs Print
 * Order, then Schedule Production, then Send Receipt.
 *
 * A FLAGGED order is offered but NOT TICKED, with its flag as the reason —
 * migration 013's dialog does exactly this for a vendor under its minimum
 * ("unchecked-but-checkable"). A flag at this rung is an unresolved problem,
 * which is a reason to look before making 200 donuts and not a reason to
 * refuse.
 *
 * Everything else is withheld and COUNTED, never silently absent: an order that
 * simply does not appear is indistinguishable from one the query missed.
 */
export function pullReadiness(
  order: PullCandidate,
  schedulableLines: number,
  statusLabel: (s: string) => string = (s) => s
): PullReadiness {
  if (order.kind !== "order") return { state: "not_ready", reason: "not an order" };
  if (order.status === "cancelled") return { state: "not_ready", reason: "cancelled" };
  if (order.production_schedule_id) return { state: "not_ready", reason: "already scheduled" };
  if (!order.event_date) return { state: "not_ready", reason: "no date" };
  if (schedulableLines === 0) return { state: "not_ready", reason: "nothing to make" };
  if (scheduleKitchen(order) === null) return { state: "not_ready", reason: "no shop" };
  if (order.status !== "order") {
    return { state: "not_ready", reason: `still a ${statusLabel(order.status ?? "")}` };
  }
  if (order.flag_reason) return { state: "hold", reason: order.flag_reason };
  return { state: "ready" };
}

/**
 * Is this order in the run's window and one of its kitchens?
 *
 * The dialog picks shops that SELL, while a special order's schedule is made at
 * its KITCHEN — so the test is the kitchen, not the pickup shop. Generating
 * DF01 brings along the wedding DF01 is baking, wherever it is collected.
 *
 * Dates compare as STRINGS, never through `new Date` (UTC midnight, and the
 * range's ends move west of Greenwich).
 */
export function inGenerationRun(
  order: PullCandidate,
  from: string,
  to: string,
  shopIds: ReadonlySet<string>
): boolean {
  const kitchen = scheduleKitchen(order);
  if (kitchen === null || !shopIds.has(kitchen)) return false;
  const on = order.event_date;
  return on !== null && on >= from && on <= to;
}
