import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWalkChecklists } from "@/lib/roles";
import { daysBefore, serverTimeZone, todayInTimeZone } from "@/lib/today";
import { templatesForShift, type ScheduledTemplate } from "@/lib/checklists";
import { ChecklistsList, type RunRow, type StartableTemplate } from "@/components/checklists/ChecklistsList";

/** How far back the list looks. A walk is a daily record; a month is plenty to
 *  answer "did anybody do Tuesday" without paginating. */
const WINDOW_DAYS = 30;

/**
 * The walks — what has been done, and what tonight still wants.
 *
 * The attention half is the thing that makes this a routine rather than a form:
 * `locations.open_days` (017) says which days the shop is open, so "nobody
 * walked the closing list" is a FACT rather than an absence — the same argument
 * `/shift-reports`' own attention tier makes.
 */
export default async function ChecklistsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const tz = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(tz);
  const since = daysBefore(today, WINDOW_DAYS);
  const editable = canWalkChecklists(session.membership.role);

  const [{ data: runs, error }, { data: templates }] = await Promise.all([
    supabase
      .from("checklist_runs")
      .select(
        "id, kind, title, business_date, shift, status, submitted_at, template_id, shift_report_id",
      )
      .eq("location_id", active.id)
      .gte("business_date", since)
      .order("business_date", { ascending: false }),
    supabase
      .from("checklist_templates")
      .select("id, kind, name, weekdays, shifts, is_active")
      .eq("location_id", active.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the walks: {error.message}
        {error.message.includes("checklist_runs") &&
          " — migration 076 has not been applied yet."}
      </p>
    );
  }

  // Per-run progress, from one narrow column. Paginated for PostgREST's silent
  // 1,000-row cap — a truncated count reads exactly like a real one.
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  const issues = new Map<string, number>();
  const runIds = new Set((runs ?? []).map((r) => r.id as string));
  for (let from = 0; ; from += 1000) {
    const { data, error: itemError } = await supabase
      .from("checklist_run_items")
      .select("run_id, status")
      .order("id")
      .range(from, from + 999);
    if (itemError) break;
    for (const row of data ?? []) {
      const rid = row.run_id as string;
      if (!runIds.has(rid)) continue;
      total.set(rid, (total.get(rid) ?? 0) + 1);
      if (row.status !== "pending") done.set(rid, (done.get(rid) ?? 0) + 1);
      if (row.status === "issue") issues.set(rid, (issues.get(rid) ?? 0) + 1);
    }
    if ((data ?? []).length < 1000) break;
  }

  const rows: RunRow[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as RunRow["kind"],
    title: r.title as string,
    business_date: r.business_date as string,
    shift: (r.shift as string | null) ?? null,
    status: r.status as RunRow["status"],
    item_count: total.get(r.id as string) ?? 0,
    done_count: done.get(r.id as string) ?? 0,
    issue_count: issues.get(r.id as string) ?? 0,
    in_shift_report: r.shift_report_id != null,
  }));

  // ── What today still wants ────────────────────────────────────────────────
  // ISO weekday from the ORG's own date string, not `new Date().getDay()` —
  // that reads the host's clock, and getDay() is 0=Sunday where every array in
  // this schema is 1=Monday.
  const isoWeekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const scheduled = (templates ?? []).map(
    (t) =>
      ({
        id: t.id as string,
        kind: t.kind as ScheduledTemplate["kind"],
        is_active: t.is_active as boolean,
        weekdays: (t.weekdays as number[] | null) ?? null,
        shifts: (t.shifts as string[] | null) ?? null,
      }) satisfies ScheduledTemplate,
  );

  const todaysRuns = (runs ?? []).filter((r) => r.business_date === today);
  const startable: StartableTemplate[] = (templates ?? []).map((t) => {
    const s = scheduled.find((x) => x.id === t.id)!;
    // "Asked for today" means asked for on ANY of the shifts it names — the
    // list offers the walk, and which shift it belongs to is chosen when it is
    // started.
    const askedToday = (["opening", "mid", "closing", "off_site"] as const).some((sh) =>
      templatesForShift([s], isoWeekday, sh).length > 0,
    );
    return {
      id: t.id as string,
      name: t.name as string,
      kind: t.kind as StartableTemplate["kind"],
      shifts: (t.shifts as string[] | null) ?? null,
      asked_today: askedToday,
      already_run_today: todaysRuns.some((r) => r.template_id === t.id),
    };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Checklists
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          What has been walked at {active.code} in the last {WINDOW_DAYS} days, and
          what today still wants. A walk records what a named person saw, at a
          time — so it is superseded, never erased.
        </p>
      </div>

      <ChecklistsList
        key={active.id}
        rows={rows}
        startable={startable}
        today={today}
        orgId={session.membership.org_id}
        locationId={active.id}
        locationCode={active.code}
        editable={editable}
      />
    </div>
  );
}
