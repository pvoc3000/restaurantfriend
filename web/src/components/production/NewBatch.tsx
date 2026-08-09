"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList } from "@/components/ui/PickList";

/**
 * Log a batch that isn't on the weekly round.
 *
 * Generation covers the WEEKLY-class round; this covers everything else — an
 * AB or donut element, a second batch nobody planned, a test. `NewElement`'s
 * template: a command in the list's own row, a Dialog, an insert carrying
 * `org_id` EXPLICITLY (design rule 1 — a WITH CHECK is evaluated before the NOT
 * NULL, so an omitted org_id reports as an RLS violation and sends you looking
 * at roles), then land on the new record.
 *
 * It asks for the four things a batch cannot be without and stops. The yield,
 * the on-hand, the operator, the recipe version and the photo are all set on
 * the record, where `InlineValue` already edits them — a create form that also
 * took them would be a second editor to keep in step with the first.
 *
 * `status` defaults to COMPLETE here, where a generated row defaults to to-do,
 * and the asymmetry is the point: generation writes a job to be done, and this
 * writes down something that already happened.
 *
 * EVERY BATCH BELONGS TO A LOG (045), and this command lives ON one — so the
 * log is a prop and there is nothing to find or create. That is also why the
 * dialog asks for no date: the log has it, and an item has none of its own.
 */
export function NewBatch({
  orgId,
  logId,
  locationId,
  locationCode,
  logDate,
}: {
  orgId: string;
  /** The log this batch joins. It is always known now — the command lives ON a
   *  log — so there is no find-or-create left to do. */
  logId: string;
  locationId: string;
  locationCode: string;
  logDate: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [elements, setElements] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [elementId, setElementId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  // Loaded when the dialog opens, not on every page load: ~470 elements is a
  // real payload and the list screen has no other use for it.
  useEffect(() => {
    if (!open || elements.length > 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("production_elements")
        .select("id, name, kind")
        .eq("is_active", true)
        .order("name");
      if (!cancelled) setElements((data ?? []) as { id: string; name: string; kind: string }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, elements.length, supabase]);

  const ready = elementId !== null;

  function close() {
    if (pending) return;
    setOpen(false);
    setElementId(null);
    setLabel(null);
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      // The number comes from 044's definer — a plain `nextval` is not reachable
      // by `authenticated`, which is the same arrangement 006 made for POs.
      const { data: number, error: numberError } = await supabase.rpc("next_batch_number", {
        p_location_id: locationId,
      });
      if (numberError) {
        setFailed(numberError.message);
        return;
      }

      const { error } = await supabase
        .from("production_batches")
        .insert({
          org_id: orgId,
          log_id: logId,
          element_id: elementId,
          location_id: locationId,
          batch_number: number as string,
          batch_label: label?.trim() ? label.trim() : null,
          is_generated: false,
          status: "complete",
        })
        .select("id")
        .single();

      if (error) {
        setFailed(error.message);
        return;
      }
      close();
      // No navigation: a batch has no route. It appears in the log's list, and
      // the pane is one click away — which is the whole point of the pane.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
      >
        New batch
      </button>

      {open && (
        <Dialog
          title="Log a batch"
          onClose={close}
          busy={pending}
          onSubmit={ready ? add : undefined}
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Logging…" : "Log batch"}
              </button>
            </>
          }
        >
          {failed ? <p className="mb-3 text-sm text-accent">{failed}</p> : null}

          <div className="space-y-4">
            <p className="text-sm text-muted">
              For something the weekly round doesn&rsquo;t carry — an AB or
              donut element, an extra batch, a test. It joins the {locationCode}{" "}
              log for {logDate}, marked complete; the yield, who made it and the
              photo go on the record.
            </p>

            <label className="block space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Element
              </span>
              <PickList
                value={elementId}
                onPick={(next) => setElementId(next || null)}
                variant="field"
                ariaLabel="Which element"
                placeholder={elements.length ? "Pick one" : "Loading…"}
                options={elements.map((e) => ({
                  value: e.id,
                  label: e.name,
                  hint: e.kind,
                }))}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Which batch
                </span>
                <PickList
                  value={label}
                  onPick={(next) => setLabel(next || null)}
                  variant="field"
                  allowNew
                  ariaLabel="Which batch of the day"
                  placeholder="—"
                  // A LABEL, not a position: 040 measured "Blueberry",
                  // "Caramel" and "x2" among the real values, so this offers
                  // the ordinary ones and takes anything.
                  options={["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }))}
                />
              </label>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
