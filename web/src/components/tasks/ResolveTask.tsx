"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_DANGER_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";

/**
 * Finish a task: mark it done, or cancel it with a reason.
 *
 * A DIALOG AND NEVER AN INLINE STATUS PICK, which is 059's rule and its reason:
 * 075 demands a non-blank `resolution_note` for a cancellation, so status and
 * note have to be written in ONE statement or the CHECK bounces a raw 23514
 * into a cell — the one refusal an inline control cannot explain.
 *
 * The requirement rides the DECISION, not the column: DONE asks for nothing
 * (the note is optional — "replaced the gasket" is worth keeping, but the row
 * already says done and names who and when), while CANCELING is the only
 * record a vanished job ever gets, so it has to say why. Either way the note
 * lands in the task's history (226 writes it into the status sentence).
 */
export function ResolveTask({
  task,
  mode,
  onClose,
  onDone,
}: {
  task: { id: string; title: string };
  mode: "done" | "cancel";
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const cancel = mode === "cancel";

  // Cancel is disabled on blank AND on whitespace, so the check constraint
  // never has to refuse anything — the same guard 059's dismiss dialog uses.
  const canCommit = (!cancel || note.trim().length > 0) && !busy;

  function commit() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const trimmed = note.trim();
      let patch: Record<string, unknown>;
      if (cancel) {
        patch = { status: "cancelled", resolution_note: trimmed };
      } else {
        // `getSession`, not `getUser`: this only fills a column, and RLS
        // still checks the real token.
        const uid = (await supabase.auth.getSession()).data.session?.user.id ?? null;
        patch = {
          status: "done",
          done_at: new Date().toISOString(),
          done_by: uid,
          resolution_note: trimmed || null,
        };
      }
      const { data, error } = await supabase
        .from("location_tasks")
        .update(patch)
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
      title={cancel ? `Cancel “${task.title}”?` : `Mark “${task.title}” done`}
      onClose={onClose}
      width="max-w-lg"
      busy={busy}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            {cancel ? "Keep it" : "Not yet"}
          </button>
          <button
            type="button"
            className={cancel ? DIALOG_DANGER_CLASS : DIALOG_COMMIT_CLASS}
            onClick={commit}
            disabled={!canCommit}
          >
            {cancel ? "Cancel the task" : "Mark done"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {cancel && (
          <p className="max-w-[52ch] text-sm text-muted">
            Canceling is how a task is erased — there is no delete, deliberately,
            because the only record that somebody once thought this needed doing is
            this row. Say why: “duplicate”, “fixed itself”,
            “not ours”.
          </p>
        )}
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {cancel ? "Why" : "What was done"}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            aria-label={cancel ? "Why this task is being canceled" : "What was done"}
            className={FORM_TEXTAREA}
          />
        </label>
        {failed && <p className="text-sm text-accent">{failed}</p>}
      </div>
    </Dialog>
  );
}
