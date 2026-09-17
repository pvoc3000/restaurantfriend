"use client";

import { useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import type { DateRange } from "@/lib/sales";
import { SyncFromSquare } from "./SyncFromSquare";
import { PostToQuickBooksDialog } from "./PostToQuickBooksDialog";
import { CompareWithShogoDialog } from "./CompareWithShogoDialog";

/** A day the commands may act on — the range's rows, every shop. */
export type ActionDay = {
  id: string;
  location_id: string;
  locationCode: string;
  business_date: string;
  hasBreakdown: boolean;
};

/**
 * THE SALES SCREEN'S COMMANDS ARE ONE ACTIONS MENU, in the title row: Sync
 * from Square · Post to QuickBooks… · Compare with Shogo…. `SyncFromSquare`
 * keeps owning its month loop, its progress band and its warnings and hands
 * the command out as a row (`OrderCommandMenu`'s arrangement), so the bands
 * still read beneath the trigger.
 *
 * THE TWO QUICKBOOKS ROWS ARE DISABLED, NOT HIDDEN, when there is nothing
 * they can do (`NewTimesheet`'s rule): the count in the label says why —
 * "Post to QuickBooks… (0)" is the whole reason on the row it is about — and a
 * missing connection is a word in the same place.
 */
export function SalesActions({
  today,
  orgId,
  postingReady,
  connected,
  range,
  days,
  shopCodes,
}: {
  today: string;
  orgId: string;
  /** Migration 104 is applied. Off, the two QuickBooks rows say so. */
  postingReady: boolean;
  connected: boolean;
  range: DateRange;
  days: ActionDay[];
  shopCodes: string[];
}) {
  const [open, setOpen] = useState<"post" | "compare" | null>(null);
  const postable = days.filter((d) => d.hasBreakdown);

  return (
    <>
      <SyncFromSquare today={today}>
        {(sync) => {
          const items: ActionMenuItem[] = [
            { label: sync.label, onSelect: sync.onSelect, disabled: sync.disabled },
            {
              label: !postingReady
                ? "Post to QuickBooks… (migration 104 pending)"
                : !connected
                  ? "Post to QuickBooks… (not connected)"
                  : `Post to QuickBooks… (${postable.length})`,
              onSelect: () => setOpen("post"),
              disabled: !postingReady || !connected || postable.length === 0,
              separatorBefore: true,
            },
            {
              label: !connected ? "Compare with Shogo… (not connected)" : "Compare with Shogo…",
              onSelect: () => setOpen("compare"),
              disabled: !postingReady || !connected || days.length === 0,
            },
          ];
          return <ActionMenu ariaLabel="Actions for sales" minWidth={260} items={items} />;
        }}
      </SyncFromSquare>

      {open === "post" ? (
        <PostToQuickBooksDialog orgId={orgId} days={postable} onClose={() => setOpen(null)} />
      ) : null}
      {open === "compare" ? (
        <CompareWithShogoDialog
          orgId={orgId}
          days={days}
          range={range}
          shopCodes={shopCodes}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
