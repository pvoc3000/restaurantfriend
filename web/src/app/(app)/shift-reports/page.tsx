import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { todayInTimeZone, serverTimeZone, daysBefore } from "@/lib/today";
import {
  ShiftReportsList,
  type ShiftReportRow,
} from "@/components/operations/ShiftReportsList";
import type { ShiftSlot } from "@/lib/shiftReports";

/** How far back the list looks. A shift report is a daily thing; a fortnight
 *  is more than anybody scrolls and it bounds the missing-night sweep too. */
const WINDOW_DAYS = 28;

/**
 * The supervisor shift reports.
 *
 * Location-scoped like the order guide and the purchase orders: a report is
 * about one shop's shift. Read is supervisor+ (070) because a report is
 * written to be read by the team — but the RATINGS on it are not, which is
 * `shift_report_ratings`' own policy rather than anything this page does.
 */
export default async function ShiftReportsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;
  const role = session.membership.role;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  if (!canEnterCounts(role)) {
    return (
      <p className="text-sm text-muted">
        Shift reports are for supervisors and managers. Your account cannot read them.
      </p>
    );
  }

  const timeZone = (session.orgSettings.timezone as string) ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const from = daysBefore(today, WINDOW_DAYS);

  const [
    { data: reports, error },
    { data: takers },
    { data: myEmployeeId },
    { data: shop },
  ] = await Promise.all([
    supabase
      .from("shift_reports")
      // ONE STRING LITERAL, never a concatenation: supabase-js parses this at
      // the TYPE level, and `"a" + "b"` widens to `string`, which collapses
      // every selected column to `GenericStringError`.
      .select(
        "id, report_date, shift, status, narrative, supervisor_employee_id, created_by, task_ratings_done, task_special_orders_done, task_schedules_done, sent_at, emailed_at, updated_at"
      )
      .eq("location_id", active.id)
      .gte("report_date", from)
      .order("report_date", { ascending: false }),
    // `employees` READ is owner/admin (020), so a supervisor can only learn a
    // colleague's name through this definer — 053's function. It is what turns
    // each row's `supervisor_employee_id` into a name; nothing picks from it
    // here any more.
    supabase.rpc("special_order_takers", { p_org_id: session.membership.org_id }),
    // Who the CREATE dialog will name as the shift's supervisor: whoever is
    // logged in (Mark, 2026-09-01). Migration 080 — `employees.user_id` is the
    // link and `employees` READ is owner/admin, so a supervisor can resolve
    // their own row only through a definer. Null when a login has no HR record,
    // which leaves the column null and page 1's picker as the way to set it.
    supabase.rpc("my_employee_id", { p_org_id: session.membership.org_id }),
    // 017's column, and this is its first reader. It is what makes "nobody
    // reported Tuesday" a fact rather than a suspicion: the shop either was or
    // was not open that weekday.
    supabase.from("locations").select("open_days").eq("id", active.id).maybeSingle(),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load shift reports: {error.message}
        {/shift_report|task_ratings_done|emailed_at/.test(error.message) ? (
          <span className="mt-2 block text-muted">
            If this names a missing table or column, migration 070 has not been
            applied yet.
          </span>
        ) : null}
      </p>
    );
  }

  const nameById = new Map<string, string>(
    ((takers as { id: string; name: string }[] | null) ?? []).map((t) => [t.id, t.name])
  );

  const rows: ShiftReportRow[] = (reports ?? []).map((r) => ({
    id: r.id as string,
    reportDate: r.report_date as string,
    shift: r.shift as ShiftSlot,
    status: r.status as "draft" | "sent",
    narrative: (r.narrative as string | null) ?? null,
    supervisorName: r.supervisor_employee_id
      ? nameById.get(r.supervisor_employee_id as string) ?? null
      : null,
    mine: r.created_by === session.userId,
    sentAt: (r.sent_at as string | null) ?? null,
    emailedAt: (r.emailed_at as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));

  return (
    <ShiftReportsList
      key={active.id}
      rows={rows}
      today={today}
      orgId={session.membership.org_id}
      locationId={active.id}
      locationCode={active.code}
      openDays={(shop?.open_days as number[] | null) ?? []}
      myEmployeeId={(myEmployeeId as string | null) ?? null}
    />
  );
}
