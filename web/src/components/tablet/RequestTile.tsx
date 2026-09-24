"use client";

import { NewPurchaseRequest } from "@/components/purchasing/NewPurchaseRequest";

import { TILE_CLASS } from "./tileClass";

export type RequestContext = {
  orgId: string;
  locationId: string;
  userId: string;
  locationCode: string;
};

/**
 * The landing page's "Submit a Purchase Request" — the queue's own
 * `NewPurchaseRequest`, opened from a tile instead of its "New request"
 * button (Mark, 2026-09-24). A client component because the trigger is a
 * function, which the server-rendered `Landing` cannot hand across.
 *
 * The panel closes on success and refreshes the page, so the tile's own line
 * ("2 open requests") is the confirmation that it went.
 */
export function RequestTile({
  label,
  note,
  ...context
}: RequestContext & { label: string; note: string | null }) {
  return (
    <NewPurchaseRequest
      {...context}
      trigger={(open) => (
        <button type="button" onClick={open} className={TILE_CLASS}>
          <span className="font-bold uppercase tracking-[0.04em] text-ink">{label}</span>
          {note && <span className="text-[14px] text-muted">{note}</span>}
        </button>
      )}
    />
  );
}
