/**
 * One cell of the tablet bar. LAYOUT ONLY, per the runners' lesson: a shared
 * class string states geometry and each caller states its own colour, because
 * Tailwind resolves competing utilities by stylesheet order and a `text-white`
 * baked in here could not be overridden at a call site.
 *
 * 64px tall and at least 64px wide — a 44px thumb target with room to spare,
 * and exactly the 4rem `--rf-header-h` is seeded at in globals.css, so the
 * first paint before the bar has measured itself is already right.
 */
export const BAR_CELL =
  "inline-flex h-16 min-w-16 items-center justify-center px-3 text-white no-underline transition-colors hover:bg-white/15 disabled:opacity-35";

/** The same box, dead — an end of the record book, or Back on the landing page. */
export const BAR_CELL_DEAD = "inline-flex h-16 min-w-16 items-center justify-center px-3 text-white/30";
