import { Landing, type TileState } from "@/components/tablet/Landing";
import { templatesForShift, type ScheduledTemplate } from "@/lib/checklists";
import { isoWeekday, onPlanItemIds } from "@/lib/displayTags";
import type { ShiftSlot } from "@/lib/employeeEvents";
import { OPEN_TASK_STATUSES, openTasksForRun, type CarryableTask } from "@/lib/facilityTasks";
import { isCurrentPlan } from "@/lib/productionPlans";
import { isBatchOutstanding } from "@/lib/productionBatches";
import { getAppSession } from "@/lib/session";
import { ordersForKitchen } from "@/lib/specialOrderSchedule";
import { createClient } from "@/lib/supabase/server";
import { tilesForRole, type TileKey } from "@/lib/tablet/landing";
import {
  batchLogsState,
  checklistState,
  planState,
  purchaseOrdersState,
  schedulesState,
  shiftReportState,
  specialOrdersState,
  tagsState,
  tasksState,
} from "@/lib/tablet/landingState";
import { daysAfter, serverTimeZone, todayInTimeZone } from "@/lib/today";

/**
 * THE TABLET SHELL'S HOME — a page of actions rather than a menu (Mark,
 * 2026-09-09). Reachable under either shell (a desk browser can look at it),
 * but only the tablet's `/` lands here and only the tablet bar has a Home
 * button pointing at it.
 *
 * EACH TILE SAYS WHAT IS OUTSTANDING. Nine small, location-scoped probes in
 * one wave, every one reusing the helper its own screen reads — so a tile and
 * the screen behind it cannot disagree about what "on the plan" or "pinned for
 * tonight" means. A probe that FAILS drops its line rather than the page: a
 * landing page that will not open because one count would not is the wrong
 * trade, and the screen behind the tile will say what is wrong in its own
 * words.
 *
 * The kitchen is the working shop: that is what the shift report's Tomorrow
 * page generates for, and the schedule and batch probes ask the same question
 * it does.
 */
export default async function StartPage() {
  const session = await getAppSession();
  const groups = tilesForRole(session.membership.role);
  const shown = new Set(groups.flatMap((g) => g.tiles.map((t) => t.key)));
  const loc = session.activeLocation?.id ?? null;

  const tz = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(tz);
  const tomorrow = daysAfter(today, 1);
  const weekEnd = daysAfter(today, 6);
  const weekday = isoWeekday(today);

  const state: Partial<Record<TileKey, TileState>> = {};

  if (loc) {
    const supabase = await createClient();
    const SKIP = Promise.resolve({ data: null, error: null, count: null });
    const want = (key: TileKey) => shown.has(key);

    const [reports, templates, runs, tasks, plans, schedules, planDays, pos, orders, logs] =
      await Promise.all([
        want("shift_report")
          ? supabase
              .from("shift_reports")
              .select("id, shift")
              .eq("location_id", loc)
              .eq("report_date", today)
              .eq("status", "draft")
          : SKIP,
        want("checklist")
          ? supabase
              .from("checklist_templates")
              .select("id, kind, weekdays, shifts, is_active")
              .eq("location_id", loc)
              .eq("is_active", true)
          : SKIP,
        want("checklist")
          ? supabase
              .from("checklist_runs")
              .select("id, template_id, status")
              .eq("location_id", loc)
              .eq("business_date", today)
          : SKIP,
        want("tasks")
          ? supabase
              .from("location_tasks")
              .select(
                "id, status, carry_forward, target_shift, due_on, created_at, priority, assigned_to"
              )
              .eq("location_id", loc)
              .in("status", OPEN_TASK_STATUSES)
          : SKIP,
        want("plan")
          ? supabase
              .from("production_plans")
              .select("id, title, starts_on, ends_on, is_active")
              .eq("location_id", loc)
          : SKIP,
        want("schedules")
          ? supabase
              .from("production_schedules")
              .select("id")
              .eq("kitchen_location_id", loc)
              .eq("schedule_date", tomorrow)
          : SKIP,
        want("tags")
          ? supabase
              .from("v_production_plan_days")
              .select("item_id, weekday, planned_par")
              .eq("location_id", loc)
              .eq("plan_active", true)
              .lte("starts_on", today)
              .or(`ends_on.is.null,ends_on.gte.${today}`)
          : SKIP,
        want("purchase_orders")
          ? supabase
              .from("purchase_orders")
              .select("id", { count: "exact", head: true })
              .eq("location_id", loc)
              // Draft or sent — still to ARRIVE. Not `isPoOpen`'s "not closed":
              // 5,751 FileMaker orders were received and never closed, and a
              // supervisor at the door wants the ones a truck still owes.
              .in("status", ["draft", "sent"])
          : SKIP,
        want("special_orders")
          ? supabase
              .from("special_orders")
              .select("id, kitchen_location_id, location_id")
              .eq("kind", "order")
              .eq("status", "order")
              .gte("event_date", today)
              .lte("event_date", weekEnd)
          : SKIP,
        want("batch_logs")
          ? supabase
              .from("production_batch_logs")
              .select("id, production_batches ( id, status )")
              .eq("location_id", loc)
              .gte("log_date", today)
          : SKIP,
      ]);

    if (want("shift_report") && !reports.error) {
      state.shift_report = shiftReportState(
        (reports.data ?? []) as { id: string; shift: ShiftSlot }[]
      );
    }

    if (want("checklist") && !templates.error && !runs.error) {
      const scheduled = ((templates.data ?? []) as ScheduledTemplate[]).filter((t) =>
        (["opening", "mid", "closing", "off_site"] as const).some(
          (sh) => templatesForShift([t], weekday, sh).length > 0
        )
      );
      const todaysRuns = (runs.data ?? []) as { id: string; template_id: string | null; status: string }[];
      const startedIds = new Set(todaysRuns.map((r) => r.template_id));
      state.checklist = checklistState({
        asked: scheduled.length,
        started: scheduled.filter((t) => startedIds.has(t.id)).length,
        openRuns: todaysRuns.filter((r) => r.status === "open"),
      });
    }

    if (want("tasks") && !tasks.error) {
      const rows = (tasks.data ?? []) as CarryableTask[];
      state.tasks = tasksState({
        open: rows.length,
        pinned: openTasksForRun(rows, null, { viewerId: session.userId }).length,
      });
    }

    if (want("plan") && !plans.error) {
      const rows = (plans.data ?? []) as {
        title: string;
        starts_on: string;
        ends_on: string | null;
        is_active: boolean;
      }[];
      state.plan = planState(rows.filter((p) => isCurrentPlan(p, today)).map((p) => p.title));
    }

    if (want("schedules") && !schedules.error) {
      state.schedules = schedulesState({ tomorrow: (schedules.data ?? []).length });
    }

    if (want("tags") && !planDays.error) {
      const rows = (planDays.data ?? []) as { item_id: string; weekday: number; planned_par: number | null }[];
      state.tags = tagsState({ onPlan: onPlanItemIds(rows, weekday).size });
    }

    if (want("purchase_orders") && !pos.error) {
      state.purchase_orders = purchaseOrdersState({ open: pos.count ?? 0 });
    }

    if (want("special_orders") && !orders.error) {
      const rows = (orders.data ?? []) as { kitchen_location_id: string | null; location_id: string | null }[];
      state.special_orders = specialOrdersState({ thisWeek: ordersForKitchen(rows, loc).length });
    }

    if (want("batch_logs") && !logs.error) {
      const rows = (logs.data ?? []) as { production_batches: { status: string }[] | null }[];
      const outstanding = rows.reduce(
        (n, l) => n + (l.production_batches ?? []).filter((b) => isBatchOutstanding(b.status)).length,
        0
      );
      state.batch_logs = batchLogsState({ logs: rows.length, outstanding });
    }
  }

  // No heading (Mark, 2026-09-10): the shop's code already sits in the bar's
  // location picker, so an h1 restating it was the same fact twice.
  return <Landing groups={groups} state={state} />;
}
