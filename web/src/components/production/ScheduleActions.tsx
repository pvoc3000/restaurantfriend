"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadProductionGraph, loadItemGraph } from "@/lib/productionQueries";
import { itemCost } from "@/lib/productionCost";
import { resolveItemPrice } from "@/lib/productionPrice";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { AddScheduleItems, type AddableItem } from "@/components/production/AddScheduleItems";
import { PrintPacket } from "@/components/production/PrintPacket";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { deleteSchedules, deleteSchedulesMessage } from "@/components/production/scheduleWrites";

/**
 * The commands on one night — ONE ACTIONS MENU since 2026-09-12 (Mark: "move
 * all the action buttons on the schedules detail page into an actionmenu"),
 * where they were five buttons in the title row: Add Item… · Print… · Recost ·
 * Regenerate… · Delete Schedule… (red), grouped build · produce · maintain ·
 * destroy, the order the row had.
 *
 * `AddScheduleItems` and `PrintPacket` keep their panels and hand their rows
 * out through a render prop (`OrderCommandMenu`'s arrangement), which is why
 * this component now composes them itself: a render prop is a function, and
 * the server page could not pass one.
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
  stampable,
  orgId,
  addable,
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
  /** Passed to `PrintPacket` — may this reader stamp the night printed (044). */
  stampable: boolean;
  orgId: string;
  /** The menu `AddScheduleItems` offers. */
  addable: AddableItem[];
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
    // The confirm and the write are BOTH `scheduleWrites`' — the schedules
    // list's selection bar deletes through the same pair, and what would drift
    // between two copies is exactly the `.select()` row-count check and the
    // source-aware last line.
    const message = deleteSchedulesMessage([
      {
        schedule_date: scheduleDate,
        sellsCode,
        source,
        lineCount,
        // The record is handed a boolean rather than a count; one is enough for
        // the sentence, which only asks whether ANY line was counted.
        countedLines: hasActuals ? 1 : 0,
      },
    ]);
    if (!(await confirmDialog({ ...splitConfirmMessage(message), confirmLabel: "Delete", tone: "danger" }))) return;

    setBusy("delete");
    setError(null);
    const result = await deleteSchedules(supabase, [scheduleId]);
    if ("error" in result) {
      setBusy(null);
      setError(result.error);
      return;
    }
    router.push("/schedules");
    router.refresh();
  }

  // One trigger, so it is the one place left to say WHICH command is working.
  const busyLabel =
    busy === "recost" ? "Costing…" : busy === "regenerate" ? "Regenerating…" : busy === "delete" ? "Deleting…" : null;

  const menu = (addRow: ActionMenuItem | null, printRow: ActionMenuItem) => {
    const items: ActionMenuItem[] = [];
    if (addRow) items.push(addRow);
    items.push(printRow);
    if (editable) {
      items.push({ label: "Recost", onSelect: () => void recost(), separatorBefore: true });
      if (source === "plan") items.push({ label: "Regenerate…", onSelect: () => void regenerate() });
      items.push({
        label: "Delete Schedule…",
        onSelect: () => void remove(),
        danger: true,
        separatorBefore: true,
      });
    }
    return (
      <ActionMenu
        label={busyLabel ?? "Actions"}
        disabled={busy !== null}
        ariaLabel={`Actions for ${sellsCode} ${scheduleDate}`}
        minWidth={220}
        items={items}
      />
    );
  };

  const withPrint = (addRow: ActionMenuItem | null) => (
    <PrintPacket scheduleIds={[scheduleId]} stampable={stampable} label="Print…">
      {(printRow) => menu(addRow, printRow)}
    </PrintPacket>
  );

  return (
    /* Right-aligned in the record's identity row, top-aligned with the h1.
       The messages below take the cluster's width and read left, since a
       right-aligned sentence is hard work. */
    <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
      <div>
        {editable ? (
          <AddScheduleItems scheduleId={scheduleId} orgId={orgId} items={addable}>
            {(addRow) => withPrint(addRow)}
          </AddScheduleItems>
        ) : (
          withPrint(null)
        )}
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
