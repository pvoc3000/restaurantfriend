"use client";

import Link from "next/link";
import {
  BAND_LINK_ON_PLAIN,
  BandEmpty,
  GuideBand,
} from "@/components/purchasing/GuideBand";
import { RequestActions } from "@/components/purchasing/RequestActions";
import { REQUEST_PRIORITY_LABEL, type RequestPriority } from "@/lib/purchaseRequests";

/**
 * UNDERLINED AT REST, and that is the whole of what changed on 2026-08-22:
 * this had been `text-muted hover:underline` since the band shipped, which on
 * an iPad (no hover) and beside a muted requester's name is indistinguishable
 * from more description. Mark asked for "a way to go to the inventory item"
 * that was already there and simply did not look like one.
 */
const ITEM_LINK_CLASS =
  "text-muted underline decoration-neutral-400 underline-offset-[3px] hover:text-ink hover:decoration-ink";

export type GuideRequest = {
  id: string;
  request_text: string;
  details: string | null;
  priority: RequestPriority;
  requested_by: string | null;
  /** Who asked — resolved from org_members, since requested_by is an auth id. */
  requesterName: string | null;
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
  onJumpToItem,
  jumpMiss = null,
}: {
  requests: GuideRequest[];
  userId: string;
  /** Purchaser+ — 001's `preq_resolve`, via `canResolveRequests`. */
  canResolve: boolean;
  /** Hold the column open with a sentence when nothing is outstanding. */
  showEmpty?: boolean;
  /**
   * Take me to that item's row in THIS walk (Mark, 2026-08-22). Given, the
   * item name becomes a button that scrolls the guide; withheld, it stays a
   * link to the item record — which is what the Requests LIST wants, where
   * there is no walk to scroll.
   */
  onJumpToItem?: (itemId: string) => void;
  /** The item a jump could not reach, so this row can say why. */
  jumpMiss?: string | null;
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
            {/* Who asked (Mark, 2026-08-22), right after the words they wrote —
                a request is somebody's ask, and on a shared band the name is
                who you go and check with. */}
            {r.requesterName && (
              <span className="text-muted">{r.requesterName}</span>
            )}
            {/* ON THE GUIDE THIS IS A JUMP, NOT A LINK (Mark, 2026-08-22:
                "go to the inventory item on the order guide"). The useful
                destination from here is fifteen feet down this same page —
                the row that lets you order the thing — not a different
                screen. The Requests list keeps the link, where there is no
                walk to scroll to. */}
            {r.inventory_item_id &&
              r.itemName &&
              (onJumpToItem ? (
                <button
                  type="button"
                  onClick={() => onJumpToItem(r.inventory_item_id!)}
                  title={`Go to ${r.itemName} in this walk`}
                  className={ITEM_LINK_CLASS}
                >
                  {r.itemName}
                </button>
              ) : (
                <Link href={`/items/${r.inventory_item_id}`} className={ITEM_LINK_CLASS}>
                  {r.itemName}
                </Link>
              ))}
            {/* Said on the row you pressed rather than as a banner: it is a
                fact about THIS request, and by the time you have read it the
                filters have already been widened in front of you. */}
            {jumpMiss && jumpMiss === r.inventory_item_id && (
              <span className="text-[12px] text-mark">not on today&rsquo;s guide</span>
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
