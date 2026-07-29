import type { ReactNode } from "react";

/**
 * The screen's own commands, pinned to the bottom in a black bar — inherited
 * from DF Operations, where every layout ended in one. Only for the two or
 * three commands that act on the WHOLE screen; anything that acts on one
 * record belongs next to that record.
 *
 * Fixed rather than sticky so it doesn't depend on the page's own scroll
 * shape; screens that render it must pad their bottom so content can scroll
 * clear of it — 52px of bar wants pb-22, and if one changes so does the other.
 *
 * 52px, down from 72 (Mark, 2026-07-29 — the bar was taller than it needed to
 * be, then "a little taller than that" when 44 was proposed). 44 is the hard
 * floor rather than the target: these are the cells you press standing, over
 * and over, and 44 is the touch-target minimum, so 52 keeps 8px of margin over
 * it. The masthead's bands could go to 28 because you tap them once before you
 * start walking; this bar cannot.
 *
 * Two groups, pinned to opposite edges (Mark, 2026-07-29): `children` are the
 * things that ACT on the screen, `trailing` the things that only move you
 * around it. Splitting them means a command that changes data can never sit
 * next to one that just scrolls, so a mis-tap crosses the gap rather than
 * landing one cell over. The bar carried a context note between them and no
 * longer does — the screen's own header says the same thing.
 */
export function ActionBar({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex min-h-13 items-stretch bg-ink text-white">
      {/* The rule that separates cells belongs on the side facing the middle,
          or the group's outermost cell draws a stray 1px line against the
          window edge. So it falls AFTER each cell on the left and BEFORE each
          cell on the right — the two groups are mirror images. Set here rather
          than on the button, because which side a cell faces is a fact about
          the group it's in, not about the button. */}
      <div className="flex items-stretch [&>button]:border-r [&>button]:border-white/25">
        {children}
      </div>
      <div className="flex-1" />
      {trailing && (
        <div className="flex items-stretch [&>button]:border-l [&>button]:border-white/25">
          {trailing}
        </div>
      )}
    </div>
  );
}

/**
 * One cell of the bar: a black cell separated from its neighbour by a faint
 * rule. `primary` fills it white instead — at most one per bar.
 *
 * Nothing uses `primary` today. The order guide, the app's only ActionBar, had
 * it on Generate POs and dropped it (Mark, 2026-07-26): against the bar's own
 * black, a white cell read as a different kind of object rather than as the
 * important one. The variant stays because it's part of the design system's
 * vocabulary, but prefer plain cells until a bar genuinely needs a hierarchy.
 */
export function ActionBarButton({
  primary = false,
  compact = false,
  disabled = false,
  onClick,
  title,
  children,
}: {
  primary?: boolean;
  /**
   * Drops the uniform min-width, for a cell whose label is a single short word.
   * Five full-width cells come to 800px and overflow a 768px bar; the honest
   * fix is to let the one-word cell be one word wide rather than make every
   * other label wrap to fit.
   */
  compact?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // No border here — ActionBar's groups own it, since the side it falls on
      // depends on which edge the cell is pinned to.
      //
      // Narrower cells and tighter padding below 1280: four cells at the old
      // 192px + px-8 came to 768px, exactly an iPad portrait window, which left
      // the two groups touching in the middle with no gap between them.
      // Explicitly a centering flex box. The cells are align-self: stretch to
      // fill the bar, and a stretched button's label centring is left to the UA
      // — so state it rather than inherit it (Mark, 2026-07-29). text-center
      // covers the wrapped case, where the label is an anonymous flex item that
      // justify-center alone would not centre line-by-line.
      className={`flex items-center justify-center px-5 text-center text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors disabled:opacity-35 xl:px-8 ${
        compact ? "" : "min-w-40 xl:min-w-48"
      } ${
        primary
          ? "bg-white text-ink hover:bg-neutral-100"
          : "bg-transparent text-white hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
