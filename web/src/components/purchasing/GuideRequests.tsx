"use client";

import Link from "next/link";
import {
  BAND_LINK_ON_PLAIN,
  BandEmpty,
  GuideBand,
} from "@/components/purchasing/GuideBand";
import { RequestActions } from "@/components/purchasing/RequestActions";
import { REQUEST_PRIORITY_LABEL, type RequestPriority } from "@/lib/purchaseRequests";

export type GuideRequest = {
  id: string;
  request_text: string;
  details: string | null;
  priority: RequestPriority;
  requested_by: string | null;
  inventory_item_id: string | null;
  itemName: string | null;
};

/**
 * WHAT THE SHOP HAS ASKED FOR, at the top of the guide beside the reminders
 * (Mark, 2026-08-22).
 *
 * This REPLACES the "N open requests" link that sat in the guide's sticky
 * controls band from 2026-08-21 until now. That link was defended on the
 * grounds that it was the guide's only route to the Requests screen — which
 * this band now is, and better, because it says WHAT was asked rather than how
 * many. Keeping both would be the same fact twice on one screen, three inches
 * apart, and the second copy would be the less useful one.
 *
 * Known cost, and it is the one the old link was good at: this band scrolls
 * away with the rest of the header, where the controls band sticks. So halfway
 * down the walk there is nothing on screen about requests. That is the right
 * trade — you read this before you set off, which is when it can still change
 * what you buy — but if it turns out to want a sticky presence, the link is
 * five lines and it goes back.
 *
 * THE WHOLE ROW IS THE ASK, and the details are deliberately NOT here: this is
 * a glance before you set off, and a paragraph per row would make the guide's
 * first screenful somebody else's prose. The list screen has them, and the ⋯
 * leads there.
 */
export function GuideRequests({
  requests,
  userId,
  canResolve,
  showEmpty = false,
}: {
  requests: GuideRequest[];
  userId: string;
  /** Purchaser+ — 001's `preq_resolve`, via `canResolveRequests`. */
  canResolve: boolean;
  /** Hold the column open with a sentence when nothing is outstanding. */
  showEmpty?: boolean;
}) {
  if (requests.length === 0 && !showEmpty) return null;

  const allRequests = (
    <Link href="/purchase-requests" className={BAND_LINK_ON_PLAIN}>
      All requests
    </Link>
  );

  if (requests.length === 0) {
    return (
      <GuideBand title="Requests" action={allRequests}>
        <BandEmpty>Nothing outstanding.</BandEmpty>
      </GuideBand>
    );
  }

  return (
    <GuideBand
      title={requests.length === 1 ? "Request" : `${requests.length} requests`}
      action={allRequests}
    >
      <ul className="space-y-1">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-sm">
            {/* The band is plain, so what state a request has is carried by the
                marks inside it — the same yellow the list uses, and only for
                the priority that is worth an eye. Normal and low say nothing,
                because a chip on every row marks nothing. */}
            {r.priority === "high" && (
              <span className="border border-ink px-1 text-[11px] uppercase tracking-[0.12em] text-mark">
                {REQUEST_PRIORITY_LABEL.high}
              </span>
            )}
            <span className="text-ink">{r.request_text}</span>
            {r.inventory_item_id && r.itemName && (
              <Link
                href={`/items/${r.inventory_item_id}`}
                className="text-muted hover:underline"
              >
                {r.itemName}
              </Link>
            )}
            {/* Answering one WHILE WALKING is the point of it being here: you
                pass the shelf, you put it on the order, you say so. The same
                menu the list row carries, so there is one place the two exits
                are written. */}
            <span className="ml-auto">
              <RequestActions
                id={r.id}
                status="open"
                itemId={r.inventory_item_id}
                itemName={r.itemName}
                userId={userId}
                canResolve={canResolve}
                isAuthor={r.requested_by === userId}
                label={`Actions for ${r.request_text}`}
              />
            </span>
          </li>
        ))}
      </ul>
    </GuideBand>
  );
}
