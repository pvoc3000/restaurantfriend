"use client";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { BatchLogActions } from "./BatchLogActions";
import { NewBatch } from "./NewBatch";

/**
 * THE BATCH LOG'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12: "move the
 * action buttons on the batch-logs detail page into an actionmenu, place it in
 * the same row as the page title top-right aligned"). Add Batch… · Mark
 * Complete (or Reopen Log) · Delete Log… (red) — the three buttons that sat at
 * the right end of the log's strip.
 *
 * DESK ONLY. The tablet shell keeps its black footer, where these are
 * icon-over-word cells and the pane's own Delete batch rides beside them.
 *
 * Delete batch STAYS IN THE PANE: it acts on the SELECTED batch, and a
 * screen-level menu has no way to say which one — the documents record's
 * per-file rule.
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
}) {
  // Every command here writes, so below `canLogBatch` there is no menu.
  if (!editable) return null;

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
