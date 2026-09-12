"use client";

import { useSyncExternalStore } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { readSelectedBatch, serverSelectedBatch, subscribeSelectedBatch } from "@/lib/selectedBatch";
import { BatchActions } from "./BatchActions";
import { BatchLogActions } from "./BatchLogActions";
import { NewBatch } from "./NewBatch";

/**
 * THE BATCH LOG'S COMMANDS, AS ONE "ACTIONS" MENU, THE SAME ON BOTH SHELLS
 * (Mark, 2026-09-12: "make them match, one menu on both"):
 *
 *   Add Batch… · Delete Batch… · — · Mark Complete (or Reopen Log) · Delete Log…
 *
 * The desk puts it in the title row; the tablet, which has no title row, in the
 * crumb row. That placement is the only difference left — the tablet's footer,
 * the desk pane's Delete batch button and the 2026-09-09 rule that Complete and
 * Delete Log were desk-only all went with this.
 *
 * DELETE BATCH ACTS ON THE BATCH THE PANE IS SHOWING, which the pane
 * (`BatchLogItems`, a sibling under the server page) publishes through
 * `lib/selectedBatch`. Greyed out with nothing selected.
 *
 * `NewBatch`, `BatchActions` and `BatchLogActions` keep owning their dialog,
 * confirms and row-count checks and hand their rows through render props
 * (`OrderCommandMenu`'s arrangement).
 */
export function BatchLogCommandMenu({
  orgId,
  logId,
  locationId,
  kitchenCode,
  logDate,
  status,
  batches,
  outstanding,
  editable,
  removable = false,
}: {
  orgId: string;
  logId: string;
  locationId: string;
  kitchenCode: string;
  logDate: string;
  status: string;
  batches: number;
  outstanding: number;
  editable: boolean;
  /** Purchaser+ — 044's delete policy, which Delete Batch… answers to. */
  removable?: boolean;
}) {
  const selected = useSyncExternalStore(subscribeSelectedBatch, readSelectedBatch, serverSelectedBatch);

  // Every command here writes, so below `canLogBatch` there is no menu.
  if (!editable) return null;

  const menu = (addRow: ActionMenuItem, deleteBatchRows: ActionMenuItem[]) => (
    <BatchLogActions
      logId={logId}
      status={status}
      logDate={logDate}
      kitchenCode={kitchenCode}
      batches={batches}
      outstanding={outstanding}
      editable={editable}
    >
      {(logRows) => (
        <ActionMenu
          ariaLabel={`Actions for the ${kitchenCode} ${logDate} batch log`}
          minWidth={200}
          items={[
            addRow,
            ...(deleteBatchRows.length
              ? deleteBatchRows
              : removable
                ? [{ label: "Delete Batch…", disabled: true, danger: true }]
                : []),
            ...logRows.map((row, i) => (i === 0 ? { ...row, separatorBefore: true } : row)),
          ]}
        />
      )}
    </BatchLogActions>
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <NewBatch
        orgId={orgId}
        logId={logId}
        locationId={locationId}
        locationCode={kitchenCode}
        logDate={logDate}
      >
        {(addRow) =>
          selected ? (
            <BatchActions
              batchId={selected.id}
              elementName={selected.elementName}
              batchNumber={selected.batchNumber}
              hasYield={selected.hasYield}
              photoPath={selected.photoPath}
              removable={removable}
            >
              {(deleteRows) => menu(addRow, deleteRows)}
            </BatchActions>
          ) : (
            menu(addRow, [])
          )
        }
      </NewBatch>
    </div>
  );
}
