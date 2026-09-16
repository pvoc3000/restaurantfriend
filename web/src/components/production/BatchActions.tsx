"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { BAR_CELL } from "@/components/tablet/barCell";
import { BarLabel, ICON_TRASH } from "@/components/tablet/BarLabel";
import { BATCH_PHOTO_BUCKET } from "@/lib/batchPhotos";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { currentOperatorId } from "@/components/production/currentOperator";

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
  variant = "button",
  children,
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
  /** `bar` is the tablet footer's cell (Mark, 2026-09-09: "Move the 'delete
   *  batch' button to the footer"). */
  variant?: "button" | "bar";
  /** Hand the command out as an Actions menu row (Mark, 2026-09-12: Delete
   *  batch left the tablet footer for the menu). Empty when not removable. */
  children?: (rows: ActionMenuItem[]) => React.ReactNode;
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
  /**
   * DUPLICATE BATCH (Mark, 2026-09-12) — a second making of the same thing on
   * the same log: same element, label, recipe version, scale and planned
   * amounts, with a NEW batch number from 044's definer.
   *
   * WHAT IS NOT COPIED is everything that happened TO the original: its status
   * (the copy is To Do), the on-hand count and the yield someone
   * measured, the photo, the notes and the cost stamp. Copying a yield would
   * record a measurement nobody took. The operator is whoever is duplicating
   * it (Mark, 2026-09-16), like every other new batch.
   *
   * `is_generated` goes FALSE, and must: 045's unique index allows one
   * GENERATED batch per element per log, so a copy claiming to be generated
   * would be refused — and it wasn't generated, somebody asked for it.
   *
   * `select("*")` rather than a column list, so a column a later migration adds
   * comes along (`ProductionItemActions`' lesson); the resets apply only to
   * keys the row actually has.
   */
  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    const { data: row, error: readErr } = await supabase
      .from("production_batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();
    if (readErr || !row) {
      setBusy(null);
      setError(readErr?.message ?? "The batch could not be read.");
      return;
    }
    const { data: number, error: numberErr } = await supabase.rpc("next_batch_number", {
      p_location_id: row.location_id as string,
    });
    if (numberErr) {
      setBusy(null);
      setError(numberErr.message);
      return;
    }
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (["id", "created_at", "updated_at", "created_by", "updated_by", "legacy_id"].includes(k)) continue;
      copy[k] = v;
    }
    const resets: Record<string, unknown> = {
      batch_number: number as string,
      is_generated: false,
      status: "to_do",
      // Whoever is duplicating it, not whoever made the original.
      operator_employee_id: await currentOperatorId(supabase, row.org_id as string),
      on_hand_count: null,
      on_hand_size: null,
      on_hand_unit: null,
      yield_count: null,
      yield_size: null,
      yield_unit: null,
      photo_path: null,
      photo_name: null,
      notes: null,
      unit_cost: null,
      cost_unresolved: null,
      costed_at: null,
    };
    for (const [k, v] of Object.entries(resets)) {
      if (k in copy || k === "batch_number") copy[k] = v;
    }
    const { data, error: insertErr } = await supabase
      .from("production_batches")
      .insert(copy)
      .select("id");
    setBusy(null);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    if (!data?.length) {
      setError("Nothing was added — you may not have permission.");
      return;
    }
    router.refresh();
  }

  if (children) {
    return (
      <>
        {children([
          {
            label: busy === "duplicate" ? "Duplicating…" : "Duplicate Batch",
            onSelect: () => void duplicate(),
            disabled: busy !== null,
          },
          ...(removable
            ? [{ label: busy === "delete" ? "Deleting…" : "Delete Batch…", onSelect: () => void remove(), danger: true, disabled: busy !== null }]
            : []),
        ])}
        {error ? <p className="text-right text-sm text-accent">{error}</p> : null}
      </>
    );
  }

  if (!removable) return null;

  if (variant === "bar") {
    return (
      <>
        <button type="button" onClick={remove} disabled={busy !== null} className={BAR_CELL}>
          <BarLabel icon={ICON_TRASH} word={busy === "delete" ? "Deleting…" : "Batch"} />
        </button>
        {error ? <p className="self-center px-3 text-sm text-[var(--rf-red-300)]">{error}</p> : null}
      </>
    );
  }

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
            {busy === "delete" ? "Deleting…" : "Delete batch"}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  );
}
