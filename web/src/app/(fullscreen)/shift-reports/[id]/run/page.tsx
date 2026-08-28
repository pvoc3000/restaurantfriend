import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { daysBefore } from "@/lib/today";
import {
  pagesForShift,
  type EmailReport,
  type ShiftReportPage,
  type ShiftSlot,
} from "@/lib/shiftReports";
import { ShiftReportRunner } from "@/components/operations/ShiftReportRunner";
import { InfoPage } from "@/components/operations/pages/InfoPage";
import { RatingsPage, type RatingRow } from "@/components/operations/pages/RatingsPage";
import { SalesPage } from "@/components/operations/pages/SalesPage";
import { PremadesPage, type PremadeRow } from "@/components/operations/pages/PremadesPage";
import {
  ElementsPage,
  type ElementBatchRow,
} from "@/components/operations/pages/ElementsPage";
import { ReportPage } from "@/components/operations/pages/ReportPage";
import {
  TomorrowPage,
  type TomorrowOrder,
  type TomorrowSchedule,
} from "@/components/operations/pages/TomorrowPage";
import { SubmitPage } from "@/components/operations/pages/SubmitPage";

/** Standing in for a query this shift does not need. The employee record's
 *  tab-fetching idiom: only the pages in play cost anything. */
const SKIP = { data: null, error: null } as const;

export default async function RunShiftReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAppSession();
  const supabase = await createClient();
  const role = session.membership.role;

  if (!canEnterCounts(role)) {
    return (
      <main className="p-8">
        <p className="text-sm text-muted">
          Shift reports are written by supervisors and managers.
        </p>
      </main>
    );
  }

  const { data: report, error } = await supabase
    .from("shift_reports")
    // ONE STRING LITERAL — see the list page.
    .select(
      "id, org_id, location_id, kitchen_location_id, report_date, shift, status, narrative, supervisor_employee_id, next_production_date, created_by, task_ratings_done, task_special_orders_done, task_schedules_done"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <main className="p-8">
        <p className="text-sm text-accent">
          Could not open the report: {error.message}
          {/shift_report/.test(error.message) ? (
            <span className="mt-2 block text-muted">
              If this names a missing table, migration 070 has not been applied yet.
            </span>
          ) : null}
        </p>
      </main>
    );
  }
  if (!report) notFound();

  const shift = report.shift as ShiftSlot;
  const pages = pagesForShift(shift);
  const wants = (p: ShiftReportPage) => pages.includes(p);
  const reportDate = report.report_date as string;
  const nextDay = (report.next_production_date as string | null) ?? null;
  const kitchenId = (report.kitchen_location_id as string) ?? (report.location_id as string);
  const isSent = report.status === "sent";
  // A sent report is a document. Editing is the author's while it is a draft;
  // sending is the author's too — `submit_shift_report` re-checks both, so this
  // only decides what the screen OFFERS.
  const editable = !isSent && report.created_by === session.userId;
  const canSend = editable;

  const locationCode =
    session.locations.find((l) => l.id === report.location_id)?.code ?? "—";
  const kitchenCode = session.locations.find((l) => l.id === kitchenId)?.code ?? locationCode;

  const lastWeekDate = daysBefore(reportDate, 7);
  // 364 days, not 365 — `lib/sales.lastYearRange`'s own default, so the WEEKDAY
  // aligns. A Saturday compared against a Friday is worse than no comparison.
  const lastYearDate = daysBefore(reportDate, 364);

  const [
    { data: takers },
    { data: ratings },
    { data: todaySchedule },
    { data: batchLog },
    { data: salesDays },
    { data: tomorrowOrders },
    { data: tomorrowSchedules },
    { data: plans },
  ] = await Promise.all([
    supabase.rpc("special_order_takers", { p_org_id: report.org_id }),
    supabase
      .from("shift_report_ratings")
      .select("id, employee_id, position, score, note, got_break, break_reason")
      .eq("report_id", id)
      .order("created_at"),
    wants("premades")
      ? supabase
          .from("production_schedules")
          .select("id, title, production_schedule_items(id)")
          .eq("location_id", report.location_id)
          .eq("schedule_date", reportDate)
          .maybeSingle()
      : SKIP,
    wants("elements")
      ? supabase
          .from("production_batch_logs")
          .select("id")
          .eq("location_id", kitchenId)
          .eq("log_date", reportDate)
          .maybeSingle()
      : SKIP,
    wants("sales")
      ? supabase
          .from("daily_sales")
          .select("business_date, net_sales_cents, tips_cents")
          .eq("location_id", report.location_id)
          .in("business_date", [reportDate, lastWeekDate, lastYearDate])
      : SKIP,
    wants("tomorrow") && nextDay
      ? supabase
          .from("special_orders")
          .select("id, number, title, event_time, order_printed_at")
          .eq("kind", "order")
          .eq("event_date", nextDay)
          .order("event_time")
      : SKIP,
    wants("tomorrow") && nextDay
      ? supabase
          .from("production_schedules")
          .select("id, title, location_id, source, printed_at")
          .eq("kitchen_location_id", kitchenId)
          .eq("schedule_date", nextDay)
      : SKIP,
    wants("tomorrow")
      ? supabase
          .from("production_plans")
          .select("id, title, location_id, kitchen_location_id, starts_on, ends_on, is_active")
      : SKIP,
  ]);

  const nameById = new Map<string, string>(
    ((takers as { id: string; name: string }[] | null) ?? []).map((t) => [t.id, t.name])
  );
  const roster = ((takers as { id: string; name: string }[] | null) ?? []).map((t) => ({
    value: t.id,
    label: t.name,
  }));

  const ratingRows: RatingRow[] = ((ratings as Record<string, unknown>[] | null) ?? []).map(
    (r) => ({
      id: r.id as string,
      employeeId: r.employee_id as string,
      employeeName: nameById.get(r.employee_id as string) ?? "Somebody",
      position: (r.position as string | null) ?? null,
      score: r.score === null ? null : Number(r.score),
      note: (r.note as string | null) ?? null,
      gotBreak: (r.got_break as boolean | null) ?? null,
      breakReason: (r.break_reason as string | null) ?? null,
    })
  );

  // ---- premades: the day's lines, with any draft counts laid over them -----
  let premadeRows: PremadeRow[] = [];
  let scheduleTitle: string | null = null;
  if (wants("premades") && todaySchedule) {
    scheduleTitle = (todaySchedule.title as string | null) ?? null;
    const [{ data: lines }, { data: drafts }] = await Promise.all([
      supabase
        .from("v_production_schedule_lines")
        .select("id, item_name, item_type, subtype, par, note, sort")
        .eq("schedule_id", todaySchedule.id as string)
        .order("sort"),
      supabase
        .from("shift_report_counts")
        .select("schedule_item_id, made, leftover")
        .eq("report_id", id),
    ]);
    const draftById = new Map(
      ((drafts as Record<string, unknown>[] | null) ?? []).map((d) => [
        d.schedule_item_id as string,
        d,
      ])
    );
    premadeRows = ((lines as Record<string, unknown>[] | null) ?? []).map((l) => {
      const d = draftById.get(l.id as string);
      return {
        scheduleItemId: l.id as string,
        itemType: (l.item_type as string | null) ?? null,
        subtype: (l.subtype as string | null) ?? null,
        name: l.item_name as string,
        par: l.par === null ? null : Number(l.par),
        made: d?.made == null ? null : Number(d.made),
        leftover: d?.leftover == null ? null : Number(d.leftover),
        note: (l.note as string | null) ?? null,
      };
    });
  }

  // ---- elements: the kitchen's batch log for the day ----------------------
  let elementRows: ElementBatchRow[] = [];
  if (wants("elements") && batchLog) {
    const [{ data: batches }, { data: drafts }] = await Promise.all([
      supabase
        .from("production_batches")
        .select("id, batch_number, batch_label, sort, production_elements(name)")
        .eq("log_id", batchLog.id as string)
        .order("sort", { nullsFirst: false }),
      supabase
        .from("shift_report_batches")
        .select("batch_id, yield_count, yield_unit, status, notes")
        .eq("report_id", id),
    ]);
    const draftById = new Map(
      ((drafts as Record<string, unknown>[] | null) ?? []).map((d) => [d.batch_id as string, d])
    );
    elementRows = ((batches as Record<string, unknown>[] | null) ?? []).map((b) => {
      const d = draftById.get(b.id as string);
      const el = b.production_elements as { name: string } | null;
      return {
        batchId: b.id as string,
        batchNumber: b.batch_number as string,
        elementName: el?.name ?? "—",
        batchLabel: (b.batch_label as string | null) ?? null,
        yieldCount: d?.yield_count == null ? null : Number(d.yield_count),
        yieldUnit: (d?.yield_unit as string | null) ?? null,
        status: (d?.status as string | null) ?? null,
        notes: (d?.notes as string | null) ?? null,
      };
    });
  }

  // ---- sales: three settled days, of which today is usually absent --------
  const salesByDate = new Map(
    ((salesDays as Record<string, unknown>[] | null) ?? []).map((s) => [
      s.business_date as string,
      { netCents: Number(s.net_sales_cents), tipsCents: Number(s.tips_cents) },
    ])
  );
  const settledToday = salesByDate.get(reportDate) ?? null;

  const orders: TomorrowOrder[] = ((tomorrowOrders as Record<string, unknown>[] | null) ?? []).map(
    (o) => ({
      id: o.id as string,
      number: o.number as string,
      title: (o.title as string | null) ?? null,
      eventTime: (o.event_time as string | null)?.slice(0, 5) ?? null,
      printedAt: (o.order_printed_at as string | null) ?? null,
    })
  );

  const schedules: TomorrowSchedule[] = (
    (tomorrowSchedules as Record<string, unknown>[] | null) ?? []
  ).map((s) => ({
    id: s.id as string,
    title: (s.title as string | null) ?? null,
    sellsCode: session.locations.find((l) => l.id === s.location_id)?.code ?? "—",
    source: s.source as string,
    printedAt: (s.printed_at as string | null) ?? null,
  }));

  const bodies: Partial<Record<ShiftReportPage, React.ReactNode>> = {
    info: (
      <InfoPage
        key="info"
        reportId={id}
        reportDate={reportDate}
        shift={shift}
        supervisorId={(report.supervisor_employee_id as string | null) ?? null}
        nextProductionDate={nextDay}
        locationCode={locationCode}
        takers={roster}
        editable={editable}
      />
    ),
    ratings: (
      <RatingsPage
        key="ratings"
        reportId={id}
        orgId={report.org_id as string}
        rows={ratingRows}
        roster={roster}
        editable={editable}
      />
    ),
    report: (
      <ReportPage
        key="report"
        reportId={id}
        narrative={(report.narrative as string | null) ?? null}
        editable={editable}
      />
    ),
    submit: (
      <SubmitPage
        key="submit"
        reportId={id}
        editable={editable}
        readiness={{
          shift,
          narrative: (report.narrative as string | null) ?? null,
          ratingCount: ratingRows.length,
          taskRatingsDone: report.task_ratings_done as boolean,
          taskSpecialOrdersDone: report.task_special_orders_done as boolean,
          taskSchedulesDone: report.task_schedules_done as boolean,
          netSalesCents: settledToday?.netCents ?? null,
          countedLines: premadeRows.filter((r) => r.made !== null || r.leftover !== null).length,
          scheduledLines: premadeRows.length,
          countedBatches: elementRows.filter((r) => r.yieldCount !== null).length,
          scheduledBatches: elementRows.length,
        }}
      />
    ),
  };

  if (wants("sales")) {
    bodies.sales = (
      <SalesPage
        key="sales"
        reportId={id}
        locationId={report.location_id as string}
        reportDate={reportDate}
        settled={settledToday}
        lastWeek={salesByDate.get(lastWeekDate) ?? { netCents: null, tipsCents: null }}
        lastWeekDate={lastWeekDate}
        lastYear={salesByDate.get(lastYearDate) ?? { netCents: null, tipsCents: null }}
        lastYearDate={lastYearDate}
      />
    );
  }

  if (wants("premades")) {
    bodies.premades = (
      <PremadesPage
        key="premades"
        reportId={id}
        orgId={report.org_id as string}
        scheduleTitle={scheduleTitle}
        rows={premadeRows}
        editable={editable}
      />
    );
  }

  if (wants("elements")) {
    bodies.elements = (
      <ElementsPage
        key="elements"
        reportId={id}
        orgId={report.org_id as string}
        rows={elementRows}
        editable={editable}
      />
    );
  }

  if (wants("tomorrow")) {
    bodies.tomorrow = (
      <TomorrowPage
        key="tomorrow"
        reportId={id}
        nextProductionDate={nextDay}
        kitchenId={kitchenId}
        kitchenCode={kitchenCode}
        locations={session.activeLocations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
        }))}
        plans={
          ((plans as Record<string, unknown>[] | null) ?? []) as React.ComponentProps<
            typeof TomorrowPage
          >["plans"]
        }
        orders={orders}
        schedules={schedules}
        specialOrdersDone={report.task_special_orders_done as boolean}
        schedulesDone={report.task_schedules_done as boolean}
        editable={editable}
        // Stamping `printed_at` goes through `mark_schedule_printed`, which is
        // supervisor+ — the table's own UPDATE policy is purchaser+, so a
        // direct write would change zero rows and return no error.
        stampable={canEnterCounts(role)}
      />
    );
  }

  // Everything the email says except the sales figure, which is only known
  // once the Sales page has asked Square — the runner merges that in at Send.
  const emailReport: EmailReport = {
    orgName: session.orgName,
    locationCode,
    locationName: session.locations.find((l) => l.id === report.location_id)?.name ?? locationCode,
    reportDate,
    shift,
    supervisorName: report.supervisor_employee_id
      ? nameById.get(report.supervisor_employee_id as string) ?? null
      : null,
    narrative: (report.narrative as string | null) ?? null,
    netSalesCents: settledToday?.netCents ?? null,
    tipsCents: settledToday?.tipsCents ?? null,
    salesAreProvisional: false,
    lastWeekNetCents: salesByDate.get(lastWeekDate)?.netCents ?? null,
    lastYearNetCents: salesByDate.get(lastYearDate)?.netCents ?? null,
    premades: premadeRows.map((r) => ({
      name: r.name,
      par: r.par,
      made: r.made,
      leftover: r.leftover,
    })),
    elements: elementRows.map((r) => ({
      name: r.elementName,
      yield: r.yieldCount === null ? null : `${r.yieldCount}${r.yieldUnit ? ` ${r.yieldUnit}` : ""}`,
      status: r.status,
    })),
    ratings: ratingRows.map((r) => ({
      employeeName: r.employeeName,
      position: r.position,
      score: r.score,
      note: r.note,
      gotBreak: r.gotBreak,
      breakReason: r.breakReason,
    })),
  };

  return (
    <ShiftReportRunner
      reportId={id}
      shift={shift}
      isSent={isSent}
      canSend={canSend}
      emailReport={emailReport}
      pages={bodies}
    />
  );
}
