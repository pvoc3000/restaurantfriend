"use client";

import type { ComponentProps, ReactNode } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { NewSpecialOrder } from "./NewSpecialOrder";
import { OrderActions } from "./OrderActions";
import { PushOrderToQuickBooks } from "./PushOrderToQuickBooks";
import { ScheduleProduction } from "./ScheduleProduction";
import { SendDocument } from "./SendDocument";

type SendProps = Omit<ComponentProps<typeof SendDocument>, "children">;
type QuickBooksProps = Omit<ComponentProps<typeof PushOrderToQuickBooks>, "children">;
type ScheduleProps = Omit<ComponentProps<typeof ScheduleProduction>, "children">;
type OrderProps = Omit<ComponentProps<typeof OrderActions>, "children" | "schedule">;
type CreateProps = Omit<ComponentProps<typeof NewSpecialOrder>, "children">;

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
  create,
  actions,
}: {
  /** Null on a template or standing order — there is no document to send. */
  send: SendProps | null;
  /** Null on a template or standing order. No row either while QuickBooks is
   *  not connected — the component decides that itself. */
  quickbooks: QuickBooksProps | null;
  /** Null where the order cannot be scheduled by this role or is cancelled. */
  schedule: ScheduleProps | null;
  /** Null below the role that may create one. Every KIND offers it — a new
   *  order is not about the record you are standing on. */
  create: CreateProps | null;
  actions: OrderProps;
}) {
  const withSchedule = (render: (items: ActionMenuItem[]) => ReactNode) =>
    schedule ? <ScheduleProduction {...schedule}>{render}</ScheduleProduction> : render([]);
  const withQuickBooks = (render: (items: ActionMenuItem[]) => ReactNode) =>
    quickbooks ? <PushOrderToQuickBooks {...quickbooks}>{render}</PushOrderToQuickBooks> : render([]);
  const withDocuments = (render: (items: ActionMenuItem[]) => ReactNode) =>
    send ? <SendDocument {...send}>{render}</SendDocument> : render([]);
  const withCreate = (render: (items: ActionMenuItem[]) => ReactNode) =>
    create ? <NewSpecialOrder {...create}>{render}</NewSpecialOrder> : render([]);

  return withSchedule((scheduleItems) =>
    withQuickBooks((quickbooksItems) =>
      withDocuments((documentItems) =>
        withCreate((createItems) => (
          <OrderActions {...actions}>
            {({ edit, destructive }) => {
              const leading = [...documentItems, ...group(quickbooksItems)];
              // NEW ORDER SITS DIRECTLY ABOVE DUPLICATE, in a group of its own.
              // Those two are the only rows here that end with a DIFFERENT
              // order on screen — one from this shape, one from nothing — while
              // everything above them acts on the record you are standing on.
              // It gets its own rule because it is the one command on this menu
              // that is not about this order at all.
              //
              // A GROUP ONLY WEARS ITS RULE WHEN SOMETHING IS ABOVE IT. On a
              // template there are no documents and no QuickBooks row, so the
              // first group would otherwise open the menu with a line across
              // the top of nothing.
              const createGroup = leading.length ? group(createItems) : createItems;
              const above = leading.length > 0 || createGroup.length > 0;
              return (
                <ActionMenu
                  ariaLabel={`Actions for order ${actions.number}`}
                  items={[
                    ...leading,
                    ...createGroup,
                    ...(above ? group(edit) : edit),
                    ...group(scheduleItems),
                    ...group(destructive),
                  ]}
                />
              );
            }}
          </OrderActions>
        ))
      )
    )
  );
}
