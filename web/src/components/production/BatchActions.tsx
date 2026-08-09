"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadProductionGraph } from "@/lib/productionQueries";
import { versionBatchCost } from "@/lib/productionCost";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { BATCH_PHOTO_BUCKET } from "@/lib/batchPhotos";

const COMMAND =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

/**
 * The commands on one batch: cost it, and delete it.
 *
 * Every button is white and bordered except Delete, which is red. There is no
 * primary — a row of peers on a SCREEN is exactly the case the design system
 * says is NOT the `DIALOG_COMMIT_CLASS` exception.
 */
export function BatchActions({
  batchId,
  elementId,
  locationId,
  elementName,
  batchNumber,
  hasYield,
  photoPath,
  editable,
  removable,
}: {
  batchId: string;
  elementId: string | null;
  locationId: string;
  elementName: string;
  batchNumber: string;
  hasYield: boolean;
  photoPath: string | null;
  /** Supervisor and up — 044's update policy. */
  editable: boolean;
  /** Purchaser+ — 044's delete policy, which is deliberately narrower. */
  removable: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * WHAT THIS BATCH COST, snapshotted from the live graph.
   *
   * The generator leaves the three cost columns null on purpose, for the reason
   * 040 gives about its own four: the resolver is `lib/productionCost` — the
   * whole BOM, a cycle guard, `lib/units` converting — and a SQL twin of it
   * would be decision 2's disease in a new form. A generated batch has not run
   * yet, so the stamp belongs here, when somebody says it is done.
   *
   * `cost_unresolved` is stored beside the figure because 209 elements are
   * still unpriced: a lower bound recorded as though it were a number is how
   * the 2022-price disease comes back pointing the other way.
   */
  async function cost() {
    if (!elementId) {
      setError("This batch has no element, so there is nothing to cost.");
      return;
    }
    setBusy("cost");
    setError(null);
    setDone(null);

    const { graph, error: graphErr } = await loadProductionGraph(supabase);
    if (!graph) {
      setBusy(null);
      setError(graphErr ?? "The costing graph could not be read.");
      return;
    }

    const element = graph.byId.get(elementId);
    if (!element?.master) {
      setBusy(null);
      setError(
        `${elementName} has no master recipe version, so a batch of it cannot be costed.`
      );
      return;
    }

    const batch = versionBatchCost(element.master, graph.byId, locationId, new Set([element.id]));
    const { data, error: err } = await supabase
      .from("production_batches")
      .update({
        unit_cost: batch.cost,
        cost_unresolved: new Set(batch.unresolved.map((u) => u.name)).size,
        costed_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select("id");

    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    if ((data ?? []).length === 0) {
      setError("Nothing was costed — you may not have permission to change this batch.");
      return;
    }
    setDone(
      batch.unresolved.length
        ? `Costed, with ${new Set(batch.unresolved.map((u) => u.name)).size} ingredient(s) still unpriced.`
        : "Costed."
    );
    router.refresh();
  }

  async function remove() {
    const message =
      `Delete batch ${batchNumber} of ${elementName}?\n\n` +
      (hasYield
        ? `It has a recorded yield, which goes with it.\n\n`
        : "") +
      `Generating this day again would put back anything the weekly round still carries — but not what somebody measured.`;
    if (!window.confirm(message)) return;

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
    router.push("/batch-logs");
    router.refresh();
  }

  if (!editable && !removable) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {editable ? (
          <button type="button" onClick={cost} disabled={busy !== null} className={COMMAND}>
            {busy === "cost" ? "Costing…" : "Cost this batch"}
          </button>
        ) : null}
        {removable ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            className={`${DANGER_BUTTON_CLASS} ml-auto`}
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>

      {/* Costing walks the whole graph. A band, not a dialog — the record
          behind it stays readable. */}
      {busy === "cost" ? <ProgressBand label="Working out what this batch cost…" /> : null}
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      {done ? <p className="text-sm text-muted">{done}</p> : null}
    </div>
  );
}
