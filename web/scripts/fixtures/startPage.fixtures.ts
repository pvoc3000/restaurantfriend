// The desk start page's cards (lib/startPage) — each one is a whole-org
// reading of a rule a list already owns, so these pin that the reading agrees.

import {
  billAttention,
  isOverdueBill,
  missedClosingNights,
  paperworkAlerts,
  todayTimeline,
  yearOverYearTrend,
  type StartBill,
} from "../../src/lib/startPage";
import type { CalendarItem } from "../../src/lib/calendar";
import type { SalesDay } from "../../src/lib/sales";
import { eq, no, ok, test } from "./harness";

const day = (date: string, loc: string, cents: number): SalesDay => ({
  location_id: loc,
  locationCode: loc,
  business_date: date,
  netSalesCents: cents,
  tipsCents: 0,
  syncedAt: null,
  source: "square",
});

test("trend folds the shops together and compares 364 days back", () => {
  const points = yearOverYearTrend(
    [
      day("2026-09-16", "A", 100),
      day("2026-09-16", "B", 50),
      day("2025-09-17", "A", 70), // 2026-09-16 − 364 days
      day("2025-09-16", "A", 999), // the calendar date — must NOT be used
    ],
    { from: "2026-09-16", to: "2026-09-17" }
  );
  eq(points.length, 2);
  eq(points[0], { date: "2026-09-16", lastYearDate: "2025-09-17", thisYear: 150, lastYear: 70 });
  // A day nobody pulled is null, not zero.
  eq(points[1].thisYear, null);
});

const bill = (over: Partial<StartBill>): StartBill => ({
  status: "open",
  due_date: null,
  total: 100,
  is_credit: false,
  linked: false,
  qbo_balance: null,
  qbo_checked_at: null,
  ...over,
});

test("invoice counts: open, approved-not-sent, overdue-and-owed", () => {
  const today = "2026-09-17";
  const rows = [
    bill({}),
    bill({ status: "approved" }),
    bill({ status: "approved", linked: true, qbo_balance: 40, due_date: "2026-09-01" }),
    bill({ status: "approved", linked: true, qbo_balance: 0, due_date: "2026-09-01" }), // paid
    bill({ status: "void", due_date: "2026-09-01" }),
    bill({ is_credit: true, due_date: "2026-09-01" }), // a credit is never overdue
    bill({ due_date: "2026-09-17" }), // due today is not late
  ];
  eq(billAttention(rows, today), { awaitingApproval: 3, notSent: 1, overdue: 1 });
  ok(isOverdueBill(rows[2], today));
  no(isOverdueBill(rows[3], today));
  no(isOverdueBill(rows[6], today));
});

test("missed nights: closing only, open days only, ending yesterday, every shop", () => {
  // 2026-09-17 is a Thursday. Shop A is open Mon–Sun, B only Wednesdays.
  const shops = [
    { id: "a", code: "DF01", openDays: [1, 2, 3, 4, 5, 6, 7] },
    { id: "b", code: "DF02", openDays: [3] },
    { id: "c", code: "EVENT", openDays: [] },
  ];
  const reports = [1, 2, 3, 4, 5, 6].map((i) => ({
    location_id: "a",
    report_date: `2026-09-${String(17 - i).padStart(2, "0")}`,
    shift: "closing",
  }));
  // An opening report does not cover a closing night.
  reports.push({ location_id: "a", report_date: "2026-09-10", shift: "opening" });
  eq(missedClosingNights(shops, reports, "2026-09-17"), [
    { code: "DF02", date: "2026-09-16" },
    { code: "DF01", date: "2026-09-10" },
  ]);
});

test("paperwork: the worst lapsing document per person, expired first", () => {
  const alerts = paperworkAlerts(
    [
      { id: "e1", food_handler_expires: "2023-01-01" },
      { id: "e2", food_handler_expires: null },
      { id: "e3", food_handler_expires: "2030-01-01" }, // fine
      { id: "e4", food_handler_expires: "2021-01-01" }, // superseded by a filed card
    ],
    [
      { employee_id: "e2", kind: "food_handler_card", expires_on: "2026-10-01" },
      { employee_id: "e4", kind: "food_handler_card", expires_on: null },
    ],
    "2026-09-17"
  );
  eq(alerts, [
    { employeeId: "e1", kind: "food_handler_card", on: "2023-01-01", state: "expired" },
    { employeeId: "e2", kind: "food_handler_card", on: "2026-10-01", state: "soon" },
  ]);
});

// --- todayTimeline (2026-10-20) ----------------------------------------------


const T = "2026-10-20";
const codes = new Map([["k1", "DF01"], ["s2", "DF02"]]);
const plan: CalendarItem = { key: "plan:1", layer: "menu_plan", date: T, title: "Fall menu", lead: "Menu", locationIds: [] };
const pickup: CalendarItem = { key: "o:1", layer: "orders_paid", date: T, title: "Smith", time: "09:00", locationIds: ["s2"] };
const delivery: CalendarItem = { key: "po:1", layer: "deliveries", date: T, title: "Bakemark", locationIds: ["s2"] };

test("todayTimeline: a special-order schedule is the order already listed, so it is dropped", () => {
  const out = todayTimeline([pickup], [
    { id: "a", title: "Smith wedding", location_id: "s2", kitchen_location_id: "k1", source: "special_order" },
  ], T, codes);
  eq(out.banners.map((i) => i.key), []);
  eq(out.timed.map((i) => i.key), ["o:1"]);
});

test("todayTimeline: a schedule replaces the plan's banner; with none the plan stays", () => {
  const out = todayTimeline([plan, pickup, delivery], [
    { id: "b", title: "DF02 Tuesday", location_id: "s2", kitchen_location_id: "k1", source: "plan" },
  ], T, codes);
  eq(out.banners.map((i) => i.key), ["schedule:b", "po:1"]);
  eq(out.banners[0].lead, "DF01", "the kitchen leads, as it does on an order");
  eq(out.banners[0].href, "/schedules/b");
  eq(out.timed.map((i) => i.key), ["o:1"]);
  eq(todayTimeline([plan, delivery], [], T, codes).banners.map((i) => i.key), ["plan:1", "po:1"]);
});
