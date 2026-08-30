import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditChecklists, canWalkChecklists } from "@/lib/roles";
import { daysBefore, serverTimeZone, todayInTimeZone } from "@/lib/today";
import {
  parseChecklistView,
  templatesForShift,
  type ScheduledTemplate,
} from "@/lib/checklists";
import type { RawSearchParams } from "@/lib/itemFilters";
import { ChecklistsScreen } from "@/components/checklists/ChecklistsScreen";
import type { RunRow, StartableTemplate } from "@/components/checklists/ChecklistsList";
import type { TemplateRow } from "@/components/checklists/ChecklistTemplatesList";

/** How far back the walks list looks. A walk is a daily record; a month is
 *  plenty to answer "did anybody do Tuesday" without paginating. */
const WINDOW_DAYS = 30;

/**
 * Checklists — the walks, and the master lists that produce them.
 *
 * ONE SCREEN since 2026-08-30 (Mark), where it was two. Both halves are fetched
 * on every load rather than per view, which costs one extra query and buys two
 * things: the tab counts are honest before you switch, and the walks view needs
 * the templates anyway — that is what "asked for today, not walked" is computed
 * from.
 */
export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const view = parseChecklistView(params.view);
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const tz = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(tz);
  const since = daysBefore(today, WINDOW_DAYS);

  const [{ data: runs, error }, { data: allTemplates, error: templateError }] =
    await Promise.all([
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
        .select("id, kind, name, weekdays, shifts, is_active, notes")
        .eq("location_id", active.id)
        .order("name"),
    ]);

  if (error || templateError) {
    const message = error?.message ?? templateError?.message ?? "";
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the checklists: {message}
        {/checklist_runs|checklist_templates/.test(message) &&
          " — migration 076 has not been applied yet."}
      </p>
    );
  }

  // Per-run progress and per-template item counts, both tallied from one narrow
  // column each. PAGINATED: PostgREST caps a page at 1,000 silently, and a
  // truncated count reads exactly like a real one.
  const runIds = new Set((runs ?? []).map((r) => r.id as string));
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  const issues = new Map<string, number>();
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

  const itemCounts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error: countError } = await supabase
      .from("checklist_template_items")
      .select("template_id")
      .eq("is_active", true)
      .order("id")
      .range(from, from + 999);
    if (countError) break;
    for (const row of data ?? []) {
      const id = row.template_id as string;
      itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1);
    }
    if ((data ?? []).length < 1000) break;
  }

  const runRows: RunRow[] = (runs ?? []).map((r) => ({
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

  const templateRows: TemplateRow[] = (allTemplates ?? []).map((t) => ({
    id: t.id as string,
    kind: t.kind as TemplateRow["kind"],
    name: t.name as string,
    weekdays: (t.weekdays as number[] | null) ?? null,
    shifts: (t.shifts as string[] | null) ?? null,
    is_active: t.is_active as boolean,
    notes: (t.notes as string | null) ?? null,
    item_count: itemCounts.get(t.id as string) ?? 0,
  }));

  // ── What today still wants ────────────────────────────────────────────────
  // ISO weekday from the ORG's own date string, not `new Date().getDay()` —
  // that reads the host's clock, and getDay() is 0=Sunday where every array in
  // this schema is 1=Monday.
  const isoWeekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const todaysRuns = (runs ?? []).filter((r) => r.business_date === today);

  const startable: StartableTemplate[] = templateRows
    .filter((t) => t.is_active)
    .map((t) => {
      const scheduled: ScheduledTemplate = {
        id: t.id,
        kind: t.kind,
        is_active: t.is_active,
        weekdays: t.weekdays,
        shifts: t.shifts,
      };
      // "Asked for today" means asked for on ANY of the shifts it names — the
      // list offers the walk, and which shift it belongs to is chosen when it
      // is started.
      const askedToday = (["opening", "mid", "closing", "off_site"] as const).some(
        (sh) => templatesForShift([scheduled], isoWeekday, sh).length > 0,
      );
      return {
        id: t.id,
        name: t.name,
        kind: t.kind,
        shifts: t.shifts,
        asked_today: askedToday,
        already_run_today: todaysRuns.some((r) => r.template_id === t.id),
      };
    });

  return (
    // Keyed for /shop-sections' reason: switching location is a navigation to
    // this same route, so without it the search box and the chosen tier keep
    // the state you left against the other shop's rows.
    <ChecklistsScreen
      key={active.id}
      view={view}
      runs={runRows}
      startable={startable}
      templates={templateRows}
      today={today}
      windowDays={WINDOW_DAYS}
      orgId={session.membership.org_id}
      locationId={active.id}
      locationCode={active.code}
      canWalk={canWalkChecklists(session.membership.role)}
      canEdit={canEditChecklists(session.membership.role)}
    />
  );
}
