"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_DANGER_CLASS } from "@/components/ui/Dialog";

/**
 * Cancel a task, with a reason.
 *
 * A DIALOG AND NEVER AN INLINE STATUS PICK, which is 059's rule and its reason:
 * 075 demands a non-blank `resolution_note` for a cancellation, so status and
 * note have to be written in ONE statement or the CHECK bounces a raw 23514
 * into a cell — the one refusal an inline control cannot explain.
 *
 * The requirement rides the DECISION, not the column: marking a task DONE asks
 * for nothing, because the row already says done and names who and when.
 * Cancelling is the only record a vanished job ever gets.
 */
export function ResolveTask({
  task,
  onClose,
  onDone,
}: {
  task: { id: string; title: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Disabled on blank AND on whitespace, so the check constraint never has to
  // refuse anything — the same guard 059's dismiss dialog uses.
  const canCommit = reason.trim().length > 0 && !busy;

  function commit() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("location_tasks")
        .update({ status: "cancelled", resolution_note: reason.trim() })
        .eq("id", task.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "Nothing changed — you may not have permission.");
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog
      title={`Cancel “${task.title}”?`}
      onClose={onClose}
      width="max-w-lg"
      busy={busy}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className={DIALOG_DANGER_CLASS}
            onClick={commit}
            disabled={!canCommit}
          >
            Cancel the task
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="max-w-[52ch] text-sm text-muted">
          Cancelling is how a task is erased — there is no delete, deliberately,
          because the only record that somebody once thought this needed doing is
          this row. Say why: “duplicate”, “fixed itself”,
          “not ours”.
        </p>
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Why
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            aria-label="Why this task is being cancelled"
            className={FORM_TEXTAREA}
          />
        </label>
        {failed && <p className="text-sm text-accent">{failed}</p>}
      </div>
    </Dialog>
  );
}
