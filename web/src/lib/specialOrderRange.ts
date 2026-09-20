/**
 * THE SPECIAL ORDER LIST'S DATE WINDOW (Mark, 2026-09-20: "convert the show
 * picklist to a rangepicker").
 *
 * "Show" had been a menu of five words — Needs Attention, Upcoming, Tomorrow,
 * Unpaid, Past — and the two that were not about TIME have gone to Status. What
 * is left is a date range, and the app already has a control for one, on five
 * other lists. So this is the vocabulary that control needs, plus the one token
 * that travels between the URL, the filter bar and the SERVER.
 *
 * ---------------------------------------------------------------------------
 * ONE TOKEN, BECAUSE THE WINDOW IS A SERVER FILTER
 * ---------------------------------------------------------------------------
 * `page.tsx` does not fetch every order — it fetches a window and says when it
 * is capped. That window has always been read off the `view` parameter, with a
 * comment warning that the server's idea of it and the filter's "must match —
 * a window that disagrees with the filter shows an empty list and blames the
 * filter for it". Keeping ONE string for both is how that stays true:
 * `orderRangeBounds` is what the query and the picker each resolve, so neither
 * can invent its own dates.
 *
 * The token is a PRESET KEY where the range is one of the presets on `today`,
 * and `from..to` where it is not — the PO list's rule in a single value rather
 * than three parameters, because this list's filters travel as one
 * `FilterValues` record. Stored by key, "Next Month" is still next month
 * tomorrow instead of freezing into the dates it happened to mean today.
 *
 * ---------------------------------------------------------------------------
 * TWO PRESETS ARE OPEN AT ONE END, AND SAY SO WITH A SENTINEL
 * ---------------------------------------------------------------------------
 * `DateRange` is a closed pair, and "Upcoming" and "Past" are not. They are
 * bounded here at 1900 and 2999 — dates no donut order will ever carry — which
 * keeps them ordinary ranges everywhere else: the calendar paints them, the
 * server compares them, and `matchingPreset` puts the WORD back on the face of
 * the control rather than two absurd dates.
 */

import {
  RANGE_PRESETS,
  inRange,
  matchingPreset,
  normalizeRange,
  type DateRange,
  type RangePreset,
} from "./dateRange";

/** Before FileMaker, before the shop. */
const DAWN = "1900-01-01";
/** After everything. */
const DUSK = "2999-12-31";

function daysAfter(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * THE BUTTONS DOWN THE RIGHT OF THE PICKER, in reading order.
 *
 * FORWARD FIRST, because this list is about work still to come — the old menu
 * rested on Upcoming and so does this. Past and All Time are last: they are the
 * two that widen the server's window, and they are what you reach for when you
 * are looking something up rather than working.
 *
 * "All Time" RETURNS NULL, which is what makes it the face of an unset value
 * rather than a range that happens to be enormous — `matchingPreset` matches
 * null to null, so the control reads "All Time" instead of "Any date".
 */
export const ORDER_RANGE_PRESETS: RangePreset[] = [
  { key: "upcoming", label: "Upcoming", range: (t) => ({ from: t, to: DUSK }) },
  RANGE_PRESETS.today,
  RANGE_PRESETS.tomorrow,
  RANGE_PRESETS.this_week,
  RANGE_PRESETS.next_week,
  RANGE_PRESETS.this_month,
  RANGE_PRESETS.next_month,
  { key: "past", label: "Past", range: (t) => ({ from: DAWN, to: daysAfter(t, -1) }) },
  { key: "all", label: "All Time", range: () => null },
];

/** The resting window, and the one the plain `/special-orders` shows. */
export const DEFAULT_ORDER_RANGE = "upcoming";

const CUSTOM = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/**
 * DIGIT-SHAPED IS NOT A DATE. `2024-13-45` matches the pattern and is not a
 * day, and this token is interpolated STRAIGHT INTO the PostgREST filter
 * (`event_date.gte.…`) — so a nonsense month in the address bar would come back
 * as a Postgres date-parse error in place of the whole list, rather than as the
 * list's resting view. Caught by a fixture, not by review.
 */
function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** A custom token's two dates, or null if it is not one. */
function customPair(raw: string): DateRange | null {
  const m = CUSTOM.exec(raw);
  if (!m || !isRealDate(m[1]) || !isRealDate(m[2])) return null;
  // Backwards is a range too — `normalizeRange`'s rule, because somebody
  // reaching for a window from its far end is not making a mistake.
  return normalizeRange(m[1], m[2]);
}

/** Is this a token this list understands? The filter bar's `accepts`. */
export function isOrderRangeToken(value: string): boolean {
  return ORDER_RANGE_PRESETS.some((p) => p.key === value) || customPair(value) !== null;
}

/**
 * The dates a token resolves to on `today`, or null for all time.
 *
 * THE SERVER AND THE PICKER BOTH READ THIS, which is the point — see the
 * header. An unreadable token resolves as the DEFAULT rather than as
 * everything: a typo in the address bar should land you where the plain list
 * does, not fetch twelve years.
 */
export function orderRangeBounds(token: string | null | undefined, today: string): DateRange | null {
  const raw = (token ?? "").trim();
  const custom = customPair(raw);
  if (custom) return custom;
  const preset =
    ORDER_RANGE_PRESETS.find((p) => p.key === raw) ??
    ORDER_RANGE_PRESETS.find((p) => p.key === DEFAULT_ORDER_RANGE)!;
  return preset.range(today);
}

/**
 * What the picker handed back, as a token: a pair that IS one of the presets on
 * `today` is stored by KEY (see the header), a pair that is none of them is
 * stored as itself, and a clear is all time.
 */
export function orderRangeToken(picked: DateRange | null, today: string): string {
  const preset = matchingPreset(picked, ORDER_RANGE_PRESETS, today);
  if (preset) return preset.key;
  return picked ? `${picked.from}..${picked.to}` : "all";
}

/**
 * Does this order's event date fall in the window?
 *
 * A RECORD WITH NO EVENT DATE — every template and every standing order — is
 * OUT of any range and IN all time. That is the rule the old menu had: those
 * two kinds have no single date, "so every date-based view would hide them.
 * They are reached through the KIND menu, and `all` shows them."
 */
export function inOrderRange(
  eventDate: string | null,
  bounds: DateRange | null
): boolean {
  if (bounds === null) return true;
  return !!eventDate && inRange(eventDate, bounds);
}
