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
  | "menu_plan"
  | "entries"
  | "orders_paid"
  | "orders_unpaid"
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
  // The WORKING shop's production plan, as a banner across the top of each
  // week it is in force (Mark, 2026-10-10).
  { key: "menu_plan", label: "Menu plan" },
  { key: "entries", label: "Notes and blackouts" },
  // TWO LAYERS, split on the one status that means the money is in (Mark,
  // 2026-10-10): `status = 'order'` is paid, and a lead, a quote or an invoice
  // is not yet. Neither shows a cancelled order, a template or a standing
  // order's parent.
  { key: "orders_paid", label: "Paid special orders" },
  { key: "orders_unpaid", label: "Unpaid special orders" },
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
  /** Said BEFORE the time, with a colon — an order's kitchen: "DF01: 9 AM …". */
  lead?: string | null;
  /** Where a tap goes. An entry has none — it opens its own dialog. */
  href?: string | null;
  /** The shops it is about. EMPTY means it is not about a shop in particular. */
  locationIds: string[];
  /** A typed entry with a switch on. Drawn filled, and leads its day. */
  blackout?: boolean;
  /** The `calendar_entries` row behind an `entries` item. */
  entryId?: string;
  /**
   * Set on each day's item of something that covers MORE THAN ONE DAY: what
   * joins the days (`key`) and the thing's own first and last day, which may
   * lie outside the days on screen. `weekLayout` draws these as one bar.
   */
  span?: { key: string; from: string; to: string };
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
        span:
          entry.starts_on === entry.ends_on
            ? undefined
            : { key: `entry:${entry.id}`, from: entry.starts_on, to: entry.ends_on },
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
  menu_plan: -1,
  entries: 0,
  orders_paid: 1,
  orders_unpaid: 1,
  deliveries: 2,
  tasks: 3,
  pay_periods: 4,
  hr: 5,
  hr_events: 6,
  feeds: 7,
};

/** The menu plan first, then blackouts, then by layer, time of day, title. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
  const plan = Number(b.layer === "menu_plan") - Number(a.layer === "menu_plan");
  if (plan !== 0) return plan;
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

/* -- one week, laid out ---------------------------------------------------- */

/** One thing drawn in a week: a chip in one day, or a bar across several. */
export type WeekBar = {
  item: CalendarItem;
  /** 0–6, the day of the week it starts on IN THIS WEEK. */
  col: number;
  /** How many of this week's days it covers. */
  days: number;
  /** 0 is the top line under the day numbers. */
  lane: number;
  /** It began before this week / runs on past it — that end is drawn open. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * Where everything in one week goes (Mark, 2026-10-10: "for events that span
 * multiple days, make them one continuous banner instead of multiple chips").
 *
 * A multi-day thing arrives as one item per day (`span` says they are one);
 * here each run of them inside the week becomes ONE bar. Every bar is then
 * given a LANE — a line shared by the whole week — so a bar sits at the same
 * height on every day it crosses and the single-day chips fill in around it.
 *
 * ORDER OF PLACEMENT is what makes it read like a calendar: bars before chips,
 * longer before shorter, earlier before later, a blackout before anything of
 * its length — and each takes the highest lane free on ALL its days. The chips
 * then keep the order `itemsByDay` gave their day.
 *
 * `capacity` is how many lanes a week has room for. If the week needs more, the
 * LAST lane is given up to "+N more" on every day that has something hidden,
 * and `more[col]` is that N. A bar that does not fit is hidden whole, and is
 * counted on each of its days.
 */
export function weekLayout(
  week: readonly string[],
  days: ReadonlyMap<string, readonly CalendarItem[]>,
  capacity: number,
): { bars: WeekBar[]; more: number[] } {
  type Pending = Omit<WeekBar, "lane"> & { order: number };
  const pending: Pending[] = [];
  const open = new Map<string, Pending>();
  let order = 0;

  week.forEach((date, col) => {
    const seen = new Set<string>();
    for (const item of days.get(date) ?? []) {
      const key = item.span?.key;
      if (key) {
        seen.add(key);
        const running = open.get(key);
        if (running) {
          running.days += 1;
          continue;
        }
      }
      const bar: Pending = {
        item,
        col,
        days: 1,
        continuesBefore: item.span ? item.span.from < week[0] : false,
        continuesAfter: item.span ? item.span.to > week[week.length - 1] : false,
        order: order++,
      };
      pending.push(bar);
      if (key) open.set(key, bar);
    }
    // A run ends on the first day its key is absent (a filter can do that).
    for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
  });

  const isBar = (p: Pending) => Boolean(p.item.span);
  // The menu plan is the week's HEADING: its banner takes the top lane whatever
  // else is on, even a closure that runs the whole week.
  const isPlan = (p: Pending) => p.item.layer === "menu_plan";
  pending.sort(
    (a, b) =>
      Number(isPlan(b)) - Number(isPlan(a)) ||
      Number(isBar(b)) - Number(isBar(a)) ||
      (isBar(a) ? b.days - a.days || a.col - b.col : 0) ||
      (isBar(a) ? Number(b.item.blackout ?? false) - Number(a.item.blackout ?? false) : 0) ||
      a.order - b.order,
  );

  // taken[lane][col]
  const taken: boolean[][] = [];
  const placed: WeekBar[] = pending.map((p) => {
    let lane = 0;
    for (;;) {
      const row = (taken[lane] ??= new Array<boolean>(week.length).fill(false));
      let free = true;
      for (let c = p.col; c < p.col + p.days; c += 1) if (row[c]) free = false;
      if (free) {
        for (let c = p.col; c < p.col + p.days; c += 1) row[c] = true;
        break;
      }
      lane += 1;
    }
    return { item: p.item, col: p.col, days: p.days, lane, continuesBefore: p.continuesBefore, continuesAfter: p.continuesAfter };
  });

  const more = new Array<number>(week.length).fill(0);
  const lanes = Math.max(1, capacity);
  if (taken.length <= lanes) return { bars: placed, more };

  // Too many: the last lane becomes the "+N more" line.
  const visible = placed.filter((b) => b.lane < lanes - 1);
  for (const b of placed) {
    if (b.lane < lanes - 1) continue;
    for (let c = b.col; c < b.col + b.days; c += 1) more[c] += 1;
  }
  return { bars: visible, more };
}

/** "2:30 PM" from `14:30` or `14:30:00`. */
export function clockTime(time: string): string {
  const hour = Number(time.slice(0, 2));
  const minute = time.slice(3, 5);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute === "00" ? "" : `:${minute}`} ${hour < 12 ? "AM" : "PM"}`;
}

/* -- the menu plan ------------------------------------------------------- */

export type CalendarPlanRow = {
  id: string;
  title: string;
  starts_on: string;
  /** Null is open-ended: in force until another plan replaces it. */
  ends_on: string | null;
};

/**
 * A production plan as a banner over the days it is in force.
 *
 * One item per day, joined by `span`, so `weekLayout` draws one bar per week
 * and cuts it square where the plan carries on — exactly a multi-day entry's
 * shape. An open-ended plan runs to the end of whatever is on screen and is
 * marked as continuing past it.
 *
 * NOT ABOUT A SHOP as far as the shop filter goes (`locationIds` is empty): it
 * is the WORKING shop's plan by definition, and narrowing the calendar to
 * another shop's orders should not take the week's heading away.
 */
export function planItems(plans: readonly CalendarPlanRow[], range: DateRange): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const plan of plans) {
    const end = plan.ends_on ?? "9999-12-31";
    const from = plan.starts_on > range.from ? plan.starts_on : range.from;
    const to = end < range.to ? end : range.to;
    for (let day = from; day <= to; day = daysAfter(day, 1)) {
      items.push({
        key: `plan:${plan.id}:${day}`,
        layer: "menu_plan",
        date: day,
        title: plan.title,
        detail: plan.ends_on
          ? `Menu plan · ${formatRange({ from: plan.starts_on, to: plan.ends_on })}`
          : `Menu plan · from ${formatRange({ from: plan.starts_on, to: plan.starts_on })}`,
        href: `/plans/${plan.id}`,
        locationIds: [],
        // Always a span, even a one-day plan: it is a banner, not a chip.
        span: { key: `plan:${plan.id}`, from: plan.starts_on, to: end },
      });
    }
  }
  return items;
}

/* -- layers from what the app already knows ------------------------------ */
// Each builder takes the rows its query returned (`lib/calendarQueries`) and
// says them as items. Kept apart from the fetching so the wording — which is
// all a calendar cell is — can be pinned by a fixture.

/** `HH:MM`, or null for no time — and midnight is no time. */
function realTime(time: string | null | undefined): string | null {
  return time && !time.startsWith("00:00") ? time.slice(0, 5) : null;
}

function shops(...ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export type CalendarOrderRow = {
  id: string;
  number: string;
  /** `lead | quote | invoice | order` — cancelled ones are never fetched. */
  status: string | null;
  title: string | null;
  event_date: string;
  event_time: string | null;
  /** When the kitchen has to have it done — the time the calendar shows. */
  ready_by_time: string | null;
  fulfillment: string | null;
  location_id: string | null;
  kitchen_location_id: string | null;
  /** The kitchen's code — "DF01". */
  kitchen_code: string | null;
  /** "Company (Person)", already composed — `specialOrders.customerLabel`. */
  customer: string | null;
};

/**
 * A special order on its event date, as the KITCHEN reads it (Mark,
 * 2026-10-10: "<kitchen>: <ready time> <title>") — "DF01: 9 AM Office party".
 * A day made from a standing order is an order like any other and reads the
 * same way.
 *
 * The time is `ready_by_time`, when it has to be done, not the event's own
 * time, which is in the day panel's second line with the number and customer.
 * An order with no title falls back to its customer, then its number.
 *
 * PAID IS `status = 'order'` and nothing else. The status is what a person set
 * when the money arrived and is what gates production, so the calendar reads it
 * rather than re-deriving a balance; an invoice half paid is still unpaid here.
 */
export function specialOrderItems(rows: readonly CalendarOrderRow[]): CalendarItem[] {
  return rows.map((o) => ({
    key: `order:${o.id}`,
    layer: o.status === "order" ? "orders_paid" : "orders_unpaid",
    date: o.event_date,
    lead: o.kitchen_code,
    // Midnight is how an order with no real time was stored (the FileMaker
    // history is full of them): no time, not a 12 AM appointment. The feed
    // function (185) makes the same call.
    time: realTime(o.ready_by_time),
    title: o.title?.trim() || o.customer || o.number,
    detail:
      [
        o.number,
        o.customer,
        o.fulfillment === "delivery" ? "Delivery" : "Pickup",
        realTime(o.event_time) ? `event at ${clockTime(realTime(o.event_time)!)}` : null,
      ]
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
  /** The receiving shop's code — "DF01". */
  location_code: string | null;
};

/**
 * A purchase order on the day it is due in: "Chefs Warehouse (DF01)" (Mark,
 * 2026-10-10). The vendor and the shop it is coming to; the chip's colour is
 * what says it is a delivery.
 */
export function deliveryItems(rows: readonly CalendarDeliveryRow[]): CalendarItem[] {
  return rows.map((po) => ({
    key: `po:${po.id}`,
    layer: "deliveries",
    date: po.delivery_date,
    title: `${po.vendor ?? "Vendor"}${po.location_code ? ` (${po.location_code})` : ""}`,
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
