import { closedDates } from "@/lib/blackoutDates";
import { fetchEntries } from "@/lib/calendarQueries";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { todayInTimeZone, serverTimeZone, daysBefore } from "@/lib/today";
import {
  ShiftReportsList,
  type ShiftReportRow,
} from "@/components/operations/ShiftReportsList";
import type { ShiftSlot } from "@/lib/shiftReports";

import { shiftReportRangeBounds } from "@/lib/shiftReportRange";
import type { RawSearchParams } from "@/lib/filterMenus";

/** The missing-night sweep's own window — `ShiftReportsList`'s `GAP_DAYS`.
 *  Fetched apart from the list, which may be showing last March. */
const GAP_DAYS = 7;


/**
 * The supervisor shift reports.
 *
 * Location-scoped like the order guide and the purchase orders: a report is
 * about one shop's shift. Read is supervisor+ (070) because a report is
 * written to be read by the team — but the RATINGS on it are not, which is
 * `shift_report_ratings`' own policy rather than anything this page does.
 */
export default async function ShiftReportsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
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
  // THE WINDOW IS THE URL'S (Mark, 2026-10-04) — `?range=`, a preset key or a
  // picked `from..to`; absent is the last 30 days. It bounds the QUERY, not a
  // filter over rows already here, so "All Time" is not capped at what a fixed
  // window happened to load.
  const rangeParam = Array.isArray(params.range) ? params.range[0] : params.range;
  const bounds = shiftReportRangeBounds(rangeParam, today);

  // PAGED, because PostgREST returns at most 1,000 rows and says nothing: one
  // shop writes about that many reports a year, so "All Time" would quietly
  // lose the oldest.
  const loadReports = async () => {
    const out = [];
    for (let at = 0; ; at += 1000) {
      let q = supabase
        .from("shift_reports")
        // ONE STRING LITERAL, never a concatenation: supabase-js parses this
        // at the TYPE level, and `"a" + "b"` widens to `string`, which
        // collapses every selected column to `GenericStringError`.
        .select(
          "id, report_date, shift, status, narrative, supervisor_employee_id, created_by, task_ratings_done, task_special_orders_done, task_schedules_done, sent_at, emailed_at, previously_emailed_at, updated_at"
        )
        .eq("location_id", active.id);
      if (bounds) q = q.gte("report_date", bounds.from).lte("report_date", bounds.to);
      const { data, error } = await q
        .order("report_date", { ascending: false })
        .order("id")
        .range(at, at + 999);
      if (error) return { data: null, error };
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return { data: out, error: null };
  };

  const [
    { data: reports, error },
    { data: recentClosings },
    { data: takers },
    { data: myEmployeeId },
    { data: shop },
    { entries: calendarEntries },
  ] = await Promise.all([
    loadReports(),
    // The last week's CLOSING reports, for the missing-night sentence. Its own
    // query so the sentence does not depend on the window being shown — with
    // the list on "Yesterday" every other night would read as unreported.
    supabase
      .from("shift_reports")
      .select("report_date")
      .eq("location_id", active.id)
      .eq("shift", "closing")
      .gte("report_date", daysBefore(today, GAP_DAYS)),
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
    // The calendar's exceptions to that weekly pattern (migration 181): a shop
    // closed for Christmas owes no closing report.
    fetchEntries(supabase, { from: daysBefore(today, GAP_DAYS), to: today }),
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
    previouslyEmailedAt: (r.previously_emailed_at as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));

  return (
    <ShiftReportsList
      key={active.id}
      rows={rows}
      today={today}
      range={bounds}
      recentClosingDates={(recentClosings ?? []).map((r) => r.report_date as string)}
      orgId={session.membership.org_id}
      locationId={active.id}
      locationCode={active.code}
      openDays={(shop?.open_days as number[] | null) ?? []}
      closedDates={[
        ...closedDates(calendarEntries, active.id, { from: daysBefore(today, GAP_DAYS), to: today }),
      ]}
      myEmployeeId={(myEmployeeId as string | null) ?? null}
    />
  );
}
