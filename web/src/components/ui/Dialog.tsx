"use client";

import { useEffect, type ReactNode } from "react";

/**
 * THE floating dialog. A white rectangle with a 2px black edge, a black title
 * bar in caps, and no shadow and no radius — the design system's elevation rule
 * is that depth is edges.
 *
 * It exists because there were three hand-rolled copies of it (Generate POs,
 * Add item, the PO email compose) and this is the point where a fourth would
 * have been written. Each of them had learned a different subset of the same
 * lessons, which is exactly the failure mode CLAUDE.md warns about: the second
 * version never behaves quite like the first.
 *
 * Two properties are load-bearing rather than decorative:
 *
 * - **`text-ink whitespace-normal` on the panel.** A dialog is often a DOM CHILD
 *   of whatever triggered it, and `position: fixed` moves the box, not its place
 *   in the tree, so every INHERITED property cascades straight in. Two have bitten
 *   already: `text-white` from the black ActionBar, which rendered the Generate
 *   POs vendor names white on white (Mark, 2026-07-27); and `white-space: nowrap`
 *   from a `DataTable` cell's `truncate`, which stopped every paragraph in the
 *   vendor-item delete dialog from wrapping and ran the sentences straight off
 *   the panel's right edge. Both are set once here so no future line can fall
 *   into either.
 * - **The title bar and footer are PINNED and only the middle scrolls**
 *   (`max-h-[85vh] flex flex-col` here, `min-h-0 flex-1 overflow-y-auto` on the
 *   body). The overlay is fixed, so a dialog taller than the window cannot be
 *   scrolled by the page and its footer is simply unreachable — Generate POs
 *   wanted 990px in a 900px window at 12 vendors, putting "Create N POs" 162px
 *   below the fold on the first real ordering day.
 *
 * Deliberately NOT portalled: `position: fixed` already lifts it out of the
 * layout, the three callers have always rendered in place, and `text-ink` covers
 * the one thing staying in the tree costs. Deliberately no focus trap either —
 * none of the three had one, and adding it here would be a behaviour change
 * smuggled into an extraction.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  toolbar,
  width = "max-w-xl",
  top = "pt-[8vh]",
  bodyClassName = "p-6",
  busy = false,
  ariaLabel,
}: {
  /** Shown in the black title bar. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned below the body. Omit for a dialog whose actions sit inline. */
  footer?: ReactNode;
  /** Pinned below the title bar — a search box that must not scroll away. */
  toolbar?: ReactNode;
  /** Tailwind max-width class; the callers want anything from xl to 5xl. */
  width?: string;
  /** How far down the viewport the panel starts. */
  top?: string;
  bodyClassName?: string;
  /** While true the dialog refuses to close — a write is in flight. */
  busy?: boolean;
  /** Defaults to `title` when that's a plain string. */
  ariaLabel?: string;
}) {
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-4 ${top}`}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full ${width} flex-col whitespace-normal border-2 border-ink bg-white text-ink`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 bg-ink px-6 py-3 text-white">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.06em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="px-1 text-[17px] leading-none text-white hover:text-white/70 disabled:opacity-35"
          >
            ✕
          </button>
        </div>

        {toolbar && (
          <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-ink px-6 py-3">
            {toolbar}
          </div>
        )}

        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-4 border-t border-ink px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The two button shapes a dialog footer uses, so five callers don't each write
 * out the same tracking and disabled states. `Cancel` is text, the commit is a
 * black cell — the design system's only two weights of action.
 */
export const DIALOG_CANCEL_CLASS =
  "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted hover:text-ink disabled:opacity-35";

export const DIALOG_COMMIT_CLASS =
  "inline-flex h-9 items-center bg-ink px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-white";

/** A destructive commit — the accent edge, filled on hover, as everywhere else. */
export const DIALOG_DANGER_CLASS =
  "inline-flex h-9 items-center border border-accent bg-white px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35";
