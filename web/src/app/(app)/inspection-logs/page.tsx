import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWalkChecklists } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import {
  ChecklistsList,
  type RunRow,
  type StartableTemplate,
} from "@/components/checklists/ChecklistsList";
import { StartWalk } from "@/components/checklists/StartWalk";

/**
 * Inspection logs — the SAME runs table, seen through `kind`.
 *
 * An inspection is an observation like any other: a template, a run, a named
 * person's answers. What is different about it is that nobody schedules it —
 * an inspector arrives unannounced — which is exactly what 076's nullable
 * weekday set already expresses, so this screen needs no machinery of its own.
 *
 * It is deliberately NOT date-windowed the way `/checklists` is: an inspection
 * is a handful of records a year and the one you want is usually the last one.
 */
export default async function InspectionLogsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  const [{ data: runs, error }, { data: templates }] = await Promise.all([
    supabase
      .from("checklist_runs")
      .select("id, kind, title, business_date, shift, status, template_id, shift_report_id")
      .eq("location_id", active.id)
      .eq("kind", "inspection")
      .order("business_date", { ascending: false }),
    supabase
      .from("checklist_templates")
      .select("id, kind, name, shifts")
      .eq("location_id", active.id)
      .eq("kind", "inspection")
      .eq("is_active", true)
      .order("name"),
  ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the inspection logs: {error.message}
        {error.message.includes("checklist_runs") &&
          " — migration 076 has not been applied yet."}
      </p>
    );
  }

  // SCOPED to the runs on screen, then paginated — /checklists' own note says
  // why both halves are needed.
  const runIds = (runs ?? []).map((r) => r.id as string);
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  const issues = new Map<string, number>();
  for (let from = 0; runIds.length > 0; from += 1000) {
    const { data, error: itemError } = await supabase
      .from("checklist_run_items")
      .select("run_id, status")
      .in("run_id", runIds)
      .order("id")
      .range(from, from + 999);
    if (itemError) break;
    for (const row of data ?? []) {
      const rid = row.run_id as string;
      total.set(rid, (total.get(rid) ?? 0) + 1);
      if (row.status !== "pending") done.set(rid, (done.get(rid) ?? 0) + 1);
      if (row.status === "issue") issues.set(rid, (issues.get(rid) ?? 0) + 1);
    }
    if ((data ?? []).length < 1000) break;
  }

  const rows: RunRow[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    kind: "inspection",
    title: r.title as string,
    business_date: r.business_date as string,
    shift: (r.shift as string | null) ?? null,
    status: r.status as RunRow["status"],
    item_count: total.get(r.id as string) ?? 0,
    done_count: done.get(r.id as string) ?? 0,
    issue_count: issues.get(r.id as string) ?? 0,
    in_shift_report: r.shift_report_id != null,
  }));

  // Every inspection template is startable, always — none of them is scheduled,
  // which is the whole point of an inspection.
  const startable: StartableTemplate[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    kind: "inspection",
    shifts: (t.shifts as string[] | null) ?? null,
    asked_today: false,
    // `r.template_id`, not `r.id` — this compared a RUN id against a TEMPLATE
    // id, so it was always false and the list never once said an inspection had
    // already been done today.
    already_run_today: (runs ?? []).some(
      (r) => r.business_date === today && r.template_id === t.id,
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Inspection logs
        </h1>
        <p className="text-sm text-muted">Health and physical inspection reports.</p>
      </div>

      <ChecklistsList
        key={active.id}
        rows={rows}
        startable={startable}
        locationCode={active.code}
        action={
          canWalkChecklists(session.membership.role) && (
            <StartWalk
              templates={startable}
              today={today}
              orgId={session.membership.org_id}
              locationId={active.id}
              noun="inspection log"
            />
          )
        }
      />
    </div>
  );
}
