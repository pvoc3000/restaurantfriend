import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "./facilityPhotos";
import { assignmentIsOrphaned, openTasksForRun } from "./facilityTasks";
import type { WalkItemRow } from "@/components/checklists/WalkItem";
import type { WalkTask } from "@/components/checklists/ChecklistWalk";

/**
 * Everything one walk needs, assembled once.
 *
 * TWO SCREENS CALL THIS — the standalone walk at `/checklists/[id]/run` and the
 * shift report's checklist page — because they are two doors onto one record.
 * A second copy of these queries is how the two would start disagreeing about
 * what a walk contains.
 *
 * It takes the CALLER's client, so RLS applies: a supervisor sees what 076 lets
 * them see and nothing here widens it.
 */
export type ChecklistRunData = {
  run: {
    id: string;
    org_id: string;
    location_id: string;
    template_id: string;
    kind: string;
    title: string;
    business_date: string;
    shift: string | null;
    status: string;
    notes: string | null;
    shift_report_id: string | null;
    created_by: string | null;
    started_by: string | null;
    submitted_at: string | null;
  };
  items: WalkItemRow[];
  tasks: WalkTask[];
  /**
   * Why the carried-over band cannot be trusted, or null.
   *
   * The tasks query is deliberately NOT folded into this loader's own `error`:
   * a failure there must not blank a walk whose ITEMS are the point. But it
   * must not be swallowed either — an empty band asserts that nothing is
   * outstanding at this shop, and that is the one claim the carry-forward
   * exists to make. `PlanDetail`'s rule for an unapplied migration, applied to
   * a band rather than a matrix.
   */
  taskWarning: string | null;
};

export async function loadChecklistRun(
  supabase: SupabaseClient,
  runId: string,
  /**
   * WHO IS LOOKING. 079: an assigned task appears on that person's checklist
   * and nobody else's, so the carried-task band depends on the reader.
   *
   * The VIEWER, deliberately, not the run's `started_by`: the band is derived
   * live rather than snapshotted (it is the shop's open tasks right now, not
   * part of the submitted document), and "my checklist" means the list in front
   * of me. Nothing downstream depends on it either — the emailed report's
   * checklist section is built from `checklist_run_items`, so what a reader
   * sees here cannot change what anybody is sent.
   */
  viewerId: string | null,
): Promise<{ data: ChecklistRunData | null; error: string | null }> {
  const { data: run, error } = await supabase
    .from("checklist_runs")
    .select(
      "id, org_id, location_id, template_id, kind, title, business_date, shift, status, notes, shift_report_id, created_by, started_by, submitted_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!run) return { data: null, error: null };

  // The items come FIRST and alone, because the photo query needs their ids.
  // It used to ask for every photo in the org (`.not("run_item_id", "is",
  // null)`) and filter in JS — and PostgREST caps a select at 1,000 rows with
  // NO ERROR, so on the day the org filed its thousandth photo a walk's own
  // photographs would have started disappearing off its record with nothing to
  // see. Scoped, the query returns at most one run's worth.
  const { data: items } = await supabase
    .from("checklist_run_items")
    .select(
      "id, prompt, section_name, sort, response_type, unit, min_value, max_value, choices, requires_photo, equipment_id, guidance, position, status, value_number, value_text, score, note, task_id",
    )
    .eq("run_id", runId)
    .order("sort");

  const itemIds = (items ?? []).map((i) => i.id as string);

  const [
    { data: photos },
    { data: equipment },
    { data: tasks, error: tasksError },
    { data: members },
  ] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; run_item_id: string; storage_path: string }[] })
      : supabase
          .from("facility_photos")
          .select("id, run_item_id, storage_path")
          .in("run_item_id", itemIds),
    supabase
      .from("equipment")
      .select("id, name")
      .eq("location_id", run.location_id as string),
    supabase
      .from("location_tasks")
      .select(
        "id, title, details, status, carry_forward, target_shift, due_on, created_at, priority, assigned_to",
      )
      .eq("location_id", run.location_id as string)
      .in("status", ["open", "in_progress"]),
    // The roster, for TWO reasons and both are 079's: it names the assignee on
    // a row, and it is what tells an assignment to somebody who has LEFT from
    // one to somebody who is simply not you. Revoking access bans an auth user
    // rather than deleting it, so the column outlives the login — and without
    // this set those tasks would drop off every checklist in the shop with
    // nothing to see. 001's `members_read` shows every member of your own org,
    // so this needs no definer function.
    supabase.from("org_members").select("user_id, display_name"),
  ]);

  // Signed URLs are minted SERVER-SIDE in ONE batch — one round trip instead of
  // one per photo, and a URL built to expire should not outlive the page.
  const paths = (photos ?? []).map((p) => p.storage_path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const equipmentName = new Map(
    (equipment ?? []).map((e) => [e.id as string, e.name as string]),
  );

  const rows: WalkItemRow[] = (items ?? []).map((i) => ({
    id: i.id as string,
    prompt: i.prompt as string,
    section_name: (i.section_name as string | null) ?? null,
    response_type: i.response_type as WalkItemRow["response_type"],
    unit: (i.unit as string | null) ?? null,
    min_value: i.min_value == null ? null : Number(i.min_value),
    max_value: i.max_value == null ? null : Number(i.max_value),
    choices: (i.choices as string[] | null) ?? null,
    requires_photo: i.requires_photo as boolean,
    equipment_id: (i.equipment_id as string | null) ?? null,
    equipment_name: i.equipment_id
      ? (equipmentName.get(i.equipment_id as string) ?? null)
      : null,
    guidance: (i.guidance as string | null) ?? null,
    position: (i.position as string | null) ?? null,
    status: i.status as WalkItemRow["status"],
    value_number: i.value_number == null ? null : Number(i.value_number),
    value_text: (i.value_text as string | null) ?? null,
    score: i.score == null ? null : Number(i.score),
    note: (i.note as string | null) ?? null,
    task_id: (i.task_id as string | null) ?? null,
    photos: (photos ?? [])
      .filter((p) => p.run_item_id === i.id)
      .map((p) => ({
        id: p.id as string,
        url: signed.get(p.storage_path as string) ?? null,
      })),
    // ONLY A WALKTHROUGH ASKS FOR A SCORE. 076 leaves that to the app rather
    // than a constraint (it would be a cross-table check), so this is the one
    // place it is decided — and it is decided from the RUN's snapshotted kind,
    // never from the template, which can be re-kinded after the fact.
    scored: run.kind === "walkthrough",
  }));

  const memberName = new Map<string, string | null>(
    (members ?? []).map((m) => [
      m.user_id as string,
      (m.display_name as string | null) ?? null,
    ]),
  );
  const memberIds = new Set(memberName.keys());

  const carried = openTasksForRun(
    (tasks ?? []).map((t) => {
      const assigned = (t.assigned_to as string | null) ?? null;
      return {
        id: t.id as string,
        title: t.title as string,
        details: (t.details as string | null) ?? null,
        status: t.status as WalkTask["status"],
        carry_forward: t.carry_forward as boolean,
        target_shift: (t.target_shift as string | null) ?? null,
        due_on: (t.due_on as string | null) ?? null,
        created_at: t.created_at as string,
        priority: t.priority as WalkTask["priority"],
        assigned_to: assigned,
        // Named only when it is somebody ELSE's doing — a row on your own
        // checklist saying "assigned to you" is the screen telling you where
        // you are standing. The orphan says so instead, because "this was
        // Karina's and Karina has gone" is why it is in front of you at all.
        assigned_label: assigned
          ? assignmentIsOrphaned({ assigned_to: assigned }, memberIds)
            ? "was assigned to somebody who has left"
            : assigned === viewerId
              ? "yours"
              : (memberName.get(assigned) ?? "assigned")
          : null,
      };
    }),
    (run.shift as WalkTask["target_shift"]) as never,
    { viewerId, memberIds },
  );

  return {
    data: {
      run: run as ChecklistRunData["run"],
      items: rows,
      tasks: carried,
      taskWarning: tasksError
        ? `Carried-over tasks could not be read: ${tasksError.message}` +
          (/assigned_to/.test(tasksError.message)
            ? " — migration 079 has not been applied yet."
            : "")
        : null,
    },
    error: null,
  };
}
