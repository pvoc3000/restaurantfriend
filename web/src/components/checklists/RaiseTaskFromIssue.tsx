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
 *
 * AND IT SAYS WHAT IT WILL DO BEFORE YOU PRESS IT (Mark, 2026-09-09: "it's
 * unclear what the button does/will do"). This is the exception the "stop
 * writing hints" rule names — a line earns its place when it states a fact the
 * reader CANNOT SEE — and here that fact is the whole point of the feature:
 * raising a task is not filing it somewhere and forgetting it, it puts the job
 * on the top of every checklist at this shop until somebody closes it. Nothing
 * on the button, the row or the screen says so, and it is the difference
 * between a note and an obligation.
 *
 * ONE FACT, NOT TWO. The task also lands on /tasks, and that is deliberately
 * left out: it is the ordinary consequence of making a task, and the "see the
 * task" link this becomes the moment you press it goes straight there. The
 * carry-forward is the half nobody would guess.
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
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={raise}
        disabled={busy}
        className="min-h-11 shrink-0 border border-ink bg-white px-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {busy ? "Raising…" : "Raise a task"}
      </button>
      {/* The error REPLACES the description rather than joining it. Both are
          the same sentence-shaped thing in the same slot, and stacked they
          would read as one long line where the half that matters is the red
          half. Nothing is lost: the description is ambient, and it comes back
          on the next attempt. */}
      {failed ? (
        <span className="text-[13px] text-accent">{failed}</span>
      ) : (
        <span className="text-[13px] leading-snug text-muted">
          It stays on every checklist here until somebody does it.
        </span>
      )}
    </span>
  );
}
