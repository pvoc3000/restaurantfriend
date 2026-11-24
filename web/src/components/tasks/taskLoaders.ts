import type { SupabaseClient } from "@supabase/supabase-js";
import { canResolveTasks } from "@/lib/roles";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import type { TaskPhoto } from "./TaskPhotos";
import type { Assignee } from "./TasksScreen";

/**
 * The two reads the task list and the task record share. One copy each, so
 * the two screens cannot start disagreeing about who a task can be handed to
 * or which photographs belong to it.
 */

/**
 * WHO A TASK CAN BE HANDED TO (079). `org_members`, not `employees`: a
 * checklist is walked by somebody signed in, and 001's `members_read` shows
 * every member of your own org, so this needs no definer function — unlike
 * 053's `special_order_takers`, which exists because `employees` READ is
 * owner/admin. A member with no `display_name` has been invited and has never
 * signed in; they are still offered, named by their id's head, because
 * withholding them would make the list quietly incomplete.
 */
export async function loadAssignees(supabase: SupabaseClient): Promise<Assignee[]> {
  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, display_name, role");

  return (members ?? [])
    .filter((m) => canResolveTasks(m.role as never))
    .map((m) => ({
      user_id: m.user_id as string,
      name:
        (m.display_name as string | null)?.trim() ||
        `Member ${(m.user_id as string).slice(0, 8)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The photos, SCOPED to the tasks asked for and signed in ONE batch —
 * `loadChecklistRun`'s shape, and its lesson: an org-wide select is capped at
 * 1,000 rows by PostgREST with no error, so a shop's older photographs would
 * simply stop appearing one day with nothing to see.
 */
export async function loadTaskPhotos(
  supabase: SupabaseClient,
  taskIds: string[],
): Promise<Map<string, TaskPhoto[]>> {
  const byTask = new Map<string, TaskPhoto[]>();
  if (taskIds.length === 0) return byTask;

  const { data: photoRows } = await supabase
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

  for (const p of photoRows ?? []) {
    const tid = p.task_id as string;
    const list = byTask.get(tid) ?? [];
    list.push({
      id: p.id as string,
      storage_path: p.storage_path as string,
      file_name: (p.file_name as string | null) ?? null,
      url: signed.get(p.storage_path as string) ?? null,
    });
    byTask.set(tid, list);
  }
  return byTask;
}
