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
  dayAgenda,
  longDate,
  parseDateParam,
  deliveryItems,
  employeeEventItems,
  entryItems,
  expiryItems,
  gridRange,
  itemsByDay,
  monthParam,
  parseMonthParam,
  payPeriodItems,
  planItems,
  specialOrderItems,
  taskItems,
  visibleItems,
  weekLayout,
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

const ORDER = {
  id: "o1",
  number: "SO-10110",
  status: "order",
  title: "Office party",
  event_date: "2026-12-18",
  event_time: "14:30:00",
  ready_by_time: "12:30:00",
  fulfillment: "delivery",
  location_id: null,
  kitchen_location_id: "df01",
  kitchen_code: "DF01",
  customer: "Acme (Pat Lee)",
};

test("special order: kitchen, READY time, title; the rest on the second line", () => {
  const [o] = specialOrderItems([ORDER]);
  eq(o.lead, "DF01");
  eq(o.time, "12:30", "the ready time, not the event's");
  eq(o.title, "Office party");
  eq(o.detail, "SO-10110 · Acme (Pat Lee) · Delivery · event at 2:30 PM");
  eq(o.layer, "orders_paid", "status order is paid");
  eq(o.href, "/special-orders/o1");
  eq(o.locationIds, ["df01"]);
});

test("special order: no title falls back to the customer, then the number", () => {
  eq(specialOrderItems([{ ...ORDER, title: " " }])[0].title, "Acme (Pat Lee)");
  eq(specialOrderItems([{ ...ORDER, title: null, customer: null }])[0].title, "SO-10110");
});

test("special order: a quote is unpaid, midnight is no time, one shop is said once", () => {
  const [o] = specialOrderItems([
    { ...ORDER, status: "quote", ready_by_time: "00:00:00", event_time: null, fulfillment: "pickup", location_id: "df01", customer: null },
  ]);
  eq(o.layer, "orders_unpaid");
  eq(o.time, null);
  eq(o.detail, "SO-10110 · Pickup");
  eq(o.locationIds, ["df01"]);
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
  const layerOf = (status: string | null) => specialOrderItems([{ ...ORDER, status }])[0].layer;
  eq(layerOf("order"), "orders_paid");
  for (const status of ["lead", "quote", "invoice", null]) eq(layerOf(status), "orders_unpaid", String(status));
});

/* -- one week, laid out -------------------------------------------------- */
// Checked by BREAKING: without the merge a three-day closure is three chips;
// placing chips before bars lets Monday's order push the bar down on Monday
// only, so it cannot be drawn straight; and counting a hidden bar once instead
// of on each of its days under-reports "+N more" on all but one of them.

// The week of Sunday 2026-12-20.
const WEEK = ["2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26"];

function layout(entries: CalendarEntry[], extra: CalendarItem[] = [], capacity = 6) {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  return weekLayout(WEEK, itemsByDay([...entryItems(entries, range), ...extra]), capacity);
}
const shape = (bars: ReturnType<typeof weekLayout>["bars"]) =>
  bars.map((b) => `${b.item.title}@${b.col}+${b.days} lane${b.lane}${b.continuesBefore ? " <" : ""}${b.continuesAfter ? " >" : ""}`);

test("a multi-day entry is ONE bar across its days", () => {
  const { bars } = layout([entry({ title: "Closed", starts_on: "2026-12-24", ends_on: "2026-12-26", shop_closed: true })]);
  eq(shape(bars), ["Closed@4+3 lane0"]);
});

test("a bar that began last week or runs into the next is open at that end", () => {
  eq(
    shape(layout([entry({ title: "Trip", starts_on: "2026-12-18", ends_on: "2026-12-21" })]).bars),
    ["Trip@0+2 lane0 <"],
  );
  eq(
    shape(layout([entry({ title: "Trip", starts_on: "2026-12-25", ends_on: "2026-12-29" })]).bars),
    ["Trip@5+2 lane0 >"],
  );
  eq(
    shape(layout([entry({ title: "Trip", starts_on: "2026-12-01", ends_on: "2027-01-05" })]).bars),
    ["Trip@0+7 lane0 < >"],
  );
});

test("bars take the top lanes and keep one lane the whole way; chips fill in under", () => {
  const { bars } = layout(
    [
      entry({ id: "a", title: "Closed", starts_on: "2026-12-24", ends_on: "2026-12-25", shop_closed: true }),
      entry({ id: "b", title: "Note", starts_on: "2026-12-21", ends_on: "2026-12-21" }),
    ],
    [
      item({ key: "o1", title: "Order A", date: "2026-12-24" }),
      item({ key: "o2", title: "Order B", date: "2026-12-25" }),
      item({ key: "o3", title: "Order C", date: "2026-12-21" }),
    ],
  );
  eq(shape(bars).sort(), [
    "Closed@4+2 lane0",
    "Note@1+1 lane0",
    "Order A@4+1 lane1",
    "Order B@5+1 lane1",
    "Order C@1+1 lane1",
  ]);
});

test("two overlapping bars get a lane each, the longer one on top", () => {
  const { bars } = layout([
    entry({ id: "short", title: "Short", starts_on: "2026-12-22", ends_on: "2026-12-23" }),
    entry({ id: "long", title: "Long", starts_on: "2026-12-21", ends_on: "2026-12-25" }),
  ]);
  eq(shape(bars).sort(), ["Long@1+5 lane0", "Short@2+2 lane1"]);
});

test("too many for the week: the last lane becomes +N more, counted on every day", () => {
  const busy = [1, 2, 3, 4].map((n) => item({ key: `o${n}`, title: `Order ${n}`, date: "2026-12-24" }));
  const closed = entry({ title: "Closed", starts_on: "2026-12-24", ends_on: "2026-12-25", shop_closed: true });
  // Five lanes wanted on the 24th, three available: two shown, one line of "+3".
  const { bars, more } = layout([closed], busy, 3);
  eq(shape(bars).sort(), ["Closed@4+2 lane0", "Order 1@4+1 lane1"]);
  eq(more, [0, 0, 0, 0, 3, 0, 0]);
  // With room for all five, nothing is hidden.
  eq(layout([closed], busy, 5).more, [0, 0, 0, 0, 0, 0, 0]);
  eq(layout([closed], busy, 5).bars.length, 5);
});

test("a hidden bar is counted on each day it covers", () => {
  const spans = ["a", "b", "c"].map((id) =>
    entry({ id, title: id, starts_on: "2026-12-21", ends_on: "2026-12-22" }),
  );
  const { bars, more } = layout(spans, [], 2);
  eq(bars.length, 1);
  eq(more, [0, 2, 2, 0, 0, 0, 0]);
});

/* -- the menu plan ------------------------------------------------------- */
// Checked by BREAKING: without the plan-first sort a week-long closure takes
// the top lane and the plan's banner drops under it; and treating a null
// `ends_on` as the plan's start draws an open-ended plan on one day.

test("a plan is a banner per week, cut square where it carries on", () => {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  const plans = planItems([{ id: "p", title: "Holiday 2026", starts_on: "2026-12-22", ends_on: "2026-12-31" }], range);
  eq(plans.length, 10);
  eq(plans[0].href, "/plans/p");
  eq(plans[0].lead, "Menu", "drawn as \"Menu: Holiday 2026\"");
  eq(shape(weekLayout(WEEK, itemsByDay(plans), 6).bars), ["Holiday 2026@2+5 lane0 >"]);
});

test("an open-ended plan runs to the end of the screen and on past it", () => {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  const plans = planItems([{ id: "p", title: "Winter", starts_on: "2026-12-01", ends_on: null }], range);
  eq(plans[plans.length - 1].date, "2027-01-09");
  eq(shape(weekLayout(WEEK, itemsByDay(plans), 6).bars), ["Winter@0+7 lane0 < >"]);
});

test("the plan's banner is the top of the week, over a closure and over chips", () => {
  const range = { from: "2026-11-29", to: "2027-01-09" };
  const all = [
    ...entryItems([entry({ title: "Closed", starts_on: "2026-12-01", ends_on: "2027-01-05", shop_closed: true })], range),
    ...planItems([{ id: "p", title: "Holiday 2026", starts_on: "2026-12-22", ends_on: "2026-12-31" }], range),
    item({ key: "o", title: "Order", date: "2026-12-20" }),
  ];
  eq(shape(weekLayout(WEEK, itemsByDay(all), 6).bars).sort(), [
    "Closed@0+7 lane1 < >",
    "Holiday 2026@2+5 lane0 >",
    "Order@0+1 lane0",
  ]);
});

/* -- one day, in full ---------------------------------------------------- */
// Checked by BREAKING: leaving a blackout in `allDay` says it twice; sorting
// `timed` by layer first puts a 2 PM paid order above a 9 AM unpaid one; and a
// `parseDateParam` without the round trip accepts February 31st.

test("a day is banners, then what has no time, then what has one — by time", () => {
  const { banners, allDay, timed } = dayAgenda([
    item({ key: "late-paid", layer: "orders_paid", time: "14:00", title: "Paid at 2" }),
    item({ key: "early-unpaid", layer: "orders_unpaid", time: "09:00", title: "Unpaid at 9" }),
    item({ key: "feed", layer: "feeds", time: "11:30", title: "Dentist" }),
    item({ key: "po", layer: "deliveries", title: "Bakemark (DF01)" }),
    item({ key: "note", layer: "entries", title: "Inspector" }),
    item({ key: "closed", layer: "entries", title: "Christmas", blackout: true }),
    item({ key: "plan", layer: "menu_plan", title: "Holiday 2026" }),
  ]);
  eq(banners.map((i) => i.key), ["plan", "closed"]);
  eq(allDay.map((i) => i.key), ["note", "po"]);
  eq(timed.map((i) => i.key), ["early-unpaid", "feed", "late-paid"]);
});

test("longDate and parseDateParam", () => {
  eq(longDate("2026-12-25"), "Friday, December 25, 2026");
  eq(longDate("2026-09-30"), "Wednesday, September 30, 2026");
  eq(parseDateParam("2026-12-25", "2026-10-10"), "2026-12-25");
  eq(parseDateParam("2026-02-31", "2026-10-10"), "2026-10-10", "not a day");
  eq(parseDateParam("2026-13-01", "2026-10-10"), "2026-10-10");
  eq(parseDateParam(undefined, "2026-10-10"), "2026-10-10");
});
