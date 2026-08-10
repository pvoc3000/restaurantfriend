"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { batchDate } from "@/lib/productionBatches";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

// The shared weight, so this row's commands cannot come out a different height
// from the Delete beside them (`ui/buttons`). `shrink-0` is positional and so
// stays here.
const COMMAND = `${BUTTON_CLASS} shrink-0`;

/**
 * The commands on one batch log: close it, reopen it, delete it.
 *
 * CLOSING NAMES WHAT IS OUTSTANDING AND LETS YOU THROUGH, which is
 * `closeReadiness`' rule from the receiving screen: gate it on a complete set
 * and the log with one batch nobody ever got to is stuck open forever, which is
 * how a status stops meaning anything.
 *
 * Every button is white and bordered except Delete. There is no primary — a row
 * of peers on a SCREEN is exactly the case the design system says is not the
 * `DIALOG_COMMIT_CLASS` exception.
 */
export function BatchLogActions({
  logId,
  status,
  logDate,
  kitchenCode,
  batches,
  outstanding,
  editable,
}: {
  logId: string;
  status: string;
  logDate: string;
  kitchenCode: string;
  batches: number;
  outstanding: number;
  editable: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!editable) return null;

  async function setStatus(next: "open" | "complete") {
    if (next === "complete" && outstanding > 0) {
      const message =
        `Close the ${batchDate(logDate)} log at ${kitchenCode}?\n\n` +
        `${outstanding} of ${batches} ${outstanding === 1 ? "batch has" : "batches have"} ` +
        `not been marked complete or skipped.\n\n` +
        `Closing it anyway is fine — you can reopen it.`;
      if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Close log" }))) return;
    }
    setBusy(next);
    setError(null);
    // `.select()` its own result: an update matching no policy changes nothing
    // and PostgREST returns NO error, so the row count is the only honest check.
    const { data, error: err } = await supabase
      .from("production_batch_logs")
      .update({ status: next })
      .eq("id", logId)
      .select("id");
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    if ((data ?? []).length === 0) {
      setError("Nothing changed — you may not have permission to close this log.");
      return;
    }
    router.refresh();
  }

  async function remove() {
    const message =
      `Delete the ${batchDate(logDate)} batch log at ${kitchenCode}?\n\n` +
      `${batches} ${batches === 1 ? "batch goes" : "batches go"} with it, including anything ` +
      `somebody measured.\n\nGenerating the day again would rebuild what the round still carries.`;
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Delete", tone: "danger" }))) return;

    setBusy("delete");
    setError(null);
    const { data, error: err } = await supabase
      .from("production_batch_logs")
      .delete()
      .eq("id", logId)
      .select("id");
    if (err) {
      setBusy(null);
      setError(err.message);
      return;
    }
    if ((data ?? []).length === 0) {
      setBusy(null);
      setError("Nothing was deleted — you may not have permission.");
      return;
    }
    router.push("/batch-logs");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {status === "complete" ? (
          <button
            type="button"
            onClick={() => setStatus("open")}
            disabled={busy !== null}
            className={COMMAND}
          >
            {busy === "open" ? "Reopening…" : "Reopen"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStatus("complete")}
            disabled={busy !== null}
            className={COMMAND}
          >
            {busy === "complete" ? "Closing…" : "Mark complete"}
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className={DANGER_BUTTON_CLASS}
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}
