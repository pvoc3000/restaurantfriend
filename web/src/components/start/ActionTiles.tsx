"use client";

import { TileCell } from "@/components/tablet/TileCell";
import type { RequestContext } from "@/components/tablet/RequestTile";
import type { Tile } from "@/lib/tablet/landing";
import { chosenTiles } from "@/lib/tablet/pins";

import { useWidgetSettings } from "./widgetSettings";

/**
 * THE ACTIONS WIDGET'S TILES — the tablet's own tiles (`tablet/TileCell`), the
 * ones chosen for this widget, in that order. The choice is read from the grid
 * (`widgetSettings`) so Choose actions… shows at once; the tiles a role may
 * use come from the server. One column narrow, two from two columns, three at
 * three.
 */
export function ActionTiles({
  tiles,
  request,
  today,
}: {
  /** Every tile this role may use, in the landing page's order. */
  tiles: Tile[];
  request: RequestContext | null;
  today: string;
}) {
  const { actions } = useWidgetSettings();
  const chosen = chosenTiles([{ label: "", tiles }], actions);
  if (chosen.length === 0) {
    return <p className="text-sm text-muted">No actions chosen. Pick them with Choose actions… in Edit layout.</p>;
  }
  return (
    <ul className="grid gap-3 text-[16px] @xl:grid-cols-2 @4xl:grid-cols-3">
      {chosen.map((tile) => (
        <li key={tile.key} className="flex">
          <TileCell tile={tile} request={request} today={today} />
        </li>
      ))}
    </ul>
  );
}
