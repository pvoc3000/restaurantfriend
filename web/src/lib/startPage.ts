// THE DESK START PAGE'S ARITHMETIC (Mark, 2026-09-17: "a 'start' page for the
// desktop too … a lot of information about the state of things").
//
// Pure, fixture-tested. The page's cards are whole-org counts that link to the
// screens that own each fact, so every rule here REUSES the one those screens
// read — `billStage`, `agingBucket`, `balanceOwed`, `missingNights`,
// `soonestExpiry` — and a card cannot disagree with the list behind it about
// what "overdue" or "a missed night" means.

import { expiryState, soonestExpiry, type DocumentKind, type ExpiryState } from "./employeeDocuments";
import { agingBucket, balanceOwed, billStage, type BillStatus } from "./bills";
import { addDays, isoWeekday } from "./payPeriods";
import { rollUpByDate, type DateRange, type SalesDay } from "./sales";
import { missingNights } from "./shiftReports";
import { dayAgenda, type CalendarItem } from "./calendar";

// ---------------------------------------------------------------------------
// Sales: this year against last year, day by day
// ---------------------------------------------------------------------------

export type TrendPoint = {
  date: string;
  /** The date a year back — 364 days, so it is the same weekday. */
  lastYearDate: string;
  /** Every shop's net sales that day, in cents. Null when no shop has a row —
   *  a day nobody pulled is not a day that took nothing. */
  thisYear: number | null;
  lastYear: number | null;
};

/**
 * One point per date in `range`, both shops folded together.
 *
 * WEEK-ALIGNED, never calendar-aligned — `lastYearRange`'s rule and its
 * reason: a bakery's Saturday compared with last year's Friday compares two
 * different businesses, and a line chart makes that visible as a weekly
 * sawtooth that is nothing but the calendar.
 */
export function yearOverYearTrend(days: readonly SalesDay[], range: DateRange): TrendPoint[] {
  const byDate = rollUpByDate(days);
  const points: TrendPoint[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const lastYearDate = addDays(date, -364);
    points.push({
      date,
      lastYearDate,
      thisYear: byDate.get(date)?.netSalesCents ?? null,
      lastYear: byDate.get(lastYearDate)?.netSalesCents ?? null,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type StartBill = {
  status: BillStatus;
  due_date: string | null;
  total: number | null;
  is_credit: boolean;
  linked: boolean;
  qbo_balance: number | null;
  qbo_checked_at: string | null;
};

export type BillAttention = {
  /** Open — somebody still has to approve it. */
  awaitingApproval: number;
  /** Approved and not yet in QuickBooks. */
  notSent: number;
  /** Past its due date with money still owed — any stage short of paid. */
  overdue: number;
};

export function billAttention(rows: readonly StartBill[], today: string): BillAttention {
  let awaitingApproval = 0;
  let notSent = 0;
  let overdue = 0;
  for (const r of rows) {
    const stage = billStage(r);
    if (stage === "void" || stage === "paid") continue;
    if (stage === "open") awaitingApproval += 1;
    if (stage === "approved") notSent += 1;
    // A credit is never overdue: it is money owed TO us.
    if (agingBucket(r.due_date, today) === "overdue" && balanceOwed(r) > 0.005) overdue += 1;
  }
  return { awaitingApproval, notSent, overdue };
}

/** Is this one of the bills the card should list — overdue and still owed? */
export function isOverdueBill(r: StartBill, today: string): boolean {
  const stage = billStage(r);
  if (stage === "void" || stage === "paid") return false;
  return agingBucket(r.due_date, today) === "overdue" && balanceOwed(r) > 0.005;
}

// ---------------------------------------------------------------------------
// Shift reports
// ---------------------------------------------------------------------------

export type ShopDays = {
  id: string;
  code: string;
  openDays: readonly number[];
  /** Dates the calendar says this shop was closed (migration 181). */
  closedDates?: ReadonlySet<string>;
};

/**
 * Every shop's closing nights with no report, over the `lookback` days ending
 * YESTERDAY — the Shift Reports list's own rule (closing only; today is not
 * late yet), applied to every shop at once. Newest first.
 */
export function missedClosingNights(
  shops: readonly ShopDays[],
  reports: readonly { location_id: string; report_date: string; shift: string }[],
  today: string,
  lookback = 7
): { code: string; date: string }[] {
  const days: { date: string; isoWeekday: number }[] = [];
  for (let i = 1; i <= lookback; i += 1) {
    const date = addDays(today, -i);
    days.push({ date, isoWeekday: isoWeekday(date) });
  }
  const out: { code: string; date: string }[] = [];
  for (const shop of shops) {
    const reportDates = reports
      .filter((r) => r.location_id === shop.id && r.shift === "closing")
      .map((r) => r.report_date);
    for (const date of missingNights({
      reportDates,
      openDays: shop.openDays,
      days,
      closedDates: shop.closedDates,
    })) {
      out.push({ code: shop.code, date });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Paperwork
// ---------------------------------------------------------------------------

export type PaperworkAlert = {
  employeeId: string;
  kind: DocumentKind;
  on: string;
  state: Extract<ExpiryState, "expired" | "soon">;
};

/**
 * Each person's worst lapsing document, if it has lapsed or is about to —
 * the roster's Expires column, for everybody at once. Expired first (the
 * soonest date is also the worst), then the ones coming up.
 */
export function paperworkAlerts(
  employees: readonly { id: string; food_handler_expires: string | null }[],
  docs: readonly { employee_id: string; kind: DocumentKind; expires_on: string | null }[],
  today: string
): PaperworkAlert[] {
  const byEmployee = new Map<string, { kind: DocumentKind; expires_on: string | null }[]>();
  for (const d of docs) {
    const list = byEmployee.get(d.employee_id) ?? [];
    list.push({ kind: d.kind, expires_on: d.expires_on });
    byEmployee.set(d.employee_id, list);
  }
  const out: PaperworkAlert[] = [];
  for (const e of employees) {
    const next = soonestExpiry(byEmployee.get(e.id) ?? [], e.food_handler_expires, today);
    if (!next) continue;
    const state = expiryState(next.on, today);
    if (state !== "expired" && state !== "soon") continue;
    out.push({ employeeId: e.id, kind: next.kind, on: next.on, state });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
}

// ---------------------------------------------------------------------------
// Today (2026-10-20)
// ---------------------------------------------------------------------------

/** A production schedule for today at this shop — sold here or made here. */
export type TodaySchedule = {
  id: string;
  title: string | null;
  location_id: string;
  kitchen_location_id: string;
  source: "plan" | "special_order" | "manual";
};

/**
 * THE TODAY WIDGET'S DAY: the calendar's items for today (deliveries, orders,
 * standing-order days, tasks, entries, the menu plan) and today's production
 * schedules, as `dayAgenda` splits a day — banners, then what has a time.
 *
 * TWO THINGS WOULD OTHERWISE BE SAID TWICE:
 *   * A schedule whose source is a special order IS that order, which is
 *     already on the day as a pickup or delivery — so it is left out.
 *   * The menu plan says what the shop INTENDS to make; a schedule is what was
 *     committed for today. When there is a schedule the plan's banner is
 *     dropped, and when there is none the plan is the best answer there is.
 *
 * `codes` names the kitchen before a schedule, as an order's kitchen leads its
 * line ("DF01: …").
 */
export function todayTimeline(
  items: readonly CalendarItem[],
  schedules: readonly TodaySchedule[],
  today: string,
  codes: ReadonlyMap<string, string>,
): { banners: CalendarItem[]; timed: CalendarItem[] } {
  const made = schedules.filter((s) => s.source !== "special_order");
  const scheduleItems: CalendarItem[] = made.map((s) => ({
    key: `schedule:${s.id}`,
    layer: "menu_plan",
    date: today,
    title: s.title?.trim() || "Production schedule",
    lead: codes.get(s.kitchen_location_id) ?? null,
    href: `/schedules/${s.id}`,
    locationIds: [...new Set([s.location_id, s.kitchen_location_id])],
  }));
  const rest = made.length > 0 ? items.filter((i) => i.layer !== "menu_plan") : items;
  return dayAgenda([...rest, ...scheduleItems]);
}
