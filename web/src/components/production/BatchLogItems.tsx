"use client";

import { useRef, useState } from "react";
import type { PickOption } from "@/components/ui/PickList";
import { useExactViewportHeight, useViewportAtLeast } from "@/lib/tableHead";
import { BatchItemsTable, type BatchRow } from "@/components/production/BatchItemsTable";
import { BatchFields, type BatchFieldsRow } from "@/components/production/BatchFields";
import { BatchActions } from "@/components/production/BatchActions";

/**
 * A batch log, laid out the way FileMaker's is: the items on top, ONE batch's
 * detail pinned underneath, and clicking a row moves the detail (Mark,
 * 2026-08-09, with the DF Operations screenshot).
 *
 * WHY A PINNED PANE AND NOT A ROUTE. Working a log is one task with thirty
 * repetitions — pick a row, type what came out, pick the next. A navigation per
 * batch would make that thirty round trips and lose the list's scroll each
 * time.
 *
 * There is NO route for a single batch. One existed and was deleted the same
 * day: "there will never be any use for the standalone batch log item record.
 * It will always be done in the pinned detail pane" (Mark, 2026-08-09). So this
 * pane carries everything a batch record did — its fields, and its Cost and
 * Delete commands — and nothing renders a batch anywhere else.
 *
 * THE HEIGHT IS MEASURED, never a CSS constant. What sits above this row varies
 * — the log's own fields wrap at narrow widths, the actions band comes and goes
 * — so `100vh - <guess>` runs the pane off the bottom of the window, which is
 * the receiving screen's lesson. `useExactViewportHeight` asks the DOM and
 * writes the height to the node.
 *
 * Below `lg` it STACKS and the page scrolls instead: a pinned pane on a narrow
 * screen leaves the table about six rows, which is worse than scrolling.
 */
export function BatchLogItems({
  rows,
  fields,
  orgId,
  operators,
  versionsByElement,
  locationId,
  editable,
  removable,
  add,
}: {
  rows: BatchRow[];
  /** The same batches, carrying what the PANE needs. Keyed by id. */
  fields: Record<string, BatchFieldsRow>;
  orgId: string;
  operators: PickOption[];
  versionsByElement: Record<string, PickOption[]>;
  locationId: string;
  editable: boolean;
  /** Purchaser+ — 044's delete policy, narrower than the edit one. */
  removable: boolean;
  add?: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  // `lg`, Tailwind's own breakpoint, through the store the rest of the app uses
  // — a `useSyncExternalStore` rather than an effect, which is what the
  // set-state-in-effect rule wants.
  const wide = useViewportAtLeast(1024);
  useExactViewportHeight(frame, wide, 460);

  // DERIVED, not corrected. A batch that has gone — deleted, or dropped by a
  // refresh — must not leave the pane showing something that isn't there, and
  // an effect that noticed and re-set the state would both trip the
  // set-state-in-effect rule and paint one frame of the stale batch. Falling
  // back during render has neither problem, and needs no state for the default.
  const selectedId = picked && fields[picked] ? picked : rows[0]?.id ?? null;
  const selected = selectedId ? fields[selectedId] ?? null : null;

  return (
    <div
      ref={frame}
      className={wide ? "flex min-h-0 flex-col gap-4" : "flex flex-col gap-4"}
    >
      <div className={wide ? "flex min-h-0 flex-1 flex-col" : ""}>
        <BatchItemsTable
          rows={rows}
          editable={editable}
          add={add}
          selectedId={selectedId}
          onSelect={setPicked}
          fill={wide}
        />
      </div>

      {/* THE PANE TAKES A SHARE, not its content's height.
          Sized to its content it took 366 of a 437px frame and left the table
          71px — four fields' worth of detail crowding out the list you pick
          from. A PERCENTAGE of a frame that already has a definite height
          splits predictably and scales: 40% is ~175px on a short window and
          ~600px on a tall one, and the table always keeps the majority. */}
      <section
        className={`shrink-0 border border-ink ${wide ? "flex h-[40%] flex-col" : ""}`}
      >
        <header className="flex shrink-0 items-baseline gap-3 bg-ink px-4 py-2 text-white">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
            {selected ? selected.element_name : "No batch selected"}
          </h2>
          {selected ? (
            // The batch NUMBER, which is the one identifier the list stopped
            // showing — it has to be legible somewhere.
            <span className="ml-auto text-[11px] tabular-nums tracking-[0.08em] text-white/70">
              {selected.generated ? "" : "by hand · "}
              {selected.batch_number}
            </span>
          ) : null}
        </header>

        <div className={`overflow-y-auto p-4 ${wide ? "min-h-0 flex-1" : "max-h-[46vh]"}`}>
          {selected ? (
            <div className="space-y-4">
              <BatchFields
                row={selected}
                orgId={orgId}
                operators={operators}
                versions={
                  selected.element_id ? versionsByElement[selected.element_id] ?? [] : []
                }
                editable={editable}
              />
              <BatchActions
                batchId={selected.id}
                elementId={selected.element_id}
                locationId={locationId}
                elementName={selected.element_name}
                batchNumber={selected.batch_number}
                hasYield={selected.yield_count !== null || selected.yield_size !== null}
                photoPath={selected.photo_path}
                editable={editable}
                removable={removable}
              />
            </div>
          ) : (
            <p className="text-sm text-muted">
              Pick a batch above to fill this in.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
