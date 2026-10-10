// A CALENDAR ENTRY, and the four things one can switch off (migration 181).
//
// Pure, so it runs in the fixture harness. A note or an event is an entry with
// no switch on; a BLACKOUT is the same entry with one or more on, and the
// switches are independent (Mark, 2026-10-09: "let's keep production, standing
// orders, and special orders separate").
//
// `blackoutFor` is the TypeScript twin of SQL's `blackout_name` (181). The SQL
// is what refuses an inquiry and skips a generate; this is what the screens
// read to say so beforehand. Keep the two in step.
//
// Every date is an ISO `YYYY-MM-DD` string and is compared as a string, the
// same discipline as `lib/dateRange`.

import { daysAfter } from "./today";

export type BlackoutEffect = "special_orders" | "standing_orders" | "production" | "closed";

export type BlackoutColumn =
  | "no_special_orders"
  | "no_standing_orders"
  | "no_production"
  | "shop_closed";

export type CalendarEntry = {
  id: string;
  title: string;
  /** Inclusive on both ends, and `starts_on <= ends_on` (a check constraint). */
  starts_on: string;
  ends_on: string;
  /** EMPTY MEANS EVERY SHOP — `ui/PickSet`'s convention. */
  location_ids: string[];
  no_special_orders: boolean;
  no_standing_orders: boolean;
  no_production: boolean;
  shop_closed: boolean;
  note: string | null;
  /** A palette key (`lib/calendarColors`, migration 188), or null/absent for
   *  the layer's colour. Ignored on a blackout. */
  color?: string | null;
};

/** The columns every reader selects. */
export const CALENDAR_ENTRY_SELECT =
  "id, title, starts_on, ends_on, location_ids, no_special_orders, no_standing_orders, no_production, shop_closed, note, color";

/**
 * The four switches, in the order the screens show them. `label` reads as what
 * the entry STOPS, because the switch being on is the unusual state.
 */
export const BLACKOUT_SWITCHES: readonly {
  effect: BlackoutEffect;
  column: BlackoutColumn;
  label: string;
}[] = [
  { effect: "special_orders", column: "no_special_orders", label: "No special orders" },
  { effect: "standing_orders", column: "no_standing_orders", label: "No standing orders" },
  { effect: "production", column: "no_production", label: "No production" },
  { effect: "closed", column: "shop_closed", label: "Shop closed" },
];

const COLUMN_OF: Record<BlackoutEffect, BlackoutColumn> = {
  special_orders: "no_special_orders",
  standing_orders: "no_standing_orders",
  production: "no_production",
  closed: "shop_closed",
};

type Switches = Pick<CalendarEntry, BlackoutColumn>;
type Dated = Pick<CalendarEntry, "starts_on" | "ends_on">;
type Scoped = Pick<CalendarEntry, "location_ids">;

/** Does this entry switch anything off? A note does not. */
export function isBlackout(entry: Switches): boolean {
  return (
    entry.no_special_orders || entry.no_standing_orders || entry.no_production || entry.shop_closed
  );
}

/** What this entry stops, as the switches' own labels. */
export function blackoutLabels(entry: Switches): string[] {
  return BLACKOUT_SWITCHES.filter((s) => entry[s.column]).map((s) => s.label);
}

export function entryCoversDate(entry: Dated, iso: string): boolean {
  return iso >= entry.starts_on && iso <= entry.ends_on;
}

/**
 * Is the entry about any of these shops?
 *
 * An entry for every shop (empty `location_ids`) always is. Otherwise it must
 * name one of them — so with NO shop in hand (`[]`, or only nulls) only an
 * every-shop entry applies, which is the /inquiry form before the customer has
 * chosen where to collect.
 */
export function entryAppliesTo(
  entry: Scoped,
  locationIds: readonly (string | null | undefined)[],
): boolean {
  if (entry.location_ids.length === 0) return true;
  return locationIds.some((id) => id != null && entry.location_ids.includes(id));
}

/**
 * The first entry that covers `date` at any of `locationIds`, or null.
 *
 * "First" is by start date, as `blackout_name` orders it, so the screen and
 * the database name the same entry when two overlap.
 */
export function coveringEntry<T extends Dated & Scoped>(
  entries: readonly T[],
  date: string,
  locationIds: readonly (string | null | undefined)[],
): T | null {
  let found: T | null = null;
  for (const entry of entries) {
    if (!entryCoversDate(entry, date)) continue;
    if (!entryAppliesTo(entry, locationIds)) continue;
    if (!found || entry.starts_on < found.starts_on) found = entry;
  }
  return found;
}

/**
 * The blackout that switches `effect` off on `date` at any of `locationIds`.
 *
 * Pass every shop the thing touches: an order's pickup shop AND its kitchen, a
 * schedule's selling shop AND its kitchen. Nulls are ignored.
 */
export function blackoutFor<T extends CalendarEntry>(
  entries: readonly T[],
  ask: {
    date: string | null | undefined;
    locationIds: readonly (string | null | undefined)[];
    effect: BlackoutEffect;
  },
): T | null {
  if (!ask.date) return null;
  const column = COLUMN_OF[ask.effect];
  return coveringEntry(
    entries.filter((e) => e[column]),
    ask.date,
    ask.locationIds,
  );
}

/**
 * Every date in `range` on which `locationId` is closed.
 *
 * Clamped to the range before it is walked, so an entry that runs for a year
 * costs only the days asked about.
 */
export function closedDates(
  entries: readonly CalendarEntry[],
  locationId: string,
  range: { from: string; to: string },
): Set<string> {
  const closed = new Set<string>();
  for (const entry of entries) {
    if (!entry.shop_closed) continue;
    if (!entryAppliesTo(entry, [locationId])) continue;
    const from = entry.starts_on > range.from ? entry.starts_on : range.from;
    const to = entry.ends_on < range.to ? entry.ends_on : range.to;
    for (let day = from; day <= to; day = daysAfter(day, 1)) closed.add(day);
  }
  return closed;
}

/* -- wording ------------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 25" — no year, for a sentence about a date that is on screen already. */
export function monthDay(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** "Dec 25", "Nov 26–27", or "Dec 31 – Jan 1" across a month end. */
export function entryDates(entry: Dated): string {
  if (entry.starts_on === entry.ends_on) return monthDay(entry.starts_on);
  if (entry.starts_on.slice(0, 7) === entry.ends_on.slice(0, 7)) {
    return `${monthDay(entry.starts_on)}–${Number(entry.ends_on.slice(8, 10))}`;
  }
  return `${monthDay(entry.starts_on)} – ${monthDay(entry.ends_on)}`;
}

/**
 * Which shops an entry is about, as codes: "Every shop", "DF01", "DF01 and
 * DF02". A shop the lookup doesn't know is left out rather than drawn as an id.
 */
export function entryShops(
  entry: Scoped,
  locations: readonly { id: string; code: string }[],
): string {
  if (entry.location_ids.length === 0) return "Every shop";
  const codes = locations.filter((l) => entry.location_ids.includes(l.id)).map((l) => l.code);
  if (codes.length === 0) return "Every shop";
  if (codes.length === 1) return codes[0];
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

const SENTENCE: Record<BlackoutEffect, string> = {
  special_orders: "No special orders",
  standing_orders: "No standing orders",
  production: "No production",
  closed: "Closed",
};

/**
 * One line for a warning: "No special orders on Dec 25 — Closed for Christmas
 * (DF01)". The shops are named only when the entry is not for every shop.
 */
export function blackoutSentence(
  entry: Pick<CalendarEntry, "title" | "location_ids">,
  effect: BlackoutEffect,
  date: string,
  locations: readonly { id: string; code: string }[],
): string {
  const where = entry.location_ids.length === 0 ? "" : ` (${entryShops(entry, locations)})`;
  return `${SENTENCE[effect]} on ${monthDay(date)} — ${entry.title}${where}`;
}
