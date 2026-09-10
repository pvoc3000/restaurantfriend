/**
 * One cell of the tablet bar. LAYOUT ONLY, per the runners' lesson: a shared
 * class string states geometry and each caller states its own colour, because
 * Tailwind resolves competing utilities by stylesheet order and a `text-white`
 * baked in here could not be overridden at a call site.
 *
 * 64px tall — exactly the 4rem `--rf-header-h` is seeded at in globals.css,
 * so the first paint before the bar has measured itself is already right — and
 * a FIXED 112px wide (Mark, 2026-09-09: "a fixed width. Something generous"),
 * so a row of cells reads as a row of equal keys rather than words of
 * different lengths. 144 was tried and read as too wide (Mark, 2026-09-09);
 * 112 holds "Switch user", the longest word on either bar, on one line.
 */
export const BAR_CELL =
  "inline-flex h-16 w-28 shrink-0 items-center justify-center px-2 text-white no-underline transition-colors hover:bg-white/15 disabled:opacity-35";

/** The same box, dead — an end of the record book, or Back on the landing page. */
export const BAR_CELL_DEAD = "inline-flex h-16 w-28 shrink-0 items-center justify-center px-2 text-white/30";
