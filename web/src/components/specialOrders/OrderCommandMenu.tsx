"use client";

import type { ComponentProps, ReactNode } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { LinkCustomer } from "./LinkCustomer";
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
type CustomerProps = Omit<ComponentProps<typeof LinkCustomer>, "children">;

/** The first row of a group carries the rule above it. */
function group(items: ActionMenuItem[]): ActionMenuItem[] {
  return items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));
}

/**
 * THE SPECIAL ORDER RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-11:
 * "what if, instead, we had a single button, labeled Actions"). It replaces a
 * row of Preview · Download · Send… menus (Email… until 2026-09-22), Send to QuickBooks, Schedule
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
 * Grouped: New Order, then the documents, then QuickBooks, then Duplicate and
 * Flag, then scheduling, then Cancel and Delete.
 */
export function OrderCommandMenu({
  send,
  quickbooks,
  schedule,
  create,
  customer,
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
  /** Nullable like its neighbours, but never null today: the Customer row
   *  on the Info tab is not kind-gated, so a template can be linked too. */
  customer: CustomerProps | null;
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
  const withCustomer = (render: (items: ActionMenuItem[]) => ReactNode) =>
    customer ? <LinkCustomer {...customer}>{render}</LinkCustomer> : render([]);

  return withSchedule((scheduleItems) =>
    withQuickBooks((quickbooksItems) =>
      withDocuments((documentItems) =>
        withCreate((createItems) =>
          withCustomer((customerItems) => (
          <OrderActions {...actions}>
            {({ edit, destructive }) => {
              /**
               * THE GROUPS, IN READING ORDER — and the rules fall out of the
               * list rather than being reasoned about one at a time.
               *
               * NEW ORDER LEADS (Mark, 2026-09-20: "'new order…' should appear
               * at the top of the actionmenu"). It sat above Duplicate for a
               * day, on the argument that those two are the pair that end with
               * a DIFFERENT order on screen. The top is better and for the
               * same reason read the other way round: it is the one row here
               * that is not about this order at all, so it belongs before the
               * menu starts talking about this one — and it is the row you
               * reach for while the last order is still open, which is to say
               * without reading the menu.
               *
               * A RULE ABOVE EVERY GROUP BUT THE FIRST, with the empty ones
               * dropped BEFORE that is decided. This replaces three hand-made
               * conditionals that each had to know what might be above them —
               * on a template there are no documents and no QuickBooks row, and
               * the menu would otherwise have opened with a line drawn across
               * the top of nothing.
               */
              const groups = [
                createItems,
                // THE CUSTOMER ROWS COME SECOND, right under New Order (Mark,
                // 2026-09-21). They sat after Duplicate/Convert/Flag for an
                // hour on my reading that they belong with the other rows that
                // change what the order SAYS. Mark's order is better and the
                // menu explains why once you see it listed: everything below
                // this point acts on the order as it STANDS — print it, send
                // it, copy it, schedule it, cancel it — and who the order is
                // FOR is the thing you settle before any of that is worth
                // doing.
                customerItems,
                documentItems,
                quickbooksItems,
                edit,
                scheduleItems,
                destructive,
              ].filter((g) => g.length > 0);
              return (
                <ActionMenu
                  ariaLabel={`Actions for order ${actions.number}`}
                  items={groups.flatMap((g, i) => (i === 0 ? g : group(g)))}
                />
              );
            }}
          </OrderActions>
          ))
        )
      )
    )
  );
}
