import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canResolveTasks } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { currentQuery, parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import {
  TASK_LIST,
  taskDetailPath,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/facilityTasks";
import { loadAssignees, loadTaskPhotos } from "./taskLoaders";
import { TaskRecord, type TaskRecordData } from "./TaskRecord";
import type { EventLogRow } from "@/components/ui/EventLog";

/** How much history one page shows; older entries are counted, not drawn. */
const HISTORY_CAP = 200;

/**
 * The server half of a task's record, for BOTH routes — `/tasks/[id]` and
 * `/maintenance-requests/[id]` — as `TasksPage` is for both lists.
 *
 * A record is not bound to the working location (CLAUDE.md design rule 3:
 * RECORD screens aren't, OPERATIONAL ones are), so everything here is read at
 * the TASK's own shop, which is what its section and equipment pickers need.
 */
export async function TaskDetail({
  kind,
  id,
  rawParams,
}: {
  kind: TaskKind;
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from("location_tasks")
    .select(
      "id, org_id, location_id, kind, title, details, status, priority, target_shift, due_on, carry_forward, created_at, created_by, equipment_id, shop_section_id, source_run_item_id, assigned_to, vendor_id, resolution_note, done_at, done_by",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load this {kind === "maintenance" ? "request" : "task"}: {error.message}
      </p>
    );
  }
  if (!task) notFound();

  // Moved to the other list since the link was made ("Make it a task") — send
  // the reader to where it lives now, carrying the trail with it.
  if (task.kind !== kind) {
    redirect(taskDetailPath(task.kind as TaskKind, id) + currentQuery(rawParams));
  }

  const locationId = task.location_id as string;
  const [
    { data: equipment },
    { data: sections },
    { data: vendors },
    { data: events, count: eventCount },
    assignees,
    photosByTask,
  ] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, is_active")
      .eq("location_id", locationId)
      .order("name"),
    supabase
      .from("shop_sections")
      .select("id, display_name")
      .eq("location_id", locationId)
      .order("sort_order"),
    supabase.from("vendors").select("id, name, is_active").order("name"),
    supabase
      .from("location_task_events")
      .select("id, happened_at, author, message, source", { count: "exact" })
      .eq("task_id", id)
      .order("happened_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(HISTORY_CAP),
    loadAssignees(supabase),
    loadTaskPhotos(supabase, [id]),
  ]);

  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const nameOf = new Map(assignees.map((a) => [a.user_id, a.name]));
  const createdBy = task.created_by ? (nameOf.get(task.created_by as string) ?? null) : null;

  // An inactive unit or vendor stays offered ONLY when it is the one already
  // chosen — otherwise the picker would show a blank where the value is.
  const keep = <T extends { id: string; is_active: boolean }>(rows: T[], current: unknown) =>
    rows.filter((r) => r.is_active || r.id === current);

  const history: EventLogRow[] = (events ?? []).map((e) => ({
    id: e.id as string,
    when: stamp.format(new Date(e.happened_at as string)),
    author: (e.author as string | null) ?? null,
    message: e.message as string,
    quiet: e.source === "app",
  }));

  const data: TaskRecordData = {
    id,
    orgId: task.org_id as string,
    kind,
    title: task.title as string,
    details: (task.details as string | null) ?? null,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    target_shift: (task.target_shift as string | null) ?? null,
    due_on: (task.due_on as string | null) ?? null,
    carry_forward: task.carry_forward as boolean,
    created_at: task.created_at as string,
    equipment_id: (task.equipment_id as string | null) ?? null,
    shop_section_id: (task.shop_section_id as string | null) ?? null,
    assigned_to: (task.assigned_to as string | null) ?? null,
    vendor_id: (task.vendor_id as string | null) ?? null,
    from_walk: task.source_run_item_id != null,
    locationCode:
      session.locations.find((l) => l.id === locationId)?.code ?? "",
    flagged: `${createdBy ? `Flagged by ${createdBy}` : "Flagged"} on ${day.format(
      new Date(task.created_at as string),
    )}`,
  };

  const trail = parseTrail(rawParams, TASK_LIST[kind]);

  return (
    <TaskRecord
      // KEYED by the record AND the two values it seeds local state from
      // (conventions: a client component seeding `useState` from server data
      // is keyed by that data's identity) — walking to the next record, or a
      // refresh carrying somebody else's status change, re-seeds it.
      key={`${id}:${task.status}:${task.carry_forward}`}
      task={data}
      trail={trail}
      today={today}
      editable={canResolveTasks(session.membership.role)}
      equipment={keep(
        (equipment ?? []).map((e) => ({
          id: e.id as string,
          name: e.name as string,
          is_active: e.is_active as boolean,
        })),
        task.equipment_id,
      )}
      sections={(sections ?? []).map((s) => ({
        id: s.id as string,
        display_name: s.display_name as string,
      }))}
      vendors={keep(
        (vendors ?? []).map((v) => ({
          id: v.id as string,
          name: v.name as string,
          is_active: v.is_active as boolean,
        })),
        task.vendor_id,
      )}
      assignees={assignees}
      photos={photosByTask.get(id) ?? []}
      history={history}
      historyTotal={eventCount ?? history.length}
    />
  );
}
