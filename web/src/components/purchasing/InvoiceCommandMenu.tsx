"use client";

import type { ComponentProps } from "react";

import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { InvoiceActions } from "./InvoiceActions";
import { PushToQuickBooks } from "./PushToQuickBooks";

type ActionProps = Omit<ComponentProps<typeof InvoiceActions>, "children">;
type QuickBooksProps = Omit<ComponentProps<typeof PushToQuickBooks>, "children">;

/** The first row of a group carries the rule above it. */
function group(items: ActionMenuItem[]): ActionMenuItem[] {
  return items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it));
}

/**
 * THE INVOICE RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12:
 * "move all the action buttons into our new ActionMenu"), the fourth screen to
 * take this shape after the special order record and the PO, invoice and
 * inventory LISTS. It replaces Void · Delete · Approve for payment in one box
 * and Send/Update/Link · Check QuickBooks · Forget the link in another.
 *
 * The two components that own those commands keep owning them — their writes,
 * their row-count checks, their confirms and their result lines — and hand this
 * their rows through a render prop instead of drawing buttons.
 * `OrderCommandMenu`'s arrangement, and its reason: what gets remembered in one
 * copy and forgotten in the other is the confirm that names what a delete
 * cascades, the RPC's row count, and the rule that a PostgREST call refusing
 * quietly must not report success.
 *
 * THREE GROUPS, decide · send · destroy:
 *
 *   Approve for Payment / Withdraw Approval / Reopen Invoice
 *   ─────
 *   Send to QuickBooks · Check QuickBooks · Forget the Link
 *   ─────
 *   Void Invoice · Delete Invoice…            (both red)
 *
 * Which is why `InvoiceActions` hands back TWO named groups rather than one
 * array: QuickBooks sits BETWEEN its halves, and the app's rule is that the
 * destructive rows come last (`OrderActions`' own `{ edit, destructive }`).
 *
 * FLAT, NOT A "QuickBooks ▸" SUBMENU. At most three of its rows are ever live
 * at once, and CLAUDE.md's own line is that "two variants do not earn a
 * submenu — that one groups three and Documents four". A submenu would also
 * cost the ordinary case, one Send, a second gesture.
 *
 * A CLIENT component because render props are functions, and `InvoiceDetail`
 * places it from a tree the server renders.
 */
export function InvoiceCommandMenu({
  actions,
  quickbooks,
}: {
  actions: ActionProps;
  /** Always passed — the component decides for itself whether the org has a
   *  QuickBooks connection, and contributes no rows when it has not. */
  quickbooks: QuickBooksProps;
}) {
  return (
    <InvoiceActions {...actions}>
      {({ decide, destructive }) => (
        <PushToQuickBooks {...quickbooks}>
          {(quickbooksItems) => {
            // A group only takes a rule when something precedes it, or the
            // menu opens on a stray line above its first row.
            const withQb = [
              ...decide,
              ...(decide.length ? group(quickbooksItems) : quickbooksItems),
            ];
            const items = [
              ...withQb,
              ...(withQb.length ? group(destructive) : destructive),
            ];
            // NOTHING IS RENDERED WHEN THERE IS NOTHING TO OFFER, which on
            // this screen is a REAL state rather than a defensive one: the
            // Page Permissions sheet has a purchaser at Read Only here, so
            // they get no approve, no void, no delete and no push. An empty
            // menu would be worse than none — the inventory list's rule, and
            // the prose below still renders, which is what a reader came for.
            if (items.length === 0) return null;
            return (
              <ActionMenu ariaLabel="Actions for this invoice" minWidth={230} items={items} />
            );
          }}
        </PushToQuickBooks>
      )}
    </InvoiceActions>
  );
}
