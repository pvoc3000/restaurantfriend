"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * Take a finished checklist back to open.
 *
 * Until this shipped, `/checklists/[id]` offered a button labelled "Reopen" that
 * linked to a runner rendering READ-ONLY, because `WalkRunner` gates every
 * control on `status === "open"` and nothing anywhere wrote that status after
 * create. The label is "View" now; this is the command that was missing.
 *
 * A PLAIN UPDATE, NOT AN RPC — and the difference from `ReopenShiftReport`
 * beside it is the whole reason this file is short. `reopen_shift_report` (072)
 * is a definer function because SUBMITTING FLUSHED ROWS into other tables:
 * ratings onto people's records, counts onto the schedule, premiums into a pay
 * period. Flipping the status without undoing those produced silent duplicates,
 * so the undo had to be transactional and had to refuse what it could not take
 * back. Finishing a checklist flushes NOTHING — every answer already lives on
 * `checklist_run_items` — so there is nothing to undo and no migration to write.
 * Do not "fix" this into an RPC.
 *
 * DANGEROUS-LOOKING ON PURPOSE, even though it is recoverable: a reader cannot
 * tell "opens a confirm" from "destroys" by looking, which is why every
 * destructive command in this app is red before it is pressed. What it actually
 * destroys is the claim the record was making — that a named person finished
 * this walk at this time.
 */
export function ReopenChecklistRun({
  runId,
  title,
  submittedAt,
  issueCount,
}: {
  runId: string;
  title: string;
  submittedAt: string | null;
  issueCount: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function reopen() {
    const ok = await confirmDialog({
      title: "Reopen this checklist?",
      body: [
        submittedAt
          ? `${title} was finished on ${submittedAt.slice(0, 10)}. Reopening clears that, so the record stops saying when it was done.`
          : `${title} will go back to being unfinished.`,
        "Every answer stays exactly as it is — this only makes them editable again.",
        issueCount > 0
          ? `Its ${issueCount === 1 ? "one flagged issue stays flagged" : `${issueCount} flagged issues stay flagged`}, and any task already raised from ${issueCount === 1 ? "it" : "them"} is untouched.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confirmLabel: "Reopen",
      tone: "danger",
    });
    if (!ok) return;

    startTransition(async () => {
      // `.select("id")` AND a row count, because 076 says so in its own header:
      // a write matching no policy changes ZERO ROWS AND RETURNS NO ERROR. The
      // menu already hides this below owner/admin, so a refusal here means a
      // stale session — which must be reported rather than reported as success.
      const { data, error } = await supabase
        .from("checklist_runs")
        .update({ status: "open", submitted_at: null, submitted_by: null })
        .eq("id", runId)
        .select("id");
      if (error) {
        setFailed(error.message);
        return;
      }
      if ((data ?? []).length === 0) {
        setFailed(
          "Nothing was changed — reopening a finished checklist is a manager's to do. Sign in again if you are one.",
        );
        return;
      }
      setFailed(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => void reopen()}>
        Reopen
      </button>
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </div>
  );
}
