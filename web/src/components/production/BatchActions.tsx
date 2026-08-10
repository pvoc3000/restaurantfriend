"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { BATCH_PHOTO_BUCKET } from "@/lib/batchPhotos";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * The command on one batch: delete it.
 *
 * ONE COMMAND, and Cost this batch is GONE (Mark, 2026-08-09), along with the
 * progress band and the two result lines under it — all three existed only to
 * report what costing had done.
 *
 * Worth recording what went with it, because the code it called is still here
 * and still right. `unit_cost` / `cost_unresolved` / `costed_at` are 044's
 * columns and `lib/productionCost` still resolves the graph for the recipe
 * screen; what this button did was let somebody stamp a batch by hand, one at a
 * time, from a pane they were using to type yields. Nothing read the stamp
 * back, so the figure was write-only — and with 209 elements still unpriced it
 * was a lower bound recorded as though it were a number, which is the disease
 * decision 11 exists to prevent, pointing the other way. If batch costing comes
 * back it wants to be derived on a screen that shows it, not a button here.
 *
 * Delete sits where Cost used to, at the LEFT (Mark). It was right-aligned when
 * it shared the row and had to be told apart from a peer; alone, `ml-auto` just
 * parks the only control on the pane a column away from everything above it.
 */
export function BatchActions({
  batchId,
  elementName,
  batchNumber,
  hasYield,
  photoPath,
  removable,
}: {
  batchId: string;
  elementName: string;
  batchNumber: string;
  /** Named in the confirm, because a measurement goes with the row. */
  hasYield: boolean;
  photoPath: string | null;
  /** Purchaser+ — 044's delete policy, which is deliberately narrower than the
   *  supervisor+ one that governs editing a batch. */
  removable: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const message =
      `Delete batch ${batchNumber} of ${elementName}?\n\n` +
      (hasYield
        ? `It has a recorded yield, which goes with it.\n\n`
        : "") +
      `Generating this day again would put it back if the weekly round still carries it — but not what somebody measured.`;
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Delete", tone: "danger" }))) return;

    setBusy("delete");
    setError(null);
    // Row FIRST, then the object: an orphan object is invisible and harmless,
    // where a removed photo with the row still naming it is not.
    const { data, error: err } = await supabase
      .from("production_batches")
      .delete()
      .eq("id", batchId)
      .select("id");
    if (err) {
      setBusy(null);
      setError(err.message);
      return;
    }
    // `.select()` its own result: a delete matching no policy removes zero rows
    // and PostgREST returns NO error, so a cheerful false success that also
    // NAVIGATES reads as the batch having been deleted.
    if ((data ?? []).length === 0) {
      setBusy(null);
      setError("Nothing was deleted — you may not have permission.");
      return;
    }
    if (photoPath) await supabase.storage.from(BATCH_PHOTO_BUCKET).remove([photoPath]);
    // No navigation: this lives in the pane on the batch's own log, and the
    // list is where you already are. The pane falls back to the first row by
    // itself once the row is gone.
    router.refresh();
  }

  // `elementId`, `locationId` and `editable` went with the Cost button — they
  // were its arguments and its gate, and a prop nobody reads is the kind of
  // thing that survives three refactors before somebody wires it to the wrong
  // value. Deleting is purchaser+ and is now the only command here.
  if (!removable) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {removable ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            className={DANGER_BUTTON_CLASS}
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}
