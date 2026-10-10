// `lib/calendar` — the month on screen, and what each layer says in a cell.
//
// Checked by BREAKING each rule: expanding an entry unclamped draws days off
// the grid; letting the shop filter hide an every-shop item hides "Closed for
// Christmas" from the one shop asked about; sorting without the blackout lead
// buries it under the day's orders; and a `parseMonthParam` that trusts its
// input turns `?month=2026-13` into an Invalid Date.

import { test, eq, ok } from "./harness";
import {
  clockTime,
  compareItems,
  deliveryItems,
  employeeEventItems,
  entryItems,
  expiryItems,
  gridRange,
  itemsByDay,
  monthParam,
  parseMonthParam,
  payPeriodItems,
  specialOrderItems,
  taskItems,
  visibleItems,
  type CalendarItem,
} from "../../src/lib/calendar";
import type { CalendarEntry } from "../../src/lib/blackoutDates";

function entry(patch: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: "e1",
    title: "Christmas",
    starts_on: "2026-12-25",
    ends_on: "2026-12-25",
    location_ids: [],
    no_special_orders: false,
    no_standing_orders: false,
    no_production: false,
    shop_closed: false,
    note: null,
    ...patch,
  };
}

function item(patch: Partial<CalendarItem>): CalendarItem {
  return { key: "k", layer: "orders_paid", date: "2026-12-25", title: "x", locationIds: [], ...patch };
}

/* -- the month ----------------------------------------------------------- */

test("parseMonthParam: a month, a full date, and everything else is today's month", () => {
  eq(parseMonthParam("2026-12", "2026-10-09"), "2026-12-01");
  eq(parseMonthParam("2026-12-25", "2026-10-09"), "2026-12-01");
  eq(parseMonthParam(undefined, "2026-10-09"), "2026-10-01");
  eq(parseMonthParam("2026-13", "2026-10-09"), "2026-10-01", "month 13");
  eq(parseMonthParam("2026-00", "2026-10-09"), "2026-10-01", "month 0");
  eq(parseMonthParam("december", "2026-10-09"), "2026-10-01");
  eq(monthParam("2026-12-01"), "2026-12");
});

test("gridRange is the 42 days the grid draws, Sunday first", () => {
  // December 2026 starts on a Tuesday: the grid opens on Sunday Nov 29.
  eq(gridRange("2026-12-01"), { from: "2026-11-29", to: "2027-01-09" });
});

/* -- entries ------------------------------------------------------------- */

test("an entry is one item per day, clamped to the days on screen", () => {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  const one = entryItems([entry({})], range);
  eq(one.map((i) => i.date), ["2026-12-25"]);
  eq(one[0].entryId, "e1");
  eq(one[0].blackout, false);

  const span = entryItems([entry({ starts_on: "2026-12-24", ends_on: "2026-12-26", shop_closed: true })], range);
  eq(span.map((i) => i.date), ["2026-12-24", "2026-12-25", "2026-12-26"]);
  ok(span.every((i) => i.blackout));
  eq(new Set(span.map((i) => i.key)).size, 3, "a key per day");

  const long = entryItems([entry({ starts_on: "2026-01-01", ends_on: "2027-12-31" })], range);
  eq(long.length, 42);
  eq(long[0].date, "2026-11-29");
});

/* -- filtering and order ------------------------------------------------- */

test("the shop filter keeps what is not about a shop in particular", () => {
  const items = [
    item({ key: "all", locationIds: [] }),
    item({ key: "df01", locationIds: ["df01"] }),
    item({ key: "df02", locationIds: ["df02"] }),
    item({ key: "both", locationIds: ["df02", "df01"] }),
  ];
  const none = new Set<never>();
  eq(visibleItems(items, { hiddenLayers: none, shops: [] }).length, 4, "no filter");
  eq(
    visibleItems(items, { hiddenLayers: none, shops: ["df01"] }).map((i) => i.key),
    ["all", "df01", "both"],
  );
});

test("a hidden layer is gone whatever the shop filter says", () => {
  const items = [item({ key: "o" }), item({ key: "d", layer: "deliveries" })];
  eq(
    visibleItems(items, { hiddenLayers: new Set(["deliveries"] as const), shops: [] }).map((i) => i.key),
    ["o"],
  );
});

test("a day reads: blackouts, then entries, then each layer by time", () => {
  const day = [
    item({ key: "late", time: "15:00", title: "B" }),
    item({ key: "early", time: "09:00", title: "Z" }),
    item({ key: "untimed", title: "A" }),
    item({ key: "po", layer: "deliveries", title: "Bakemark delivery" }),
    item({ key: "note", layer: "entries", title: "Inspector" }),
    item({ key: "closed", layer: "entries", title: "Christmas", blackout: true }),
  ];
  eq(
    [...day].sort(compareItems).map((i) => i.key),
    ["closed", "note", "early", "late", "untimed", "po"],
  );
  eq(itemsByDay(day).get("2026-12-25")?.[0].key, "closed");
});

/* -- what each layer says ------------------------------------------------ */

test("special order: number and customer, its time, both its shops", () => {
  const [o] = specialOrderItems([
    {
      id: "o1",
      number: "SO-10110",
      status: "order",
      title: "Office party",
      event_date: "2026-12-18",
      event_time: "14:30:00",
      fulfillment: "delivery",
      location_id: null,
      kitchen_location_id: "df01",
      customer: "Acme (Pat Lee)",
    },
  ]);
  eq(o.title, "SO-10110 Acme (Pat Lee)");
  eq(o.layer, "orders_paid", "status order is paid");
  eq(o.detail, "Office party · Delivery");
  eq(o.time, "14:30");
  eq(o.href, "/special-orders/o1");
  eq(o.locationIds, ["df01"]);
});

test("special order with no customer falls back to its title, said once", () => {
  const [o] = specialOrderItems([
    {
      id: "o2",
      number: "SO-2",
      status: "quote",
      title: "Walk-in dozen",
      event_date: "2026-12-18",
      event_time: null,
      fulfillment: "pickup",
      location_id: "df02",
      kitchen_location_id: "df02",
      customer: null,
    },
  ]);
  eq(o.title, "SO-2 Walk-in dozen");
  eq(o.layer, "orders_unpaid", "a quote is not paid");
  eq(o.time, null);
  eq(
    specialOrderItems([{ ...({ id: "o3", number: "SO-3", status: "lead", title: null, event_date: "2026-12-18", fulfillment: "pickup", location_id: null, kitchen_location_id: null, customer: null }), event_time: "00:00:00" }])[0].time,
    null,
    "midnight is no time",
  );
  eq(o.detail, "Pickup");
  eq(o.locationIds, ["df02"], "one shop, not the same one twice");
});

test("delivery, task, pay period, expiry and event each say what they are", () => {
  eq(
    deliveryItems([
      { id: "p", po_number: "DF01-0042", delivery_date: "2026-12-14", location_id: "df01", status: "sent", vendor: "Chefs Warehouse", location_code: "DF01" },
    ])[0],
    {
      key: "po:p",
      layer: "deliveries",
      date: "2026-12-14",
      title: "Chefs Warehouse (DF01)",
      detail: "PO DF01-0042 · sent",
      href: "/purchase-orders/p",
      locationIds: ["df01"],
    },
  );
  const [task, fix] = taskItems([
    { id: "t", title: "Descale the kettle", kind: "task", due_on: "2026-12-15", location_id: "df01" },
    { id: "m", title: "Walk-in door seal", kind: "maintenance", due_on: "2026-12-15", location_id: "df01" },
  ]);
  eq(task.href, "/tasks");
  eq(fix.href, "/maintenance-requests");
  eq(fix.detail, "Maintenance due");

  const [pay] = payPeriodItems([{ id: "pp", start_date: "2026-12-07", end_date: "2026-12-20" }]);
  eq(pay.date, "2026-12-20", "on its LAST day");
  eq(pay.title, "Pay period ends");
  eq(pay.locationIds, []);

  eq(
    expiryItems([
      { id: "d", employee_id: "e", employee: "Prentice, Ada", what: "Food handler card", expires_on: "2026-12-31" },
    ])[0].title,
    "Prentice, Ada: Food handler card expires",
  );
  const [ev] = employeeEventItems([
    { id: "v", employee_id: "e", employee: "Prentice, Ada", kind: "Call Out", occurred_on: "2026-12-03", summary: "Flu", location_id: null },
  ]);
  eq(ev.layer, "hr_events");
  eq(ev.title, "Prentice, Ada: Call Out");
  eq(ev.href, "/employees/e");
});

test("clockTime: 12-hour, minutes only when there are some", () => {
  eq(clockTime("09:00"), "9 AM");
  eq(clockTime("14:30:00"), "2:30 PM");
  eq(clockTime("00:15"), "12:15 AM");
  eq(clockTime("12:00"), "12 PM");
});

test("paid is status 'order' and nothing else", () => {
  const base = { id: "x", number: "SO-9", title: null, event_date: "2026-12-18", event_time: null, fulfillment: "pickup", location_id: null, kitchen_location_id: null, customer: null };
  const layerOf = (status: string | null) => specialOrderItems([{ ...base, status }])[0].layer;
  eq(layerOf("order"), "orders_paid");
  for (const status of ["lead", "quote", "invoice", null]) eq(layerOf(status), "orders_unpaid", String(status));
});
