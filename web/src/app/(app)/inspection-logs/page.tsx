import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { INSPECTION_SELECT } from "@/lib/inspections";
import { isTaskOpen, type TaskStatus } from "@/lib/facilityTasks";
import { InspectionsList, type InspectionRow } from "@/components/inspections/InspectionsList";
import { NewInspection } from "@/components/inspections/NewInspection";

/**
 * Inspection logs — the record of every inspector's visit to this shop (093).
 *
 * Until 2026-09-05 this was `checklist_runs` filtered to `kind = 'inspection'`:
 * a template somebody walked. Mark: "conceptually I think of the inspection
 * log as a record of a visit by the health inspector … not a walk. No need for
 * a template." So it reads `inspections` — the date, the score, the report on
 * file and the tasks raised from it — and starts a record rather than a walk.
 */
export default async function InspectionLogsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;
  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  const [{ data: inspections, error }, { data: types }] = await Promise.all([
    supabase
      .from("inspections")
      .select(INSPECTION_SELECT)
      .eq("location_id", active.id)
      .order("inspected_on", { ascending: false }),
    // Every type ever recorded, org-wide — the create dialog's vocabulary.
    supabase.from("inspections").select("inspection_type").eq("org_id", session.membership.org_id),
  ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the inspection logs: {error.message}
        {/relation .* does not exist|inspections/.test(error.message) &&
          " — migration 093 has not been applied yet."}
      </p>
    );
  }

  const ids = (inspections ?? []).map((i) => i.id);
  const documentCount = new Map<string, number>();
  const openTasks = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: docs }, { data: tasks }] = await Promise.all([
      supabase.from("facility_photos").select("inspection_id").in("inspection_id", ids),
      supabase.from("location_tasks").select("source_inspection_id, status").in("source_inspection_id", ids),
    ]);
    for (const d of docs ?? []) {
      const k = d.inspection_id as string;
      documentCount.set(k, (documentCount.get(k) ?? 0) + 1);
    }
    for (const t of tasks ?? []) {
      if (!isTaskOpen({ status: t.status as TaskStatus })) continue;
      const k = t.source_inspection_id as string;
      openTasks.set(k, (openTasks.get(k) ?? 0) + 1);
    }
  }

  const rows: InspectionRow[] = (inspections ?? []).map((i) => ({
    id: i.id,
    inspected_on: i.inspected_on,
    inspection_type: i.inspection_type,
    inspector: i.inspector,
    score: i.score,
    violations: i.violations,
    document_count: documentCount.get(i.id) ?? 0,
    open_tasks: openTasks.get(i.id) ?? 0,
  }));

  const editable = canEditPage(session.membership.role, "/inspection-logs");
  const typeList = [...new Set((types ?? []).map((t) => t.inspection_type as string).filter(Boolean))].sort();

  return (
    <InspectionsList
      key={active.id}
      rows={rows}
      locationCode={active.code}
      action={
        editable && (
          <NewInspection
            orgId={session.membership.org_id}
            locationId={active.id}
            today={today}
            types={typeList}
          />
        )
      }
    />
  );
}
