"use client";

import type { ComponentProps, ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { SyncFromSquare } from "@/components/sales/SyncFromSquare";
import { DeleteTimesheets } from "./DeleteTimesheets";
import { ExportTimesheets } from "./ExportTimesheets";
import { NewPayPeriod } from "./NewPayPeriod";
import { NewTimesheet } from "./NewTimesheet";
import { RecalculateWorkdays } from "./RecalculateWorkdays";

type PeriodProps = Omit<ComponentProps<typeof NewPayPeriod>, "children">;
type RecalcProps = Omit<ComponentProps<typeof RecalculateWorkdays>, "children">;
type ExportProps = Omit<ComponentProps<typeof ExportTimesheets>, "children">;
type SheetProps = Omit<ComponentProps<typeof NewTimesheet>, "children">;
type DeleteProps = Omit<ComponentProps<typeof DeleteTimesheets>, "children">;

/** The first row of a group carries the rule above it. */
function group(items: ActionMenuItem[]): ActionMenuItem[] {
  return items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));
}

/**
 * THE TIMESHEETS SCREEN'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12:
 * "move all action buttons on the timesheets page into an actionmenu. place it
 * in the title row top-right aligned"). It replaces FIVE controls in two
 * different rows — New pay period, Recalculate… and Close pay period… on the
 * period bar, New timesheet and Import timesheets in the filter row — two of
 * which additionally filled BLACK depending on the period's state.
 *
 * The four components that own their commands keep owning them and hand their
 * rows through a render prop; their dialogs, writes and confirms do not move.
 * `OrderCommandMenu`'s arrangement.
 *
 * TWO GROUPS, AND THE SPLIT IS THE SCREEN'S OWN. `PeriodBar` has said since it
 * was hoisted out of the filter row (Mark, 2026-08-06) that "the controls below
 * act on the SHIFTS — search them, group them, add one — while these act on the
 * PERIOD". So:
 *
 *   Import Timesheets · New Timesheet · Delete Timesheets…   (the shifts)
 *   ─────
 *   New Pay Period · Recalculate Workdays… · Sync Tips from Square · Close Pay Period…   (the period)
 *
 * IMPORT LEADS, which is that same bar's other decided fact: importing IS the
 * routine and typing a shift by hand is the exception (Mark, 2026-08-22,
 * reversing his own earlier call). RECALCULATE IS IN THE PERIOD GROUP because
 * `page.tsx` already put it there in as many words — "it acts on the PERIOD, so
 * it belongs in this row rather than with the shift filters below" — even
 * though what it rewrites is a column on the shifts.
 *
 * KNOWN LOSS, and it is the one worth weighing before this is repeated
 * elsewhere: Import and Close each filled BLACK conditionally, so the screen
 * said which of the two was the obvious next act — Import on an empty pay
 * period, Close on a full one. A menu row has no weight, so that is gone. The
 * app has met this before (the PO list's per-row hints, the bill list's
 * Approve fill) and accepted it; if it is missed here, the honest fix is a
 * sentence, not a coloured row.
 *
 * A CLIENT component because render props are functions, and `page.tsx` is a
 * server component.
 */
export function TimesheetCommandMenu({
  newPeriod,
  recalculate,
  close,
  newTimesheet,
  deleteSheets,
  syncTips,
}: {
  newPeriod: PeriodProps;
  recalculate: RecalcProps;
  /** Null until a pay period is chosen — there is nothing to close. */
  close: ExportProps | null;
  newTimesheet: SheetProps;
  /** Null until a pay period is chosen — there is nothing to delete from. */
  deleteSheets: DeleteProps | null;
  /**
   * Sync Tips from Square over the period's dates (Mark, 2026-09-29) — the
   * same sync as `/sales` and the Close Pay Period panel. Null until a period
   * is chosen. `editable` because a tip figure is only written for a day an
   * open period covers (064), so on a closed one it would pull sales and feed
   * nothing.
   */
  syncTips: { today: string; from: string; to: string; editable: boolean } | null;
}) {
  const router = useRouter();

  const withClose = (render: (items: ActionMenuItem[]) => ReactNode) =>
    close ? <ExportTimesheets {...close}>{render}</ExportTimesheets> : render([]);
  const withDelete = (render: (items: ActionMenuItem[]) => ReactNode) =>
    deleteSheets ? <DeleteTimesheets {...deleteSheets}>{render}</DeleteTimesheets> : render([]);
  // Outermost, because it draws its progress and result BENEATH what it wraps
  // — here, beneath the Actions button, as it does on /sales.
  const withSync = (render: (items: ActionMenuItem[]) => ReactNode) =>
    syncTips ? (
      <SyncFromSquare today={syncTips.today} range={{ from: syncTips.from, to: syncTips.to }}>
        {(row) =>
          render([
            {
              label: "Sync Tips from Square",
              onSelect: row.onSelect,
              disabled: row.disabled || !syncTips.editable,
            },
          ])
        }
      </SyncFromSquare>
    ) : (
      render([])
    );

  return withSync((syncRows) => (
    <NewTimesheet {...newTimesheet}>
      {(sheetRows) => (
        <NewPayPeriod {...newPeriod}>
          {(periodRows) => (
            <RecalculateWorkdays {...recalculate}>
              {(recalcRows) =>
                withClose((closeRows) => withDelete((deleteRows) => (
                  <ActionMenu
                    ariaLabel="Actions for this pay period"
                    minWidth={240}
                    items={[
                      // A `router.push` rather than an `<a>`: `ActionMenuItem`
                      // has only `onSelect`. The cost is cmd-click, which the
                      // PO list's row menu already decided is worth one entry
                      // and not worth an href on every menu in the app.
                      {
                        label: "Import Timesheets",
                        onSelect: () => router.push("/timesheets/import"),
                      },
                      ...sheetRows,
                      ...deleteRows,
                      ...group([...periodRows, ...recalcRows, ...syncRows, ...closeRows]),
                    ]}
                  />
                )))
              }
            </RecalculateWorkdays>
          )}
        </NewPayPeriod>
      )}
    </NewTimesheet>
  ));
}
