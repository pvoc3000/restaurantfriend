import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canResolveTasks } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { TaskKind } from "@/lib/facilityTasks";
import { NewTask } from "./NewTask";
import { TasksScreen, type TaskRow } from "./TasksScreen";
import { loadAssignees, loadTaskPhotos } from "./taskLoaders";

/**
 * The server half of BOTH task screens.
 *
 * One loader, because `/tasks` and `/maintenance-requests` are one table seen
 * through `kind` — and two copies of this query is how they would start
 * disagreeing about what a task is.
 */
export async function TasksPage({
  kind,
  openRowKey,
}: {
  kind: TaskKind;
  openRowKey?: string;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  const [{ data: tasks, error }, { data: equipment }, { data: sections }] =
    await Promise.all([
      supabase
        .from("location_tasks")
        .select(
          "id, kind, title, details, status, priority, target_shift, due_on, carry_forward, created_at, equipment_id, shop_section_id, source_run_item_id, assigned_to",
        )
        .eq("location_id", active.id)
        .eq("kind", kind)
        .order("created_at", { ascending: false }),
      supabase
        .from("equipment")
        .select("id, name, shop_section_id")
        .eq("location_id", active.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("shop_sections")
        .select("id, display_name")
        .eq("location_id", active.id)
        .order("sort_order"),
    ]);

  const assignees = await loadAssignees(supabase);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load them: {error.message}
        {/assigned_to/.test(error.message)
          ? " — migration 079 has not been applied yet."
          : error.message.includes("location_tasks")
            ? " — migration 075 has not been applied yet."
            : null}
      </p>
    );
  }

  const photosByTask = await loadTaskPhotos(
    supabase,
    (tasks ?? []).map((t) => t.id as string),
  );

  const equipmentName = new Map(
    (equipment ?? []).map((e) => [e.id as string, e.name as string]),
  );
  const sectionName = new Map(
    (sections ?? []).map((s) => [s.id as string, s.display_name as string]),
  );

  const rows: TaskRow[] = (tasks ?? []).map((t) => ({
    id: t.id as string,
    kind: t.kind as TaskKind,
    title: t.title as string,
    details: (t.details as string | null) ?? null,
    status: t.status as TaskRow["status"],
    priority: t.priority as TaskRow["priority"],
    target_shift: (t.target_shift as string | null) ?? null,
    due_on: (t.due_on as string | null) ?? null,
    carry_forward: t.carry_forward as boolean,
    created_at: t.created_at as string,
    equipment_id: (t.equipment_id as string | null) ?? null,
    equipment_name: t.equipment_id
      ? (equipmentName.get(t.equipment_id as string) ?? null)
      : null,
    shop_section_id: (t.shop_section_id as string | null) ?? null,
    section_name: t.shop_section_id
      ? (sectionName.get(t.shop_section_id as string) ?? null)
      : null,
    from_walk: t.source_run_item_id != null,
    assigned_to: (t.assigned_to as string | null) ?? null,
    photos: photosByTask.get(t.id as string) ?? [],
  }));


  // ONE projection for both consumers. The create dialog needs the equipment's
  // own section, so that picking a fryer can fill in where the fryer stands.
  const equipmentOptions = (equipment ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    shop_section_id: (e.shop_section_id as string | null) ?? null,
  }));
  const sectionOptions = (sections ?? []).map((s) => ({
    id: s.id as string,
    display_name: s.display_name as string,
  }));

  return (
    <div className="space-y-6">
      <TasksScreen
        key={`${active.id}:${kind}`}
        rows={rows}
        kind={kind}
        today={today}
        action={
          // KEYED: this element is made HERE, on the server, and rendered by a
          // client component (TasksScreen → PageHeading). React 19's dev build
          // counts an unkeyed server element in that slot as a list child and
          // logs "Each child in a list should have a unique key".
          canResolveTasks(session.membership.role) && (
            <NewTask
              key="new-task"
              kind={kind}
              orgId={session.membership.org_id}
              locationId={active.id}
              equipment={equipmentOptions}
              sections={sectionOptions}
              assignees={assignees}
            />
          )
        }
        orgId={session.membership.org_id}
        locationCode={active.code}
        editable={canResolveTasks(session.membership.role)}
        equipment={equipmentOptions}
        sections={sectionOptions.map((s) => ({
          id: s.id,
          display_name: s.display_name,
        }))}
        assignees={assignees}
        openRowKey={openRowKey}
      />
    </div>
  );
}
