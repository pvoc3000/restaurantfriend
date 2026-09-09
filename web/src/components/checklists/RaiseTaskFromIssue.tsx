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
 * THE BUTTON NAMES THE MECHANISM, NOT THE RECORD (Mark, 2026-09-09, in two
 * steps: "it's unclear what the button does/will do", and then — reading the
 * description that answered it — "I think a different label for the button is
 * needed. 'Pin to future checklists' or something like that").
 *
 * HE WAS ALSO ASKING A QUESTION ABOUT BEHAVIOUR AND THE ANSWER IS YES: "if the
 * user doesn't raise a task, then, the next time a checklist is run the issue
 * will not appear on it?" It will not. A run reads exactly two things — its OWN
 * `checklist_run_items`, scoped `.eq("run_id", runId)`, and the shop's open
 * `location_tasks`. Nothing anywhere looks at a previous run. So a flagged item
 * that nobody pins is recorded on that night's run and in that night's emailed
 * report, and is never seen again.
 *
 * WHICH IS WHY "Raise a task" WAS THE WRONG LABEL. It named the ROW that gets
 * written, which is true and is not what the person standing there is deciding.
 * What they are deciding is whether this survives tonight. The pinning is the
 * consequence they cannot see and the reason the button exists, so it goes on
 * the face of it.
 *
 * THE DESCRIPTION SWAPPED JOBS WITH THE LABEL. It used to carry the
 * carry-forward and deliberately left out that a task record is created, on the
 * grounds that "Raise a task" had already said so. With the label naming the
 * mechanism instead, the record is now the unsaid half, so the line names it —
 * and names the only way it ends.
 *
 * THE LABEL STAYS TRUE FOR THE TASK'S WHOLE LIFE, checked rather than assumed:
 * `carry_forward` is `not null default true` (075) and is written ONLY at
 * creation, by `NewTask`'s own switch. Nothing edits it afterwards, so a task
 * pinned here cannot quietly stop being pinned. If that ever changes, this
 * label is the thing that starts lying.
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
        Pinned —{" "}
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
        {busy ? "Pinning…" : "Pin to future checklists"}
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
          It becomes a task, and stays until somebody closes it.
        </span>
      )}
    </span>
  );
}
