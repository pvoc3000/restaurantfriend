"use client";

import { useSyncExternalStore } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { readSelectedBatch, serverSelectedBatch, subscribeSelectedBatch } from "@/lib/selectedBatch";
import { BatchActions } from "./BatchActions";
import { BatchLogActions } from "./BatchLogActions";
import { NewBatch } from "./NewBatch";

/**
 * THE BATCH LOG'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12: "move the
 * action buttons on the batch-logs detail page into an actionmenu, place it in
 * the same row as the page title top-right aligned"). Add Batch… · Mark
 * Complete (or Reopen Log) · Delete Log… (red) — the three buttons that sat at
 * the right end of the log's strip.
 *
 * ON THE TABLET (Mark, 2026-09-12: "move the new batch and delete batch
 * actions from the footer … to the actionmenu … then remove the footer") the
 * menu is Add Batch… · Delete Batch… and sits in the crumb row, the tablet
 * having no title row. Delete Batch acts on the batch the pane is showing,
 * which the pane publishes through `lib/selectedBatch`. Complete/Reopen and
 * Delete Log stay desk commands (2026-09-09).
 *
 * On the desk Delete batch stays in the pane, beside the batch it deletes.
 *
 * `NewBatch` and `BatchLogActions` keep owning their dialog, confirms and
 * row-count checks and hand their rows through render props
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
  touch = false,
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
  /** The tablet shell's menu: Add Batch… · Delete Batch…. */
  touch?: boolean;
}) {
  const selected = useSyncExternalStore(subscribeSelectedBatch, readSelectedBatch, serverSelectedBatch);

  // Every command here writes, so below `canLogBatch` there is no menu.
  if (!editable) return null;

  if (touch) {
    const tabletMenu = (addRow: ActionMenuItem, deleteRows: ActionMenuItem[]) => (
      <ActionMenu
        ariaLabel={`Actions for the ${kitchenCode} ${logDate} batch log`}
        minWidth={200}
        items={[
          addRow,
          ...(deleteRows.length
            ? deleteRows.map((r) => ({ ...r, separatorBefore: true }))
            : removable
              ? [{ label: "Delete Batch…", disabled: true, danger: true, separatorBefore: true }]
              : []),
        ]}
      />
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
                {(deleteRows) => tabletMenu(addRow, deleteRows)}
              </BatchActions>
            ) : (
              tabletMenu(addRow, [])
            )
          }
        </NewBatch>
      </div>
    );
  }

  const menu = (addRow: ActionMenuItem) => (
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
          items={[addRow, ...logRows]}
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
        {menu}
      </NewBatch>
    </div>
  );
}
