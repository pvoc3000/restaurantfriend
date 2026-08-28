"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadProductionGraph, loadItemGraph } from "@/lib/productionQueries";
import { itemCost } from "@/lib/productionCost";
import { resolveItemPrice } from "@/lib/productionPrice";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

// THE SHARED CLASS, not a local copy. There were FOUR hand-typed near-copies of
// this button in the module — here, `AddScheduleItems`, `PrintPacket` and the
// original of this — and they had already drifted (one had lost its disabled
// state). Harmless while they sat on different rows; since 2026-08-27 they all
// stand in this one, where any drift is visible at a glance.
const COMMAND = `${BUTTON_CLASS} shrink-0`;

/**
 * The commands on one night: print, recost, regenerate, delete.
 *
 * Every button is white and bordered except Delete, which is red. There is no
 * primary here — this is a row of peers on a SCREEN, which is exactly the case
 * the design system says is not the `DIALOG_COMMIT_CLASS` exception.
 */
export function ScheduleActions({
  scheduleId,
  scheduleDate,
  locationId,
  sellsCode,
  kitchenCode,
  source,
  hasActuals,
  lineCount,
  editable,
  print,
  add,
}: {
  scheduleId: string;
  scheduleDate: string;
  /** The SCHEDULE's shop, not the session's working one — recosting a night
   *  has to price it where it was made, and since 050 both halves of that come
   *  through the graph off this id: the vendor price overrides, and the labour
   *  element's own per-shop cost. */
  locationId: string;
  sellsCode: string;
  kitchenCode: string;
  source: string;
  hasActuals: boolean;
  lineCount: number;
  editable: boolean;
  print: React.ReactNode;
  /**
   * `AddScheduleItems`, composed upstream — `print` is passed the same way, and
   * for the same reason: the slot keeps the panel's own state and query out of
   * this component while letting the ROW decide the order.
   */
  add?: React.ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * THE COST OF THE DAY, written by the app rather than by the generator.
   *
   * `generate_production_schedules` leaves the four cost columns null on
   * purpose: the resolver is `lib/productionCost` — purchased element to
   * inventory item to cheapest active vendor item to location override, made
   * element to its master recipe version, with `lib/units` doing the
   * conversion — and none of it has a SQL twin. Writing one would be decision
   * 2's disease in a new form, two vocabularies for one number.
   *
   * So the cost is snapshotted here, from the live graph, and re-snapshotted on
   * demand. That is decision 11's own carve-out: costing derives live, and a
   * snapshot happens exactly where a DOCUMENT needs one.
   */
  async function recost() {
    setBusy("recost");
    setError(null);
    setDone(null);

    const { graph, error: graphErr } = await loadProductionGraph(supabase);
    if (!graph) {
      setBusy(null);
      setError(graphErr ?? "The costing graph could not be read.");
      return;
    }
    const { graph: items, error: itemErr } = await loadItemGraph(supabase);
    if (!items) {
      setBusy(null);
      setError(itemErr ?? "The menu could not be read.");
      return;
    }

    const { data: lines, error: lineErr } = await supabase
      .from("production_schedule_items")
      .select("id, item_id")
      .eq("schedule_id", scheduleId);
    if (lineErr || !lines) {
      setBusy(null);
      setError(lineErr?.message ?? "The lines could not be read.");
      return;
    }

    const itemById = new Map(items.items.map((i) => [i.id, i]));
    const stamp = new Date().toISOString();
    let written = 0;

    for (const line of lines) {
      const item = itemById.get(line.item_id as string);
      if (!item) continue;
      const cost = itemCost(item, graph.byId, { locationId });
      const price = resolveItemPrice(
        item,
        locationId,
        items.grid,
        items.gridOverrides,
        items.overridesByItem.get(item.id) ?? []
      );
      const { data, error: err } = await supabase
        .from("production_schedule_items")
        .update({
          unit_cost: cost.cost,
          unit_price: price.price,
          // What the "at least" is hiding. Storing the figure without the count
          // would freeze a LOWER BOUND as though it were a number.
          cost_unresolved: new Set(cost.unresolved.map((u) => u.name)).size,
          costed_at: stamp,
        })
        .eq("id", line.id as string)
        .select("id");
      if (err) {
        setBusy(null);
        setError(err.message);
        return;
      }
      written += (data ?? []).length;
    }

    setBusy(null);
    if (written === 0 && lines.length > 0) {
      setError("Nothing was costed — you may not have permission to change this schedule.");
      return;
    }
    setDone(`Costed ${written} ${written === 1 ? "line" : "lines"}.`);
    router.refresh();
  }

  async function regenerate() {
    const message =
      `Regenerate ${scheduleDate} for ${sellsCode} (made at ${kitchenCode})?\n\n` +
      `Every par goes back to what the plans and par overrides say now.` +
      (hasActuals
        ? `\n\nThis night has counted quantities. They are kept — a line the plans still carry keeps its count — but a line the plans have DROPPED goes, and its count with it.`
        : "") +
      `\n\nLines you added by hand are left alone.`;
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Regenerate" }))) return;

    setBusy("regenerate");
    setError(null);
    setDone(null);
    const { data, error: err } = await supabase.rpc("generate_production_schedules", {
      p_start: scheduleDate,
      p_days: 1,
      p_location_ids: [locationId],
      p_ignore_special_orders: false,
      p_replace: true,
      p_allow_actuals: hasActuals,
    });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    const receipt = data as { replaced?: { lines_after: number }[] };
    const after = receipt.replaced?.[0]?.lines_after;
    setDone(after === undefined ? "Regenerated." : `Regenerated — ${after} items.`);
    router.refresh();
  }

  async function remove() {
    // THE LAST LINE IS SOURCE-AWARE, because on a special-order schedule the
    // plan sentence is simply false — regenerating rebuilds nothing here (the
    // generator only ever touches `source = 'plan'`), and this route also
    // bypasses `unschedule_special_order`'s printed/counted guard. The FK's
    // `set null` clears the order's `production_schedule_id`, but its
    // `order_scheduled_at` is left claiming production is scheduled.
    const message =
      `Delete the ${scheduleDate} schedule for ${sellsCode}?\n\n` +
      `${lineCount} ${lineCount === 1 ? "item" : "items"} go with it` +
      (hasActuals ? `, including counted quantities somebody entered` : "") +
      `.\n\n` +
      (source === "special_order"
        ? `This came from a special order. Unscheduling it from the order is the ordinary way back — that also clears the order's Production scheduled date, and refuses if the night has been printed or counted.`
        : `Generating the day again would rebuild it from the plans.`);
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Delete", tone: "danger" }))) return;

    setBusy("delete");
    setError(null);
    // `.select()` its own result: a delete matching no policy removes zero rows
    // and returns NO error, and a cheerful false success that also NAVIGATES
    // reads as the schedule having been deleted.
    const { data, error: err } = await supabase
      .from("production_schedules")
      .delete()
      .eq("id", scheduleId)
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
    router.push("/schedules");
    router.refresh();
  }

  return (
    /* Sized to its buttons and right-aligned, because since 2026-08-27 this
       sits in the record's identity row rather than across the page. The
       messages below take the cluster's full width and read left, since a
       right-aligned sentence is hard work. */
    <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
      <div className="flex flex-wrap items-center gap-3">
        {/* ADD LEADS, and the row then reads build - produce - maintain -
            destroy. It is the only command here that changes what the kitchen
            MAKES; everything after it acts on the document as a whole. */}
        {add}
        {print}
        {editable ? (
          <>
            <button type="button" onClick={recost} disabled={busy !== null} className={COMMAND}>
              {busy === "recost" ? "Costing…" : "Recost"}
            </button>
            {source === "plan" ? (
              <button
                type="button"
                onClick={regenerate}
                disabled={busy !== null}
                className={COMMAND}
              >
                {busy === "regenerate" ? "Regenerating…" : "Regenerate…"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              // `ml-auto` was pushing Delete to the far side of a full-width
              // row. In a content-sized cluster there is no slack to push into,
              // so it would only ever have been a no-op — and it is a lie about
              // the arrangement.
              className={DANGER_BUTTON_CLASS}
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          </>
        ) : null}
      </div>

      {/* A recost walks the whole graph and can take a few seconds on a big
          night. A band, not a dialog — the table behind it stays readable. */}
      {busy === "recost" ? (
        <div className="w-full">
          <ProgressBand label="Costing tonight's items…" />
        </div>
      ) : null}
      {error ? <p className="w-full max-w-md text-left text-sm text-accent">{error}</p> : null}
      {done ? <p className="w-full max-w-md text-left text-sm text-muted">{done}</p> : null}
    </div>
  );
}
