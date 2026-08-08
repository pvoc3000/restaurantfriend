"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { WEEKDAYS, buildMatrix } from "@/lib/productionPlans";

export type MatrixTray = { id: string; tray_number: string; band: string | null; sort: number | null };
export type MatrixSlot = { id: string; tray_id: string; weekday: number; item_id: string };
export type MatrixItem = { id: string; name: string; taxonomy: string };

/**
 * The tray × weekday matrix — FileMaker's best idea in this module, and the one
 * screen in this app that is genuinely a grid of its own.
 *
 * It models the physical display case the way the order guide models the
 * physical walk: a row per tray, a column per day, and what sits there. Not a
 * `DataTable` — the columns are DAYS rather than fields, every cell is a set of
 * items rather than a value, and there is nothing to sort by.
 *
 * Editing is one item at a time and writes immediately, like `InlineValue`
 * everywhere else: there is no draft of a menu to save. Removing is an ✕ on the
 * chip. Both `.select()` their own result — with no matching RLS policy
 * Postgres changes nothing and PostgREST returns no error, which reads as a
 * cheerful success.
 */
export function PlanMatrix({
  planId,
  orgId,
  trays,
  slots,
  items,
  bands,
  editable,
}: {
  planId: string;
  orgId: string;
  trays: MatrixTray[];
  slots: MatrixSlot[];
  items: MatrixItem[];
  /** The band vocabulary already in use across this org's plans. */
  bands: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ trayId: string; weekday: number } | null>(null);
  const [newTray, setNewTray] = useState(false);

  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  const matrix = buildMatrix(trays, slots, itemNames);

  function addItem(trayId: string, weekday: number, itemId: string) {
    if (!itemId) return;
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      // org_id EXPLICITLY — design rule 1.
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .insert({ org_id: orgId, tray_id: trayId, weekday, item_id: itemId })
        .select("id");
      if (error || !data?.length) {
        setFailed(
          /duplicate key|unique/.test(error?.message ?? "")
            ? "That item is already on this tray that day."
            : error?.message ?? "That could not be added."
        );
        return;
      }
      setAdding(null);
      router.refresh();
    });
  }

  function removeSlot(rowId: string) {
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("production_plan_tray_items")
        .delete()
        .eq("id", rowId)
        .select("id");
      if (error || !data?.length) {
        setFailed(error?.message ?? "That could not be removed.");
        return;
      }
      router.refresh();
    });
  }

  function addTray(trayNumber: string, band: string) {
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("production_plan_trays")
        .insert({
          org_id: orgId,
          plan_id: planId,
          tray_number: trayNumber.trim(),
          band: band.trim() || null,
          sort: trays.length + 1,
        })
        .select("id");
      if (error || !data?.length) {
        setFailed(
          /duplicate key|unique/.test(error?.message ?? "")
            ? `This plan already has a tray ${trayNumber.trim()}.`
            : error?.message ?? "That tray could not be added."
        );
        return;
      }
      setNewTray(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="w-[120px] px-2 py-2 text-left">Tray</th>
              {WEEKDAYS.map((d) => (
                <th key={d.iso} className="px-2 py-2 text-left">
                  {d.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.tray.id} className="align-top">
                <td className="px-2 py-2">
                  <span className="block font-medium">{row.tray.tray_number}</span>
                  {row.tray.band ? (
                    <span className="block text-[11px] uppercase tracking-[0.08em] text-subtle">
                      {row.tray.band}
                    </span>
                  ) : null}
                </td>
                {row.days.map((day, i) => {
                  const weekday = WEEKDAYS[i].iso;
                  const isAdding =
                    adding?.trayId === row.tray.id && adding?.weekday === weekday;
                  return (
                    <td key={weekday} className="px-1 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        {day.map((slot) => (
                          <span
                            key={slot.rowId}
                            className="group flex items-start gap-1 border border-hairline px-1.5 py-1 leading-tight"
                          >
                            <span className="min-w-0 flex-1 break-words">{slot.name}</span>
                            {editable ? (
                              <button
                                type="button"
                                onClick={() => removeSlot(slot.rowId)}
                                disabled={pending}
                                aria-label={`Remove ${slot.name} from tray ${row.tray.tray_number} on ${WEEKDAYS[i].long}`}
                                className="shrink-0 text-subtle opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
                              >
                                ✕
                              </button>
                            ) : null}
                          </span>
                        ))}
                        {editable ? (
                          isAdding ? (
                            <PickList
                              variant="field"
                              ariaLabel={`Add an item to tray ${row.tray.tray_number} on ${WEEKDAYS[i].long}`}
                              value=""
                              onPick={(v) => addItem(row.tray.id, weekday, v)}
                              options={items.map((it) => ({
                                value: it.id,
                                label: it.name,
                                hint: it.taxonomy,
                              }))}
                              placeholder="Which item…"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAdding({ trayId: row.tray.id, weekday })}
                              className="border border-dashed border-hairline px-1.5 py-1 text-left text-[11px] uppercase tracking-[0.08em] text-subtle hover:border-ink hover:text-ink"
                            >
                              + add
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matrix.length === 0 ? (
        <p className="text-[13px] text-muted">
          No trays yet. A plan is a display case — add the trays, then put an
          item in each slot it holds that day.
        </p>
      ) : null}

      {editable ? (
        <button
          type="button"
          onClick={() => setNewTray(true)}
          className="inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
        >
          Add tray
        </button>
      ) : null}

      {newTray ? (
        <NewTrayDialog
          bands={bands}
          pending={pending}
          onClose={() => setNewTray(false)}
          onAdd={addTray}
        />
      ) : null}
    </div>
  );
}

function NewTrayDialog({
  bands,
  pending,
  onClose,
  onAdd,
}: {
  bands: string[];
  pending: boolean;
  onClose: () => void;
  onAdd: (trayNumber: string, band: string) => void;
}) {
  const [trayNumber, setTrayNumber] = useState("");
  const [band, setBand] = useState("");

  return (
    <Dialog
      title="Add tray"
      onClose={onClose}
      busy={pending}
      width="max-w-md"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAdd(trayNumber, band)}
            disabled={pending || trayNumber.trim() === ""}
            className={DIALOG_COMMIT_CLASS}
          >
            {pending ? "Adding…" : "Add tray"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Tray number
          </span>
          {/* Text, not a number: FileMaker's are "01", "05", "07" and a case
              can grow a "7A". */}
          <TextInput
            value={trayNumber}
            onValueChange={setTrayNumber}
            placeholder="01"
            aria-label="Tray number"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Band
          </span>
          <PickList
            variant="field"
            ariaLabel="Band"
            value={band}
            onPick={setBand}
            options={bands.map((b) => ({ value: b, label: b }))}
            allowNew
            placeholder="RAISED, CLASSIC, SIGNATURE…"
          />
        </div>
      </div>
    </Dialog>
  );
}

/** A link back to the item, for the plan's own summary line. */
export function ItemLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/production-items/${id}`} className="hover:underline">
      {name}
    </Link>
  );
}
