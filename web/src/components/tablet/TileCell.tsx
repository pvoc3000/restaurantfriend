import Link from "next/link";

import type { Tile } from "@/lib/tablet/landing";

import { RequestTile, type RequestContext } from "./RequestTile";
import { ScanBillTile } from "./ScanBillTile";
import { ScanEmployeeTile } from "./ScanEmployeeTile";
import { TILE_CLASS } from "./tileClass";

/** What a tile says about itself today, and where it really goes. */
export type TileState = {
  /** One muted line under the label — what is outstanding — or null. */
  note: string | null;
  /** A more specific destination than the tile's own (a draft's runner). */
  href?: string;
};

/**
 * ONE TILE — a door, or one of the three that ARE the command (a purchase
 * request, a bill scan, an employee scan), which act in place. Shared by the
 * tablet landing page and the desk's Actions widget (2026-10-20), so "Run the
 * Order Guide" is the same thing in both.
 */
export function TileCell({
  tile,
  state,
  request,
  today,
}: {
  tile: Tile;
  state?: TileState;
  /** Who files, and where — null when there is no working shop to file for. */
  request: RequestContext | null;
  /** The org's today — a scanned bill is dated with it. */
  today: string;
}) {
  if (tile.key === "purchase_request" && request) {
    return <RequestTile label={tile.label} note={state?.note ?? null} {...request} />;
  }
  if (tile.key === "scan_bill" && request) {
    return (
      <ScanBillTile
        label={tile.label}
        orgId={request.orgId}
        locationId={request.locationId}
        locationCode={request.locationCode}
        today={today}
      />
    );
  }
  if (tile.key === "scan_employee" && request) {
    return <ScanEmployeeTile label={tile.label} orgId={request.orgId} />;
  }
  return (
    <Link href={state?.href ?? tile.href} className={TILE_CLASS}>
      <span className="font-bold uppercase tracking-[0.04em] text-ink">{tile.label}</span>
      {state?.note && <span className="text-[14px] text-muted">{state.note}</span>}
    </Link>
  );
}
