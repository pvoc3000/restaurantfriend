// The calendar's reads. Each layer is one query bounded by the days on screen;
// `lib/calendar` turns the rows into items.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CALENDAR_ENTRY_SELECT, type CalendarEntry } from "./blackoutDates";
import type { DateRange } from "./dateRange";
import {
  deliveryItems,
  employeeEventItems,
  expiryItems,
  payPeriodItems,
  planItems,
  specialOrderItems,
  taskItems,
  type CalendarItem,
  type CalendarLayer,
} from "./calendar";
import { customerLabel } from "./specialOrders";
import { OPEN_TASK_STATUSES } from "./facilityTasks";
import { DOCUMENT_KIND_LABEL, type DocumentKind } from "./employeeDocuments";
import { EVENT_KIND_LABEL, eventSummaryLine, type EventKind } from "./employeeEvents";
import { employeeName } from "./employees";
import { subscriptionIsStale, type CalendarSubscription } from "./calendarFeeds";

type Row = Record<string, unknown>;

function toEntry(r: Row): CalendarEntry {
  return {
    id: r.id as string,
    title: r.title as string,
    starts_on: r.starts_on as string,
    ends_on: r.ends_on as string,
    location_ids: (r.location_ids ?? []) as string[],
    no_special_orders: Boolean(r.no_special_orders),
    no_standing_orders: Boolean(r.no_standing_orders),
    no_production: Boolean(r.no_production),
    shop_closed: Boolean(r.shop_closed),
    note: (r.note ?? null) as string | null,
    color: (r.color ?? null) as string | null,
  };
}

/**
 * The typed entries that touch `from`…`to`, either end optional.
 *
 * An entry OVERLAPS the window when it ends on or after `from` and starts on or
 * before `to` — not "starts inside it", which would lose a two-week closure
 * that began last month. Ordered, as every read here is, so the first entry to
 * cover a day is the same one `blackout_name` (181) names.
 */
export async function fetchEntries(
  supabase: SupabaseClient,
  window: { from?: string | null; to?: string | null } = {},
): Promise<{ entries: CalendarEntry[]; error: string | null }> {
  let query = supabase.from("calendar_entries").select(CALENDAR_ENTRY_SELECT);
  if (window.from) query = query.gte("ends_on", window.from);
  if (window.to) query = query.lte("starts_on", window.to);
  const { data, error } = await query.order("starts_on").order("created_at").limit(1000);
  if (error) return { entries: [], error: error.message };
  return { entries: ((data ?? []) as Row[]).map(toEntry), error: null };
}

/* -- the layers ---------------------------------------------------------- */

/**
 * Every layer in `layers`, for the days in `range`, as items.
 *
 * ONE QUERY PER LAYER, all at once, each bounded by the 42 days on screen and
 * each ORDERED — PostgREST stops at 1,000 rows without a word, and a month of
 * any of these is a small fraction of that. A layer that fails is reported by
 * name and the others still draw: a calendar with no deliveries on it is more
 * use than no calendar.
 *
 * WHICH layers to ask for is the caller's decision (`lib/pageAccess`); RLS is
 * what actually refuses a row.
 */
export async function fetchLayerItems(
  supabase: SupabaseClient,
  layers: readonly CalendarLayer[],
  range: DateRange,
  /** Every shop, closed ones included, to say a code beside a delivery and a
   *  kitchen before an order. */
  locations: readonly { id: string; code: string }[] = [],
  /** The shop being worked at — whose menu plan the `menu_plan` layer shows. */
  workingLocationId: string | null = null,
): Promise<{ items: CalendarItem[]; failed: { layer: CalendarLayer; message: string }[] }> {
  const want = (layer: CalendarLayer) => layers.includes(layer);
  const failed: { layer: CalendarLayer; message: string }[] = [];
  const items: CalendarItem[] = [];
  const hr = want("hr") || want("hr_events");
  const orderLayers = want("orders_paid") || want("orders_unpaid") || want("standing_orders");

  const [plans, orders, pos, tasks, periods, employees, documents, events] = await Promise.all([
    want("menu_plan") && workingLocationId
      ? supabase
          .from("production_plans")
          .select("id, title, starts_on, ends_on")
          .eq("location_id", workingLocationId)
          // In force means ACTIVE: an inactive plan is a draft or a retired
          // one, and neither is what the shop is making.
          .eq("is_active", true)
          .lte("starts_on", range.to)
          .or(`ends_on.is.null,ends_on.gte.${range.from}`)
          .order("starts_on")
          .order("id")
      : null,
    orderLayers
      ? supabase
          .from("special_orders")
          .select(
            "id, number, status, standing_order_id, title, event_date, event_time, ready_by_time, fulfillment, location_id, kitchen_location_id, customers ( first_name, last_name, company )",
          )
          // A real order only: a template has no date, and a standing order's
          // DAYS are their own rows — the parent would draw its start date as
          // if something were due on it.
          .eq("kind", "order")
          .neq("status", "cancelled")
          .gte("event_date", range.from)
          .lte("event_date", range.to)
          .order("event_date")
          .order("id")
          .limit(1000)
      : null,
    want("deliveries")
      ? supabase
          .from("purchase_orders")
          .select("id, po_number, delivery_date, location_id, status, vendors ( name )")
          .neq("status", "void")
          .gte("delivery_date", range.from)
          .lte("delivery_date", range.to)
          .order("delivery_date")
          .order("id")
          .limit(1000)
      : null,
    want("tasks")
      ? supabase
          .from("location_tasks")
          .select("id, title, kind, due_on, location_id")
          .in("status", OPEN_TASK_STATUSES)
          .gte("due_on", range.from)
          .lte("due_on", range.to)
          .order("due_on")
          .order("id")
          .limit(1000)
      : null,
    want("pay_periods")
      ? supabase
          .from("pay_periods")
          .select("id, start_date, end_date")
          .gte("end_date", range.from)
          .lte("end_date", range.to)
          .order("end_date")
      : null,
    // Names for both HR layers, and the food handler dates. Every employee,
    // former ones included: an event in this month may be about somebody who
    // has since left. 445 rows; ordered so the cap, if it is ever met, is met
    // the same way twice.
    hr
      ? supabase
          .from("employees")
          .select("id, first_name, last_name, status, food_handler_expires")
          .order("id")
          .limit(1000)
      : null,
    want("hr")
      ? supabase
          .from("employee_documents")
          .select("id, employee_id, kind, expires_on")
          .gte("expires_on", range.from)
          .lte("expires_on", range.to)
          .order("expires_on")
          .order("id")
          .limit(1000)
      : null,
    want("hr_events")
      ? supabase
          .from("employee_events")
          .select("id, employee_id, occurred_on, kind, headline, detail, outcome, location_id")
          // Not the shift ratings — 44,000 of the 46,000 rows, several a day,
          // and a calendar of them is the Events screen done worse.
          .neq("kind", "shift")
          .gte("occurred_on", range.from)
          .lte("occurred_on", range.to)
          .order("occurred_on")
          .order("id")
          .limit(1000)
      : null,
  ]);

  const rows = <T,>(layer: CalendarLayer, result: { data: unknown; error: { message: string } | null } | null): T[] => {
    if (!result) return [];
    if (result.error) {
      failed.push({ layer, message: result.error.message });
      return [];
    }
    return (result.data ?? []) as T[];
  };

  items.push(
    ...planItems(
      rows<Row>("menu_plan", plans).map((p) => ({
        id: p.id as string,
        title: (p.title ?? "Menu plan") as string,
        starts_on: p.starts_on as string,
        ends_on: (p.ends_on ?? null) as string | null,
      })),
      range,
    ),
    ...specialOrderItems(
      rows<Row>("orders_unpaid", orders).map((o) => ({
        id: o.id as string,
        number: o.number as string,
        status: (o.status ?? null) as string | null,
        from_standing: Boolean(o.standing_order_id),
        title: (o.title ?? null) as string | null,
        event_date: o.event_date as string,
        event_time: (o.event_time ?? null) as string | null,
        ready_by_time: (o.ready_by_time ?? null) as string | null,
        kitchen_code: locations.find((l) => l.id === o.kitchen_location_id)?.code ?? null,
        fulfillment: (o.fulfillment ?? null) as string | null,
        location_id: (o.location_id ?? null) as string | null,
        kitchen_location_id: (o.kitchen_location_id ?? null) as string | null,
        customer: o.customers ? customerLabel(one(o.customers)) : null,
      })),
    ),
    ...deliveryItems(
      rows<Row>("deliveries", pos).map((po) => ({
        id: po.id as string,
        po_number: (po.po_number ?? null) as string | null,
        delivery_date: po.delivery_date as string,
        location_id: (po.location_id ?? null) as string | null,
        status: po.status as string,
        vendor: (one<{ name?: string }>(po.vendors)?.name ?? null) as string | null,
        location_code: locations.find((l) => l.id === po.location_id)?.code ?? null,
      })),
    ),
    ...taskItems(
      rows<Row>("tasks", tasks).map((t) => ({
        id: t.id as string,
        title: t.title as string,
        kind: t.kind as string,
        due_on: t.due_on as string,
        location_id: (t.location_id ?? null) as string | null,
      })),
    ),
    ...payPeriodItems(
      rows<Row>("pay_periods", periods).map((p) => ({
        id: p.id as string,
        start_date: p.start_date as string,
        end_date: p.end_date as string,
      })),
    ),
  );

  if (hr) {
    const people = rows<Row>(want("hr") ? "hr" : "hr_events", employees);
    const nameOf = new Map(
      people.map((e) => [
        e.id as string,
        employeeName({ first_name: e.first_name as string, last_name: e.last_name as string }),
      ]),
    );
    if (want("hr")) {
      // A card only matters while the person works here; a former employee's
      // lapsed food handler card is not something anybody has to act on.
      const cards = people
        .filter((e) => e.status !== "inactive" && typeof e.food_handler_expires === "string")
        .filter((e) => (e.food_handler_expires as string) >= range.from && (e.food_handler_expires as string) <= range.to)
        .map((e) => ({
          id: e.id as string,
          employee_id: e.id as string,
          employee: nameOf.get(e.id as string) ?? "Employee",
          what: "Food handler card",
          expires_on: e.food_handler_expires as string,
        }));
      const current = new Set(people.filter((e) => e.status !== "inactive").map((e) => e.id as string));
      const docs = rows<Row>("hr", documents)
        .filter((d) => current.has(d.employee_id as string))
        .map((d) => ({
          id: d.id as string,
          employee_id: d.employee_id as string,
          employee: nameOf.get(d.employee_id as string) ?? "Employee",
          what: DOCUMENT_KIND_LABEL[d.kind as DocumentKind] ?? "Document",
          expires_on: d.expires_on as string,
        }));
      items.push(...expiryItems([...cards, ...docs]));
    }
    if (want("hr_events")) {
      items.push(
        ...employeeEventItems(
          rows<Row>("hr_events", events).map((e) => ({
            id: e.id as string,
            employee_id: e.employee_id as string,
            employee: nameOf.get(e.employee_id as string) ?? "Employee",
            kind: EVENT_KIND_LABEL[e.kind as EventKind] ?? (e.kind as string),
            occurred_on: e.occurred_on as string,
            summary: eventSummaryLine({
              headline: (e.headline ?? null) as string | null,
              detail: (e.detail ?? null) as string | null,
              outcome: (e.outcome ?? null) as string | null,
            }),
            location_id: (e.location_id ?? null) as string | null,
          })),
        ),
      );
    }
  }

  return { items, failed };
}

/** PostgREST hands an embedded to-one back as an object, or as a one-row array
 *  when it cannot tell the cardinality. Either way, the one. */
function one<T = Record<string, unknown>>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

/**
 * The subscriptions due a read, as of NOW. Here rather than in the page so the
 * clock is read in one named place, the way `todayInTimeZone` reads it — a
 * server component calling `Date.now()` inline is what the purity lint is for.
 */
export function staleSubscriptionIds(subscriptions: readonly CalendarSubscription[]): string[] {
  const now = Date.now();
  return subscriptions.filter((sub) => subscriptionIsStale(sub, now)).map((sub) => sub.id);
}
