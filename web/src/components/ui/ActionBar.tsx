import type { ReactNode } from "react";

/**
 * The screen's own commands, pinned to the bottom in a black bar — inherited
 * from DF Operations, where every layout ended in one. Only for the two or
 * three commands that act on the WHOLE screen; anything that acts on one
 * record belongs next to that record.
 *
 * Fixed rather than sticky so it doesn't depend on the page's own scroll
 * shape; screens that render it must pad their bottom so content can scroll
 * clear of it.
 */
export function ActionBar({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex min-h-[4.5rem] items-stretch bg-ink text-white">
      {note && (
        <div className="flex items-center whitespace-nowrap px-4 text-[12px] uppercase tracking-[0.12em] text-white/55 xl:px-12">
          {note}
        </div>
      )}
      <div className="flex-1" />
      {children}
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
  disabled = false,
  onClick,
  title,
  children,
}: {
  primary?: boolean;
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
      className={`min-w-48 border-l border-white/25 px-8 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors disabled:opacity-35 ${
        primary
          ? "bg-white text-ink hover:bg-neutral-100"
          : "bg-transparent text-white hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
