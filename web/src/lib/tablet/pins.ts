// THE TABLET START'S PINNED ROW, AND THE DESK'S ACTIONS WIDGET (Mark,
// 2026-10-20: "an area at the top to display 'Pinned' actions that the user
// uses often … 'run the order guide' … since I use it a lot", and on the desk
// "a widget where you could add the tablet tiles to it that you used often").
//
// Pure, fixture-tested. Both are an ORDERED LIST OF TILE KEYS chosen by one
// person; two lists, deliberately (Mark: separate) — the tablet's is
// `org_members.tablet_pins` (migration 208), the desk widget's sits in its own
// `start_layout` entry (207). Both are read tolerantly: a tile renamed or
// retired costs its place in the list, never the page.

import { LANDING_GROUPS, type Tile, type TileGroup, type TileKey } from "./landing";

export const TILE_KEYS: readonly TileKey[] = LANDING_GROUPS.flatMap((g) => g.tiles.map((t) => t.key));
const KNOWN = new Set<string>(TILE_KEYS);

/** A stored list as tile keys: unknown keys and second copies dropped, order
 *  kept. Anything that is not an array is an empty list. */
export function readTileKeys(raw: unknown): TileKey[] {
  if (!Array.isArray(raw)) return [];
  const out: TileKey[] = [];
  for (const k of raw) {
    if (typeof k === "string" && KNOWN.has(k) && !out.includes(k as TileKey)) out.push(k as TileKey);
  }
  return out;
}

/** The tiles a role sees, flattened, in the landing page's order. */
export function flatTiles(groups: readonly TileGroup[]): Tile[] {
  return groups.flatMap((g) => g.tiles);
}

/** `keys` as tiles, in the list's order, keeping only the ones this role may
 *  use — a tile the role lost is hidden, not deleted, and comes back with it. */
export function chosenTiles(groups: readonly TileGroup[], keys: readonly TileKey[]): Tile[] {
  const byKey = new Map(flatTiles(groups).map((t) => [t.key, t]));
  return keys.flatMap((k) => byKey.get(k) ?? []);
}

/**
 * The tablet landing page with its pins pulled up: the Pinned row, then the
 * groups WITHOUT the pinned tiles (Mark: a pinned tile moves up rather than
 * showing twice), any group left empty dropped — a heading over nothing is a
 * claim that something is missing.
 */
export function withPinned(
  groups: readonly TileGroup[],
  pins: readonly TileKey[],
): { pinned: Tile[]; groups: TileGroup[] } {
  const pinned = chosenTiles(groups, pins);
  const taken = new Set(pinned.map((t) => t.key));
  return {
    pinned,
    groups: groups
      .map((g) => ({ label: g.label, tiles: g.tiles.filter((t) => !taken.has(t.key)) }))
      .filter((g) => g.tiles.length > 0),
  };
}

/** Pin at the end, or unpin. */
export function togglePin(pins: readonly TileKey[], key: TileKey): TileKey[] {
  return pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
}

/**
 * One place earlier or later AMONG THE ONES SHOWN — a hidden pin (a tile the
 * role lost) is stepped over, so one press always moves the tile on screen. At
 * either end it is a no-op.
 */
export function stepPin(
  pins: readonly TileKey[],
  key: TileKey,
  step: -1 | 1,
  shown: readonly TileKey[],
): TileKey[] {
  const at = shown.indexOf(key);
  const neighbour = shown[at + step];
  if (at === -1 || neighbour === undefined) return [...pins];
  const without = pins.filter((k) => k !== key);
  const n = without.indexOf(neighbour);
  without.splice(step === -1 ? n : n + 1, 0, key);
  return without;
}
