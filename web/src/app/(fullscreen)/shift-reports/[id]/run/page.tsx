import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts, canReadHr } from "@/lib/roles";
import { daysBefore, serverTimeZone, todayInTimeZone } from "@/lib/today";
import { compareForPremadeSheet } from "@/lib/productionSchedule";
import { isDayComplete } from "@/lib/sales";
import {
  pagesForShift,
  submitBlockers,
  submitReadiness,
  type EmailReport,
  type ReadinessInput,
  type ShiftReportPage,
  type ShiftSlot,
} from "@/lib/shiftReports";
import { loadChecklistRun } from "@/lib/checklistRunData";
import {
  outstandingCount,
  templatesForShift,
  type ChecklistKind,
} from "@/lib/checklists";
import { ChecklistPage } from "@/components/operations/pages/ChecklistPage";
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

/**
 * The ratings, with a ONE-SHOT RETRY without `break_started_at`.
 *
 * 071 adds that column and migrations are applied by hand, so between a deploy
 * and the SQL editor the select would 400 and — because this query's error is
 * not fatal to the page — the ratings would render as NONE. Somebody testing
 * would reasonably conclude their ratings had been lost.
 *
 * `BatchLogRecord`'s pattern: ask for everything, and if the message names the
 * new column, ask again without it. The break time then reads as unrecorded,
 * which is exactly what it is until the migration runs.
 */
async function ratingsQuery(supabase: SupabaseClient, reportId: string) {
  const full = await supabase
    .from("shift_report_ratings")
    .select("id, employee_id, position, score, note, got_break, break_started_at, break_reason")
    .eq("report_id", reportId)
    .order("created_at");

  if (!full.error || !/break_started_at/.test(full.error.message)) return full;

  return supabase
    .from("shift_report_ratings")
    .select("id, employee_id, position, score, note, got_break, break_reason")
    .eq("report_id", reportId)
    .order("created_at");
}

/**
 * The draft counts, with a ONE-SHOT RETRY without `note`.
 *
 * 081 adds that column and migrations are applied by hand, so between a deploy
 * and the SQL editor this select would 400 — and because the whole draft map
 * would come back null, EVERY count already typed would render as empty. A
 * supervisor mid-shift would reasonably conclude the report had lost their
 * work.
 *
 * `ratingsQuery`'s pattern, thirty lines up and there for exactly this reason
 * (071's `break_started_at`): ask for everything, and if the message names the
 * new column, ask again without it. The note then reads as unrecorded, which is
 * precisely what it is until the migration runs.
 */
async function countsQuery(supabase: SupabaseClient, reportId: string) {
  const full = await supabase
    .from("shift_report_counts")
    .select("schedule_item_id, made, leftover, note")
    .eq("report_id", reportId);

  if (!full.error || !/note/.test(full.error.message)) return full;

  return supabase
    .from("shift_report_counts")
    .select("schedule_item_id, made, leftover")
    .eq("report_id", reportId);
}

/** The packet's comparator over the runner's own row shape. */
const compareRows = (a: PremadeRow, b: PremadeRow) =>
  compareForPremadeSheet(
    { item_type: a.itemType, size: a.size, subtype: a.subtype, item_name: a.name },
    { item_type: b.itemType, size: b.size, subtype: b.subtype, item_name: b.name }
  );

/** Standing in for a query this shift does not need. The employee record's
 *  tab-fetching idiom: only the pages in play cost anything. */
const SKIP = { data: null, error: null } as const;

export default async function RunShiftReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /**
   * `?page=2` — where to open, 1-based.
   *
   * Only the create dialog passes it, and it passes 2 because page 1 restates
   * that dialog (Mark, 2026-09-01). A parameter rather than a rule inside the
   * runner, because "skip the first page" is true of the moment a report is
   * CREATED and false of resuming one: coming back to a paused report should
   * land where it always has.
   */
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
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
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);

  // ── The checklist linked to this report ─────────────────────────────────
  //
  // The link is an FK on the RUN, never a (location, date, shift) tuple: 070
  // declined a unique constraint on that tuple because a handover legitimately
  // produces two reports for one night, so the tuple does not identify one and
  // a join on it would attach a walk to the wrong report.
  const { data: linkedRuns } = await supabase
    .from("checklist_runs")
    .select("id, title, status")
    .eq("shift_report_id", id)
    .order("started_at");

  const linkedRun = (linkedRuns ?? [])[0] ?? null;

  // What this shift is ASKED for, so "nobody started it" is a fact rather than
  // an absence — the same argument the list's attention band makes.
  const { data: shiftTemplates } = await supabase
    .from("checklist_templates")
    .select("id, kind, name, weekdays, shifts, is_active")
    .eq("location_id", report.location_id as string)
    .eq("is_active", true);

  const reportWeekday =
    ((new Date(`${report.report_date as string}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const askedFor = templatesForShift(
    (shiftTemplates ?? []).map((t) => ({
      id: t.id as string,
      kind: t.kind as "checklist" | "walkthrough" | "inspection",
      is_active: t.is_active as boolean,
      weekdays: (t.weekdays as number[] | null) ?? null,
      shifts: (t.shifts as string[] | null) ?? null,
    })),
    reportWeekday,
    shift,
  );

  const walk = linkedRun ? await loadChecklistRun(supabase, linkedRun.id as string, session.userId) : null;
  const walkItems = walk?.data?.items ?? [];

  // ONE object, two consumers. `finished` and "not started" are each one
  // expression, so the submit page's caveat and the emailed section cannot come
  // to different answers about the same night — which is the whole reason
  // `EmailReport` mirrors `ReadinessInput`'s two-field shape.
  //
  // A PROJECTION, not a decision: what counts as an issue, what an n/a does and
  // what an empty run says are all decided in `lib/shiftReports`, where the
  // fixtures can reach them. `position` and `checked_by` are not carried — see
  // `EmailChecklistItem`. The items are NOT re-sorted: `loadChecklistRun`
  // orders by `sort`, which is the walk's order and therefore the screen's, so
  // when the walk-order question is settled one fix moves all three surfaces.
  const emailChecklist: EmailReport["checklist"] = walk?.data
    ? {
        kind: walk.data.run.kind as ChecklistKind,
        title: walk.data.run.title,
        finished: walk.data.run.status === "submitted",
        items: walkItems.map((i) => ({
          status: i.status,
          prompt: i.prompt,
          sectionName: i.section_name,
          equipmentName: i.equipment_name,
          note: i.note,
          valueNumber: i.value_number,
          unit: i.unit,
          minValue: i.min_value,
          maxValue: i.max_value,
        })),
      }
    : null;

  const checklistReadinessInput = emailChecklist
    ? {
        outstanding: outstandingCount(walkItems),
        total: walkItems.length,
        finished: emailChecklist.finished,
      }
    : null;

  const checklistNotStarted = !linkedRun && askedFor.length > 0;
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
    { data: supervisorRows },
    { data: positionRows },
    { data: ratings },
    { data: todaySchedule },
    { data: batchLog },
    { data: salesDays },
    { data: tomorrowOrders },
    { data: tomorrowSchedules },
    { data: plans },
  ] = await Promise.all([
    supabase.rpc("special_order_takers", { p_org_id: report.org_id }),
    // Supervisors and managers only, for page 1's picker — migration 080. The
    // FULL roster above stays: it resolves the name of whoever is recorded,
    // including somebody this filter drops, and the ratings page needs all of
    // it. See `InfoPage` for why the recorded person is always offered.
    supabase.rpc("shift_supervisors", { p_org_id: report.org_id }),
    // The shop's own position vocabulary. `employees.position` is the third of
    // the three this schema carries and the one that holds the abbreviations a
    // supervisor actually writes — "DF", "Sr. DF" — where `timesheets.position`
    // holds Homebase's Role. Owner/admin only, so below that the picker falls
    // back to whatever is already on the row plus anything typed.
    canReadHr(role)
      ? supabase.from("employees").select("position").not("position", "is", null)
      : SKIP,
    ratingsQuery(supabase, id),
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
          // `synced_at` and `source` are what `isDayComplete` needs. Since
          // 2026-08-31 the sync loads TODAY as a part-day, so a stored row for
          // this date is no longer proof the day is closed — without these two
          // columns a nine-hour figure renders exactly like a settled one.
          .select("business_date, net_sales_cents, tips_cents, synced_at, source")
          .eq("location_id", report.location_id)
          .in("business_date", [reportDate, lastWeekDate, lastYearDate])
      : SKIP,
    wants("tomorrow") && nextDay
      ? supabase
          .from("special_orders")
          // ONLY THE ID. The page stopped listing these (see `TomorrowOrder`);
          // what it does with them is hand them to the packet, which fetches
          // each order's document data itself.
          .select("id")
          .eq("kind", "order")
          .eq("event_date", nextDay)
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
  const supervisorRoster = (
    (supervisorRows as { id: string; name: string }[] | null) ?? []
  ).map((t) => ({ value: t.id, label: t.name }));

  // Distinct and sorted here rather than in SQL: PostgREST has no DISTINCT, and
  // 445 rows of one short column is cheaper to de-duplicate than to think about.
  const positions = [
    ...new Set(
      ((positionRows as { position: string | null }[] | null) ?? [])
        .map((p) => (p.position ?? "").trim())
        .filter((p) => p !== "")
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((p) => ({ value: p, label: p }));

  const ratingRows: RatingRow[] = ((ratings as Record<string, unknown>[] | null) ?? []).map(
    (r) => ({
      id: r.id as string,
      employeeId: r.employee_id as string,
      employeeName: nameById.get(r.employee_id as string) ?? "Somebody",
      position: (r.position as string | null) ?? null,
      score: r.score === null ? null : Number(r.score),
      note: (r.note as string | null) ?? null,
      gotBreak: (r.got_break as boolean | null) ?? null,
      // Postgres `time` arrives as HH:MM:SS; `ui/TimeField` wants HH:MM.
      breakStartedAt: ((r.break_started_at as string | null) ?? null)?.slice(0, 5) ?? null,
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
      countsQuery(supabase, id),
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
        size: (l.size as string | null) ?? null,
        subtype: (l.subtype as string | null) ?? null,
        name: l.item_name as string,
        par: l.par === null ? null : Number(l.par),
        made: d?.made == null ? null : Number(d.made),
        leftover: d?.leftover == null ? null : Number(d.leftover),
        // TWO NOTES, kept apart: the schedule's instruction and the
        // supervisor's own. See `PremadeRow`.
        note: (l.note as string | null) ?? null,
        countNote: (d?.note as string | null) ?? null,
      };
    });
    // THE ORDER OF THE PRINTED SHEET, not the schedule's own `sort` (Mark,
    // 2026-08-28). Somebody counting leftovers is holding that sheet and
    // reading down it; a screen in a different order makes them find every row
    // twice. `compareForPremadeSheet` is the packet's own comparator.
    premadeRows.sort(compareRows);
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
  const salesRows = (salesDays as Record<string, unknown>[] | null) ?? [];
  const salesByDate = new Map(
    salesRows.map((s) => [
      s.business_date as string,
      { netCents: Number(s.net_sales_cents), tipsCents: Number(s.tips_cents) },
    ])
  );
  const storedToday = salesByDate.get(reportDate) ?? null;

  /**
   * Is the row we have for TODAY actually finished?
   *
   * `isDayComplete` answers it from `synced_at` rather than from the calendar,
   * which is that function's own point: a row pulled at 4pm and never pulled
   * again is a part-day forever, and a date test would call it settled by
   * Thursday. A row that is NOT complete is still worth showing — it is today's
   * takings so far — but it must not be shown as though Square had closed the
   * day, and the Sales page still asks Square for a fresher figure over it.
   */
  const todayRow = salesRows.find((r) => r.business_date === reportDate);
  const todayIsSettled =
    todayRow !== undefined &&
    isDayComplete(
      {
        business_date: reportDate,
        syncedAt: (todayRow.synced_at as string | null) ?? null,
        source: (todayRow.source as string | undefined) ?? undefined,
      },
      timeZone
    );
  const settledToday = todayIsSettled ? storedToday : null;

  const orders: TomorrowOrder[] = ((tomorrowOrders as Record<string, unknown>[] | null) ?? []).map(
    (o) => ({ id: o.id as string })
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

  const netSalesCents = (settledToday ?? storedToday)?.netCents ?? null;

  /**
   * WHAT IS STILL OUTSTANDING — computed ONCE, read by the submit page AND by
   * the email (Mark, 2026-09-01).
   *
   * One call rather than two, for the reason `checklistReadinessInput` above is
   * one object: the page and the email must not be able to come to different
   * answers about the same night. What the email reports is exactly what the
   * person was looking at when they pressed Send.
   *
   * It is as fresh as this render, which is the same freshness the page has —
   * every write on every page calls `router.refresh()`, so the two are rebuilt
   * together. Nothing the SEND itself does can invalidate it either: finishing
   * the checklist changes no caveat, because the "answered but not finished"
   * one was retired when sending started doing that.
   */
  const readinessInput: ReadinessInput = {
    shift,
    narrative: (report.narrative as string | null) ?? null,
    ratingCount: ratingRows.length,
    // The break answers that are not finished. These BLOCK the send — see
    // `submitBlockers` for why this one thing does when nothing else does.
    //
    // `gotBreak !== true` rather than `=== false`, so an UNANSWERED row counts:
    // the column is three-state and the checkbox only two, so a row nobody has
    // touched is null and looks exactly like "no". Treating it as answered
    // would let the commonest incomplete row through the one gate there is.
    breaks: {
      missingTime: ratingRows.filter(
        (r) => r.gotBreak === true && (r.breakStartedAt ?? "").trim() === ""
      ).length,
      missingReason: ratingRows.filter(
        (r) => r.gotBreak !== true && (r.breakReason ?? "").trim() === ""
      ).length,
    },
    taskSpecialOrdersDone: report.task_special_orders_done as boolean,
    taskSchedulesDone: report.task_schedules_done as boolean,
    netSalesCents,
    countedLines: premadeRows.filter((r) => r.made !== null || r.leftover !== null).length,
    scheduledLines: premadeRows.length,
    countedBatches: elementRows.filter((r) => r.yieldCount !== null).length,
    scheduledBatches: elementRows.length,
    // DERIVED, never a `task_checklist_done` column — see the note on
    // `ReadinessInput.checklist`.
    checklist: checklistReadinessInput,
    checklistNotStarted,
  };
  const outstanding = submitReadiness(readinessInput);
  /** The one gate — see `submitBlockers`. Read by the page AND by Send. */
  const blockers = submitBlockers(readinessInput);

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
        supervisors={supervisorRoster}
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
        positions={positions}
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
    submit: <SubmitPage key="submit" outstanding={outstanding} blockers={blockers} />,
  };

  if (wants("checklist")) {
    bodies.checklist = (
      <ChecklistPage
        key="checklist"
        reportId={id}
        orgId={report.org_id as string}
        locationId={report.location_id as string}
        reportDate={reportDate}
        shift={shift}
        run={walk?.data ?? null}
        askedFor={askedFor.map((t) => {
          const row = (shiftTemplates ?? []).find((x) => x.id === t.id);
          return { id: t.id, name: (row?.name as string) ?? "" };
        })}
        today={today}
        editable={editable}
      />
    );
  }

  if (wants("sales")) {
    bodies.sales = (
      <SalesPage
        key="sales"
        reportId={id}
        locationId={report.location_id as string}
        reportDate={reportDate}
        settled={settledToday}
        // Today's row when there IS one but it is not finished. The page shows
        // it immediately, marked provisional, and still asks Square over it.
        partial={todayIsSettled ? null : storedToday}
        lastWeek={salesByDate.get(lastWeekDate) ?? { netCents: null, tipsCents: null }}
        lastWeekDate={lastWeekDate}
        lastYear={salesByDate.get(lastYearDate) ?? { netCents: null, tipsCents: null }}
        lastYearDate={lastYearDate}
        editable={editable}
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
        // The org's calendar day, for the kitchen order's AS OF line — that is
        // the day the sheet came off the printer, not the day of the event.
        today={today}
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
    netSalesCents,
    tipsCents: (settledToday ?? storedToday)?.tipsCents ?? null,
    // A stored part-day is quoted AS a part-day. The runner overrides all three
    // of these at Send from whatever the Sales page is actually showing.
    salesAreProvisional: settledToday === null && storedToday !== null,
    lastWeekNetCents: salesByDate.get(lastWeekDate)?.netCents ?? null,
    lastYearNetCents: salesByDate.get(lastYearDate)?.netCents ?? null,
    premades: premadeRows.map((r) => ({
      name: r.name,
      par: r.par,
      made: r.made,
      leftover: r.leftover,
      // The SUPERVISOR's note, not the schedule's instruction: the email
      // reports the night, and what the kitchen was asked to do is already on
      // the packet they were handed.
      note: r.countNote,
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
    checklist: emailChecklist,
    checklistNotStarted,
    outstanding,
  };

  // 1-based in the URL because that is what the page band counts in; clamped
  // by the runner, which is the only thing that knows how many pages this
  // shift has.
  const openAt = Number(pageParam);

  return (
    <ShiftReportRunner
      reportId={id}
      shift={shift}
      isSent={isSent}
      canSend={canSend}
      emailReport={emailReport}
      pages={bodies}
      openAtPage={Number.isFinite(openAt) ? openAt : null}
      blockers={blockers}
      // Sending FINISHES the checklist (Mark, 2026-09-01), so the runner needs
      // to know whether there is one and whether it is still open. Only the id
      // and the status: the confirm that used to stand between the two acts is
      // gone with the button, and everything it named — what is outstanding,
      // what was found — is on the submit page already.
      checklistRun={
        linkedRun && linkedRun.status === "open"
          ? { id: linkedRun.id as string, title: linkedRun.title as string }
          : null
      }
    />
  );
}
