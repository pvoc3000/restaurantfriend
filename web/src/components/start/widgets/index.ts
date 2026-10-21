import type { ReactNode } from "react";

import { canReachPage } from "@/lib/pageAccess";
import { canReadHr, type Role } from "@/lib/roles";
import { tilesForRole } from "@/lib/tablet/landing";
import type { WidgetAccess, WidgetKind } from "@/lib/startLayout";

import { ActionsWidget } from "./ActionsWidget";
import { BillsWidget } from "./BillsWidget";
import { CalendarWidget } from "./CalendarWidget";
import { InvoicesWidget } from "./InvoicesWidget";
import { PaperworkWidget } from "./PaperworkWidget";
import { PurchaseOrdersWidget } from "./PurchaseOrdersWidget";
import { RemindersWidget } from "./RemindersWidget";
import { SalesWidget } from "./SalesWidget";
import type { StartContext } from "./shared";
import { ShiftReportsWidget } from "./ShiftReportsWidget";
import { SpecialOrdersWidget } from "./SpecialOrdersWidget";
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
  actions: ActionsWidget,
};

/**
 * Which widgets a role may have — the Page Permissions sheet's answer for the
 * list each one opens (`lib/pageAccess`, the table the menu reads), so a widget
 * is never fetched for somebody who could not follow its link. Paperwork also
 * needs HR. Reminders needs either half; Today needs the calendar; Actions
 * needs a tablet tile the role may use.
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
    // Anybody with a tile to put in it.
    actions: tilesForRole(role).length > 0,
  };
}
