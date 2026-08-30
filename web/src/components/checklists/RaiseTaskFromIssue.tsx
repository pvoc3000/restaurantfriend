"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { taskTitleFromIssue } from "@/lib/facilityTasks";

/**
 * Turn a flagged item into work.
 *
 * SUPERVISOR-INITIATED AND NEVER AUTOMATIC (Mark, 2026-08-29: "It probably
 * shouldn't be automatic, but something the supervisor initiates"). That is the
 * app's posture everywhere — it proposes, the human writes — and here it also
 * keeps the task list honest: most flagged items are dealt with on the spot and
 * only some become a job somebody else has to do.
 *
 * ONCE RAISED IT SAYS SO. The run item carries `task_id`, so night two reads
 * "reported" and offers a link rather than a second button. Without that, three
 * supervisors flag the same fryer on three nights and file three tasks.
 */
export function RaiseTaskFromIssue({
  runItemId,
  orgId,
  locationId,
  prompt,
  note,
  taskId,
}: {
  runItemId: string;
  orgId: string;
  locationId: string;
  prompt: string;
  note: string | null;
  taskId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (taskId) {
    return (
      <span className="text-[13px] text-muted">
        Reported —{" "}
        <Link href={`/tasks?open=${taskId}`} className="underline">
          see the task
        </Link>
      </span>
    );
  }

  function raise() {
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data: task, error } = await supabase
        .from("location_tasks")
        .insert({
          org_id: orgId,
          location_id: locationId,
          kind: "task",
          // The item's PROMPT is what it is about and the NOTE is what is
          // wrong; both, in that order, so the task reads as a job rather than
          // as a fragment.
          title: taskTitleFromIssue(prompt, note),
          source_run_item_id: runItemId,
          created_by: uid,
        })
        .select("id")
        .single();

      if (error || !task) {
        setFailed(error?.message ?? "The task was not created.");
        return;
      }

      // Link it back, so this issue can never raise a second one.
      const { error: linkError } = await supabase
        .from("checklist_run_items")
        .update({ task_id: task.id })
        .eq("id", runItemId)
        .select("id");
      if (linkError) {
        setFailed(
          "The task was created, but this item was not linked to it — raising it again would file a duplicate.",
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={raise}
        disabled={busy}
        className="min-h-11 border border-ink bg-white px-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {busy ? "Raising…" : "Raise a task"}
      </button>
      {failed && <span className="text-[13px] text-accent">{failed}</span>}
    </span>
  );
}
