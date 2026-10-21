import { tilesForRole } from "@/lib/tablet/landing";
import { flatTiles } from "@/lib/tablet/pins";

import { ActionTiles } from "../ActionTiles";
import type { StartContext } from "./shared";

/**
 * ACTIONS — the tablet tiles somebody reaches for most, on the desk (Mark,
 * 2026-10-20: "a desktop widget where you could add the tablet tiles to it
 * that you used often … called 'Actions'"). Its list is its own, chosen from
 * the widget's corner menu; the tablet's Pinned row keeps a separate one.
 * Tiles are the role's (`tilesForRole`, the same gate as the tablet page), so
 * a tile the role cannot use is never offered or drawn.
 */
export async function ActionsWidget(ctx: StartContext) {
  return (
    <ActionTiles
      tiles={flatTiles(tilesForRole(ctx.role))}
      request={{
        orgId: ctx.orgId,
        locationId: ctx.shop.id,
        userId: ctx.session.userId,
        locationCode: ctx.shop.code,
      }}
      today={ctx.today}
    />
  );
}
