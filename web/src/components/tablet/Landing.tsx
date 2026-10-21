"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Switch } from "@/components/ui/Switch";
import { useLatestWrite } from "@/lib/latestWrite";
import { createClient } from "@/lib/supabase/client";
import type { Tile, TileGroup, TileKey } from "@/lib/tablet/landing";
import { stepPin, togglePin, withPinned } from "@/lib/tablet/pins";

import type { RequestContext } from "./RequestTile";
import { TileCell, type TileState } from "./TileCell";
import { TILE_CLASS } from "./tileClass";

export type { TileState };

/**
 * The tablet landing page — a page filled with the things a supervisor might
 * need to do (Mark, 2026-09-09), grouped the way he grouped them. Each tile is
 * a door, ≥96px tall so a thumb finds it, at the runners' 16px. The state line
 * is what turns a menu into the shift's routine: "Resume tonight's closing
 * report" is a different page from "Start or Resume a Shift Report".
 *
 * PINNED, AT THE TOP (Mark, 2026-10-20: "an area at the top to display
 * 'Pinned' actions that the user uses often"). The person's own pins
 * (`org_members.tablet_pins`, migration 208 — per person, so the shared iPad
 * shows whoever unlocked it their own), in the order pinned; a pinned tile
 * moves up out of its group (`withPinned`). Nothing pinned, no row.
 *
 * Pinning is an EDIT switch, kept as `?edit=1` like the desk's Edit layout.
 * While it is on no tile is a door: tapping one pins or unpins it, and a
 * pinned one also gets arrows to move it. Saved as you go (`lib/latestWrite`)
 * and held here until the server's copy agrees — a tap never waits.
 */
export function Landing({
  groups,
  state,
  request,
  today,
  pins: serverPins,
}: {
  groups: TileGroup[];
  state: Partial<Record<TileKey, TileState>>;
  /** Who files, and where — null when there is no working shop to file for. */
  request: RequestContext | null;
  /** The org's today — a scanned bill is dated with it. */
  today: string;
  /** This person's pins, already read (`readTileKeys`). */
  pins: TileKey[];
}) {
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(() => searchParams.get("edit") === "1");
  const [pending, setPending] = useState<TileKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pending && pending.join() === serverPins.join()) setPending(null);
  const pins = pending ?? serverPins;
  const { pinned, groups: rest } = withPinned(groups, pins);
  const shown = pinned.map((t) => t.key);

  const save = useLatestWrite<TileKey[]>(
    async (next) => {
      const { error } = await createClient().rpc("set_my_tablet_pins", { p_pins: next });
      return error?.message ?? null;
    },
    (failure) => {
      if (failure) {
        setError(`Could not save your pins: ${failure}`);
        setPending(null);
      }
    },
  );
  function change(next: TileKey[]) {
    setError(null);
    setPending(next);
    save(next);
  }

  function toggleEditing(next: boolean) {
    setEditing(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("edit", "1");
    else url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  const cell = (tile: Tile, isPinned: boolean, i: number) =>
    editing ? (
      <EditTile
        tile={tile}
        pinned={isPinned}
        onToggle={() => change(togglePin(pins, tile.key))}
        onStep={
          isPinned
            ? {
                earlier: i > 0 ? () => change(stepPin(pins, tile.key, -1, shown)) : null,
                later: i < pinned.length - 1 ? () => change(stepPin(pins, tile.key, 1, shown)) : null,
              }
            : null
        }
      />
    ) : (
      <TileCell tile={tile} state={state[tile.key]} request={request} today={today} />
    );

  return (
    <div className="mx-auto max-w-5xl space-y-10 text-[16px]">
      <div className="flex justify-end">
        <Switch checked={editing} onChange={toggleEditing}>
          Edit
        </Switch>
      </div>
      {error && <p className="text-sm text-accent">{error}</p>}

      {(pinned.length > 0 || editing) && (
        <section className="space-y-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">Pinned</h2>
          {pinned.length === 0 ? (
            <p className="text-[14px] text-muted">Tap a tile below to pin it here.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pinned.map((tile, i) => (
                <li key={tile.key} className="flex">
                  {cell(tile, true, i)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rest.map((group) => (
        <section key={group.label} className="space-y-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
            {group.label}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.tiles.map((tile, i) => (
              // `flex` on the cell and `flex-1` on the link: the grid stretches
              // every LI to its row's height, but a link inside is only as
              // tall as its own label, so a two-line tile stood 11px taller
              // than the one-line tiles beside it (Mark, 2026-09-09).
              <li key={tile.key} className="flex">
                {cell(tile, false, i)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * A tile while pinning: the whole tile pins or unpins it — no tile is a door
 * in edit mode — and a pinned one carries ← → to move it. 44px targets, the
 * tablet's floor.
 */
function EditTile({
  tile,
  pinned,
  onToggle,
  onStep,
}: {
  tile: Tile;
  pinned: boolean;
  onToggle: () => void;
  onStep: { earlier: (() => void) | null; later: (() => void) | null } | null;
}) {
  const arrow =
    "mac-control grid h-11 w-11 shrink-0 place-items-center border border-ink bg-white text-[18px] hover:bg-neutral-100 disabled:opacity-35";
  return (
    <div className="flex flex-1 gap-2">
      <button type="button" onClick={onToggle} aria-pressed={pinned} className={`${TILE_CLASS} border-dashed`}>
        <span className="font-bold uppercase tracking-[0.04em] text-ink">{tile.label}</span>
        <span className="text-[14px] text-muted">{pinned ? "Tap to unpin" : "Tap to pin"}</span>
      </button>
      {onStep && (
        <div className="flex flex-col justify-center gap-2">
          <button type="button" aria-label={`Move ${tile.label} earlier`} disabled={!onStep.earlier} onClick={() => onStep.earlier?.()} className={arrow}>
            ←
          </button>
          <button type="button" aria-label={`Move ${tile.label} later`} disabled={!onStep.later} onClick={() => onStep.later?.()} className={arrow}>
            →
          </button>
        </div>
      )}
    </div>
  );
}
