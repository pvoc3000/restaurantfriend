"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { BAR_CELL } from "@/components/tablet/barCell";
import { BarLabel, ICON_ADD } from "@/components/tablet/BarLabel";
import { myEmployeeId } from "@/lib/myEmployee";

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
 * It asks for the element and stops. Which batch of the day is left empty
 * (Mark, 2026-10-28: "I don't see the need for it") — the record still edits
 * it for the day that does. The yield,
 * the on-hand, the recipe version and the photo are all set on
 * the record, where `InlineValue` already edits them — a create form that also
 * took them would be a second editor to keep in step with the first.
 *
 * `status` defaults to TO-DO, the same as a generated row (Mark, 2026-10-28).
 * It used to default to complete, on the reading that an added batch writes
 * down something that already happened; in practice it is added to be made.
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
  variant = "button",
  children,
}: {
  orgId: string;
  /** The log this batch joins. It is always known now — the command lives ON a
   *  log — so there is no find-or-create left to do. */
  logId: string;
  locationId: string;
  locationCode: string;
  logDate: string;
  /** `bar` is the tablet shell's footer cell; `button` the desk's outlined one. */
  variant?: "button" | "bar";
  /** Hand the command out as an Actions menu row instead; the dialog stays. */
  children?: (row: ActionMenuItem) => React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [elements, setElements] = useState<
    { id: string; name: string; kind: string; is_active: boolean }[]
  >([]);
  const [elementId, setElementId] = useState<string | null>(null);
  const [term, setTerm] = useState("");

  // Every word typed must appear in the name, in any order — the inventory
  // search's rule, done here in the browser because the list is already loaded.
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = elements.filter(
    (e) => e.is_active && words.every((w) => e.name.toLowerCase().includes(w))
  );

  // Loaded when the dialog opens, not on every page load: ~470 elements is a
  // real payload and the list screen has no other use for it.
  useEffect(() => {
    if (!open || elements.length > 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("production_elements")
        .select("id, name, kind, is_active")
        .order("name");
      if (!cancelled)
        setElements(
          (data ?? []) as { id: string; name: string; kind: string; is_active: boolean }[]
        );
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
    setTerm("");
    setFailed(null);
  }

  function add(picked: string | null = elementId) {
    if (!picked || pending) return;
    setFailed(null);
    startTransition(async () => {
      // The number comes from 044's definer — a plain `nextval` is not reachable
      // by `authenticated`, which is the same arrangement 006 made for POs.
      const [{ data: number, error: numberError }, operatorId] = await Promise.all([
        supabase.rpc("next_batch_number", { p_location_id: locationId }),
        myEmployeeId(supabase, orgId),
      ]);
      if (numberError) {
        setFailed(numberError.message);
        return;
      }

      const { error } = await supabase
        .from("production_batches")
        .insert({
          org_id: orgId,
          log_id: logId,
          element_id: picked,
          location_id: locationId,
          batch_number: number as string,
          is_generated: false,
          status: "to_do",
          operator_employee_id: operatorId,
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
      {children ? (
        children({ label: "Add Batch…", onSelect: () => setOpen(true) })
      ) : variant === "bar" ? (
        // The tablet shell's footer cell — icon over word, the runners' idiom.
        <button type="button" onClick={() => setOpen(true)} className={BAR_CELL}>
          <BarLabel icon={ICON_ADD} word="Batch" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${BUTTON_CLASS} shrink-0`}
        >
          {/* "Add batch", not the app's usual `New <thing>` (Mark, 2026-08-09).
              The convention is for a command that creates a RECORD you then go
              to; this one puts a line on the log you are already looking at, and
              nothing navigates. Add is the honest verb for that. */}
          Add batch
        </button>
      )}

      {open && (
        <Dialog
          title="Add a Batch"
          onClose={close}
          busy={pending}
          onSubmit={ready ? () => add() : undefined}
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
                onClick={() => add()}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Add batch"}
              </button>
            </>
          }
        >
          {failed ? <p className="mb-3 text-sm text-accent">{failed}</p> : null}

          <div className="space-y-4">
            <p className="text-sm text-muted">
              Add a production element batch to the {locationCode} log for{" "}
              {logDate}
            </p>

            <div className="space-y-1.5">
              <span
                id="new-batch-element"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"
              >
                Element
              </span>
              <TextInput
                autoFocus
                value={term}
                onValueChange={setTerm}
                clearLabel="Clear the search"
                search
                fullWidth
                aria-label="Search elements"
                icon={<SearchGlyph />}
              />
              {/* A SCROLL VIEW, not a popup (Mark, 2026-10-28): the choices are
                  on screen the moment the dialog opens, and a tap is the pick.
                  Active elements only — `PickList` used to sink the inactive
                  ones under a heading and offer to revive them, which needs
                  purchaser+, and staff log batches. */}
              <ul
                role="listbox"
                aria-labelledby="new-batch-element"
                className="h-72 overflow-y-auto overscroll-contain border border-ink"
              >
                {elements.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-subtle">Loading…</li>
                ) : shown.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-subtle">No elements match.</li>
                ) : (
                  shown.map((e) => {
                    const chosen = e.id === elementId;
                    return (
                      <li key={e.id} role="option" aria-selected={chosen}>
                        <button
                          type="button"
                          onClick={() => setElementId(e.id)}
                          // A double-click is the pick AND the commit.
                          onDoubleClick={() => {
                            setElementId(e.id);
                            add(e.id);
                          }}
                          className={`flex w-full items-baseline gap-2 border-b border-hairline px-3 py-2 text-left text-sm any-pointer-coarse:py-3 ${
                            chosen ? "bg-[#c0c0c0]" : "hover:bg-neutral-100"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{e.name}</span>
                          <span className="shrink-0 text-xs text-subtle">{e.kind}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
