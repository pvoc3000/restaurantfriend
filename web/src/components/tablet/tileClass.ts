/**
 * A landing tile's box. `mac-control` — the Mac look's shadow, grey hover and
 * press (Mark, 2026-09-10: "those are buttons afterall"). Its own module
 * because `Landing` (server) draws links with it and `RequestTile` (client) a
 * button, and the button must look like its neighbours.
 */
export const TILE_CLASS =
  "mac-control flex min-h-24 flex-1 flex-col justify-center gap-1 border border-ink bg-white px-5 py-4 text-left no-underline transition-colors hover:bg-neutral-100 active:bg-neutral-200";
