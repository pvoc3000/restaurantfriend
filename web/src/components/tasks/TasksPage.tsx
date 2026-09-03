import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canResolveTasks } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { TaskKind } from "@/lib/facilityTasks";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { NewTask } from "./NewTask";
import { TasksScreen, type Assignee, type TaskRow } from "./TasksScreen";

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

  // WHO A TASK CAN BE HANDED TO (079). `org_members`, not `employees`: a
  // checklist is walked by somebody signed in, and 001's `members_read` shows
  // every member of your own org, so this needs no definer function — unlike
  // 053's `special_order_takers`, which exists because `employees` READ is
  // owner/admin. A member with no `display_name` has been invited and has never
  // signed in; they are still offered, named by their id's head, because
  // withholding them would make the list quietly incomplete.
  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, display_name, role");

  const assignees: Assignee[] = (members ?? [])
    .filter((m) => canResolveTasks(m.role as never))
    .map((m) => ({
      user_id: m.user_id as string,
      name:
        (m.display_name as string | null)?.trim() ||
        `Member ${(m.user_id as string).slice(0, 8)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

  // The photos, SCOPED to the tasks on screen and signed in ONE batch —
  // `loadChecklistRun`'s shape, and its lesson: an org-wide select is capped at
  // 1,000 rows by PostgREST with no error, so a shop's older photographs would
  // simply stop appearing one day with nothing to see.
  const taskIds = (tasks ?? []).map((t) => t.id as string);
  const { data: photoRows } =
    taskIds.length === 0
      ? { data: [] as Record<string, unknown>[] }
      : await supabase
          .from("facility_photos")
          .select("id, task_id, storage_path, file_name")
          .in("task_id", taskIds);

  const signed = new Map<string, string>();
  const paths = (photoRows ?? []).map((p) => p.storage_path as string);
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const photosByTask = new Map<string, TaskRow["photos"]>();
  for (const p of photoRows ?? []) {
    const tid = p.task_id as string;
    const list = photosByTask.get(tid) ?? [];
    list.push({
      id: p.id as string,
      storage_path: p.storage_path as string,
      file_name: (p.file_name as string | null) ?? null,
      url: signed.get(p.storage_path as string) ?? null,
    });
    photosByTask.set(tid, list);
  }

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

  const heading = kind === "maintenance" ? "Maintenance Requests" : "Tasks";

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
      {/* The create command sits BESIDE THE TITLE, which is what `/checklists`
          and `/inspection-logs` already did — this screen and `/equipment` were
          the two that kept it in a `justify-end` row above the filters, where
          it reads as one more filter. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {heading}
        </h1>
        {canResolveTasks(session.membership.role) && (
          <NewTask
            kind={kind}
            orgId={session.membership.org_id}
            locationId={active.id}
            equipment={equipmentOptions}
            sections={sectionOptions}
            assignees={assignees}
          />
        )}
      </div>

      <TasksScreen
        key={`${active.id}:${kind}`}
        rows={rows}
        kind={kind}
        today={today}
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
