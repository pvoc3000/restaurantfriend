"use client";

import type { ComponentProps, ReactNode } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { OrderActions } from "./OrderActions";
import { PushOrderToQuickBooks } from "./PushOrderToQuickBooks";
import { ScheduleProduction } from "./ScheduleProduction";
import { SendDocument } from "./SendDocument";

type SendProps = Omit<ComponentProps<typeof SendDocument>, "children">;
type QuickBooksProps = Omit<ComponentProps<typeof PushOrderToQuickBooks>, "children">;
type ScheduleProps = Omit<ComponentProps<typeof ScheduleProduction>, "children">;
type OrderProps = Omit<ComponentProps<typeof OrderActions>, "children" | "schedule">;

/** The first row of a group carries the rule above it. */
function group(items: ActionMenuItem[]): ActionMenuItem[] {
  return items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));
}

/**
 * THE SPECIAL ORDER RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-11:
 * "what if, instead, we had a single button, labeled Actions"). It replaces a
 * row of Preview · Download · Email… menus, Send to QuickBooks, Schedule
 * production, Duplicate, Flag, Cancel and Delete buttons in four sizes and
 * three colours.
 *
 * The four components that own those commands keep owning them — their writes,
 * their confirms, their dialogs and their result lines — and hand this their
 * rows through a render prop instead of drawing buttons. One menu, four owners,
 * nothing about any command re-implemented here.
 *
 * A CLIENT component because render props are functions, and the record screen
 * that places it is a server component.
 *
 * Grouped: the documents, then QuickBooks, then Duplicate and Flag, then
 * scheduling, then Cancel and Delete.
 */
export function OrderCommandMenu({
  send,
  quickbooks,
  schedule,
  actions,
}: {
  /** Null on a template or standing order — there is no document to send. */
  send: SendProps | null;
  /** Null on a template or standing order. No row either while QuickBooks is
   *  not connected — the component decides that itself. */
  quickbooks: QuickBooksProps | null;
  /** Null where the order cannot be scheduled by this role or is cancelled. */
  schedule: ScheduleProps | null;
  actions: OrderProps;
}) {
  const withSchedule = (render: (items: ActionMenuItem[]) => ReactNode) =>
    schedule ? <ScheduleProduction {...schedule}>{render}</ScheduleProduction> : render([]);
  const withQuickBooks = (render: (items: ActionMenuItem[]) => ReactNode) =>
    quickbooks ? <PushOrderToQuickBooks {...quickbooks}>{render}</PushOrderToQuickBooks> : render([]);
  const withDocuments = (render: (items: ActionMenuItem[]) => ReactNode) =>
    send ? <SendDocument {...send}>{render}</SendDocument> : render([]);

  return withSchedule((scheduleItems) =>
    withQuickBooks((quickbooksItems) =>
      withDocuments((documentItems) => (
        <OrderActions {...actions}>
          {({ edit, destructive }) => {
            const leading = [...documentItems, ...group(quickbooksItems)];
            return (
              <ActionMenu
                ariaLabel={`Actions for order ${actions.number}`}
                items={[
                  ...leading,
                  ...(leading.length ? group(edit) : edit),
                  ...group(scheduleItems),
                  ...group(destructive),
                ]}
              />
            );
          }}
        </OrderActions>
      ))
    )
  );
}
