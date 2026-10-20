import type { ReactNode } from "react";

import { canReachPage } from "@/lib/pageAccess";
import { canReadHr, type Role } from "@/lib/roles";
import type { WidgetAccess, WidgetKind } from "@/lib/startLayout";

import { billsAttention, BillsWidget } from "./BillsWidget";
import { CalendarWidget } from "./CalendarWidget";
import { invoicesAttention, InvoicesWidget } from "./InvoicesWidget";
import { paperworkAttention, PaperworkWidget } from "./PaperworkWidget";
import { purchaseOrdersAttention, PurchaseOrdersWidget } from "./PurchaseOrdersWidget";
import { remindersAttention, RemindersWidget } from "./RemindersWidget";
import { SalesWidget } from "./SalesWidget";
import type { StartContext } from "./shared";
import { shiftReportsAttention, ShiftReportsWidget } from "./ShiftReportsWidget";
import { specialOrdersAttention, SpecialOrdersWidget } from "./SpecialOrdersWidget";
import { TodayWidget } from "./TodayWidget";

/** Each widget's server half: its queries, then its body. */
export const WIDGET_BODY: Record<WidgetKind, (ctx: StartContext) => Promise<ReactNode>> = {
  reminders: RemindersWidget,
  sales: SalesWidget,
  bills: BillsWidget,
  purchase_orders: PurchaseOrdersWidget,
  special_orders: SpecialOrdersWidget,
  invoices: InvoicesWidget,
  shift_reports: ShiftReportsWidget,
  paperwork: PaperworkWidget,
  calendar: CalendarWidget,
  today: TodayWidget,
};

/**
 * What each widget adds to the Home button's badge (2026-10-20) — the yellow
 * numbers on its card, from the SAME summary the card draws, so the badge and
 * the page cannot disagree. Sales, Calendar and Today count nothing: they
 * report, they do not ask.
 */
export const WIDGET_ATTENTION: Partial<Record<WidgetKind, (ctx: StartContext) => Promise<number>>> = {
  reminders: remindersAttention,
  bills: billsAttention,
  purchase_orders: purchaseOrdersAttention,
  special_orders: specialOrdersAttention,
  invoices: invoicesAttention,
  shift_reports: shiftReportsAttention,
  paperwork: paperworkAttention,
};

/**
 * Which widgets a role may have — the Page Permissions sheet's answer for the
 * list each one opens (`lib/pageAccess`, the table the menu reads), so a widget
 * is never fetched for somebody who could not follow its link. Paperwork also
 * needs HR. Reminders needs either half; Today needs the calendar.
 */
export function widgetAccess(role: Role): WidgetAccess {
  return {
    reminders: canReachPage(role, "/order-guide") || canReachPage(role, "/purchase-requests"),
    sales: canReachPage(role, "/sales"),
    bills: canReachPage(role, "/bills"),
    purchase_orders: canReachPage(role, "/purchase-orders"),
    special_orders: canReachPage(role, "/special-orders"),
    invoices: canReachPage(role, "/customer-invoices"),
    shift_reports: canReachPage(role, "/shift-reports"),
    paperwork: canReadHr(role) && canReachPage(role, "/employees"),
    calendar: canReachPage(role, "/calendar"),
    today: canReachPage(role, "/calendar"),
  };
}
