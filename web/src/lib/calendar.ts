// THE CALENDAR'S ITEMS — one shape for everything `/calendar` draws.
//
// Pure, so it runs in the fixture harness. The page fetches each LAYER with its
// own query (`lib/calendarQueries`) and each is turned into `CalendarItem`s
// here; the month view then knows nothing about special orders or deliveries,
// only about items on days.
//
// A typed entry (`calendar_entries`, migration 181) can span days and is
// expanded to ONE ITEM PER DAY, so a day cell is a plain list and a week
// boundary needs no bar-drawing arithmetic. Everything else has one date.

import { monthGrid, monthStart, type DateRange } from "./dateRange";
import { daysAfter } from "./today";
import { isBlackout, type CalendarEntry } from "./blackoutDates";
import { formatRange } from "./dateRange";

export type CalendarLayer =
  | "entries"
  | "special_orders"
  | "deliveries"
  | "tasks"
  | "pay_periods"
  | "hr"
  | "hr_events"
  | "feeds";

/**
 * Layers that start HIDDEN and are switched on by whoever wants them. Employee
 * events are a record of what happened (a call-out, a warning) rather than
 * something coming up, so they are on the calendar for the person who asks and
 * out of everybody else's month.
 */
export const OPT_IN_LAYERS: readonly CalendarLayer[] = ["hr_events"];

/** In the order the layer menu lists them. */
export const CALENDAR_LAYERS: readonly { key: CalendarLayer; label: string }[] = [
  { key: "entries", label: "Notes and blackouts" },
  { key: "special_orders", label: "Special orders" },
  { key: "deliveries", label: "Deliveries" },
  { key: "tasks", label: "Tasks and maintenance" },
  { key: "pay_periods", label: "Pay periods" },
  { key: "hr", label: "HR expiries" },
  { key: "hr_events", label: "Employee events" },
  { key: "feeds", label: "Subscribed calendars" },
];

export type CalendarItem = {
  /** Unique on the page — a day's items are keyed by it. */
  key: string;
  layer: CalendarLayer;
  date: string;
  title: string;
  /** A second, quieter phrase: the vendor, the customer, the shop. */
  detail?: string | null;
  /** `HH:MM` when the thing has a time of day; sorts the day. */
  time?: string | null;
  /** Where a tap goes. An entry has none — it opens its own dialog. */
  href?: string | null;
  /** The shops it is about. EMPTY means it is not about a shop in particular. */
  locationIds: string[];
  /** A typed entry with a switch on. Drawn filled, and leads its day. */
  blackout?: boolean;
  /** The `calendar_entries` row behind an `entries` item. */
  entryId?: string;
};

/* -- the month on screen ------------------------------------------------- */

/** `?month=2026-12` (or a full date) → that month's first day; else today's. */
export function parseMonthParam(raw: string | null | undefined, today: string): string {
  if (raw && /^\d{4}-\d{2}(-\d{2})?$/.test(raw)) {
    const month = Number(raw.slice(5, 7));
    if (month >= 1 && month <= 12) return `${raw.slice(0, 7)}-01`;
  }
  return monthStart(today);
}

/** `2026-12-01` → `2026-12`, the value the URL carries. */
export function monthParam(monthIso: string): string {
  return monthIso.slice(0, 7);
}

/** The 42 days the month view draws — what every layer's query is bounded by. */
export function gridRange(monthIso: string): DateRange {
  const weeks = monthGrid(monthIso);
  return { from: weeks[0][0].iso, to: weeks[5][6].iso };
}

/* -- typed entries ------------------------------------------------------- */

/** One item per day an entry covers, clamped to `range`. */
export function entryItems(entries: readonly CalendarEntry[], range: DateRange): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const entry of entries) {
    const from = entry.starts_on > range.from ? entry.starts_on : range.from;
    const to = entry.ends_on < range.to ? entry.ends_on : range.to;
    for (let day = from; day <= to; day = daysAfter(day, 1)) {
      items.push({
        key: `entry:${entry.id}:${day}`,
        layer: "entries",
        date: day,
        title: entry.title,
        detail: entry.note,
        locationIds: entry.location_ids,
        blackout: isBlackout(entry),
        entryId: entry.id,
      });
    }
  }
  return items;
}

/* -- what is showing ----------------------------------------------------- */

/**
 * The items left after the layer menu and the shop filter.
 *
 * `shops` empty means every shop (`ui/PickSet`). An item that is not about a
 * shop in particular — a pay period, an every-shop entry — survives any shop
 * filter: hiding "Closed for Christmas" because you asked about DF01 would be
 * hiding the one thing true of DF01 that day.
 */
export function visibleItems(
  items: readonly CalendarItem[],
  show: { hiddenLayers: ReadonlySet<CalendarLayer>; shops: readonly string[] },
): CalendarItem[] {
  return items.filter((item) => {
    if (show.hiddenLayers.has(item.layer)) return false;
    if (show.shops.length === 0 || item.locationIds.length === 0) return true;
    return item.locationIds.some((id) => show.shops.includes(id));
  });
}

const LAYER_ORDER: Record<CalendarLayer, number> = {
  entries: 0,
  special_orders: 1,
  deliveries: 2,
  tasks: 3,
  pay_periods: 4,
  hr: 5,
  hr_events: 6,
  feeds: 7,
};

/** Blackouts lead, then by layer, then by time of day, then by title. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  const lead = Number(b.blackout ?? false) - Number(a.blackout ?? false);
  if (lead !== 0) return lead;
  const layer = LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer];
  if (layer !== 0) return layer;
  const time = (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
  if (time !== 0) return time;
  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

/** Each day's items, in the order a cell lists them. */
export function itemsByDay(items: readonly CalendarItem[]): Map<string, CalendarItem[]> {
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = days.get(item.date);
    if (list) list.push(item);
    else days.set(item.date, [item]);
  }
  for (const list of days.values()) list.sort(compareItems);
  return days;
}

/** "2:30 PM" from `14:30` or `14:30:00`. */
export function clockTime(time: string): string {
  const hour = Number(time.slice(0, 2));
  const minute = time.slice(3, 5);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute === "00" ? "" : `:${minute}`} ${hour < 12 ? "AM" : "PM"}`;
}

/* -- layers from what the app already knows ------------------------------ */
// Each builder takes the rows its query returned (`lib/calendarQueries`) and
// says them as items. Kept apart from the fetching so the wording — which is
// all a calendar cell is — can be pinned by a fixture.

function shops(...ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export type CalendarOrderRow = {
  id: string;
  number: string;
  title: string | null;
  event_date: string;
  event_time: string | null;
  fulfillment: string | null;
  location_id: string | null;
  kitchen_location_id: string | null;
  /** "Company (Person)", already composed — `specialOrders.customerLabel`. */
  customer: string | null;
};

/** A special order on its event date: "SO-10110 Cafe Knotted", at its time. */
export function specialOrderItems(rows: readonly CalendarOrderRow[]): CalendarItem[] {
  return rows.map((o) => ({
    key: `order:${o.id}`,
    layer: "special_orders",
    date: o.event_date,
    time: o.event_time ? o.event_time.slice(0, 5) : null,
    title: [o.number, o.customer || o.title].filter(Boolean).join(" "),
    detail:
      [o.customer ? o.title : null, o.fulfillment === "delivery" ? "Delivery" : "Pickup"]
        .filter(Boolean)
        .join(" · ") || null,
    href: `/special-orders/${o.id}`,
    locationIds: shops(o.location_id, o.kitchen_location_id),
  }));
}

export type CalendarDeliveryRow = {
  id: string;
  po_number: string | null;
  delivery_date: string;
  location_id: string | null;
  status: string;
  vendor: string | null;
};

/** A purchase order on the day it is due in: "Bakemark delivery". */
export function deliveryItems(rows: readonly CalendarDeliveryRow[]): CalendarItem[] {
  return rows.map((po) => ({
    key: `po:${po.id}`,
    layer: "deliveries",
    date: po.delivery_date,
    title: `${po.vendor ?? "Vendor"} delivery`,
    detail: [po.po_number ? `PO ${po.po_number}` : null, po.status].filter(Boolean).join(" · "),
    href: `/purchase-orders/${po.id}`,
    locationIds: shops(po.location_id),
  }));
}

export type CalendarTaskRow = {
  id: string;
  title: string;
  kind: string;
  due_on: string;
  location_id: string | null;
};

/** An open task or maintenance request on its due date. */
export function taskItems(rows: readonly CalendarTaskRow[]): CalendarItem[] {
  return rows.map((t) => ({
    key: `task:${t.id}`,
    layer: "tasks",
    date: t.due_on,
    title: t.title,
    detail: t.kind === "maintenance" ? "Maintenance due" : "Task due",
    // Neither has a record screen; the list is where it is acted on.
    href: t.kind === "maintenance" ? "/maintenance-requests" : "/tasks",
    locationIds: shops(t.location_id),
  }));
}

export type CalendarPayPeriodRow = { id: string; start_date: string; end_date: string };

/** A pay period on its LAST day — the day the timesheets have to be right. */
export function payPeriodItems(rows: readonly CalendarPayPeriodRow[]): CalendarItem[] {
  return rows.map((p) => ({
    key: `pay:${p.id}`,
    layer: "pay_periods",
    date: p.end_date,
    title: "Pay period ends",
    detail: formatRange({ from: p.start_date, to: p.end_date }),
    href: `/pay-periods/${p.id}`,
    locationIds: [],
  }));
}

export type CalendarExpiryRow = {
  /** Unique per row: the document's id, or the employee's for a food handler card. */
  id: string;
  employee_id: string;
  employee: string;
  /** What expires, in words — "I-9 documents", "Food handler card". */
  what: string;
  expires_on: string;
};

/** A document or a card on the day it runs out. */
export function expiryItems(rows: readonly CalendarExpiryRow[]): CalendarItem[] {
  return rows.map((r) => ({
    key: `expiry:${r.what}:${r.id}`,
    layer: "hr",
    date: r.expires_on,
    title: `${r.employee}: ${r.what} expires`,
    href: `/employees/${r.employee_id}`,
    locationIds: [],
  }));
}

export type CalendarEventRow = {
  id: string;
  employee_id: string;
  employee: string;
  /** The kind's label — "Call Out". */
  kind: string;
  occurred_on: string;
  summary: string | null;
  location_id: string | null;
};

/** An employee event on the day it happened. */
export function employeeEventItems(rows: readonly CalendarEventRow[]): CalendarItem[] {
  return rows.map((e) => ({
    key: `event:${e.id}`,
    layer: "hr_events",
    date: e.occurred_on,
    title: `${e.employee}: ${e.kind}`,
    detail: e.summary,
    href: `/employees/${e.employee_id}`,
    locationIds: shops(e.location_id),
  }));
}
