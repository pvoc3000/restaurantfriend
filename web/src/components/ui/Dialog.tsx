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
  height = "max-h-[85vh]",
  bodyClassName = "p-6",
  busy = false,
  ariaLabel,
  onSubmit,
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
  /**
   * The panel's vertical size. Defaults to a CAP, so a dialog is as tall as its
   * content and no taller — right for a confirm.
   *
   * A dialog whose whole point is a big pane to look at wants the opposite: a
   * DEFINITE height (`h-[88vh]`), so the body has a real box to fill instead of
   * shrink-wrapping a placeholder. Pass one instead of the cap, not as well —
   * `max-height` beats `height`, so leaving the cap in place would silently
   * clamp anything taller than 85vh.
   */
  height?: string;
  bodyClassName?: string;
  /** While true the dialog refuses to close — a write is in flight. */
  busy?: boolean;
  /** Defaults to `title` when that's a plain string. */
  ariaLabel?: string;
  /**
   * What Enter does — the panel's commit, for a dialog that is a FORM.
   *
   * OPT-IN, and that is the design rather than an unfinished job. This panel's
   * `footer` is arbitrary JSX, so the component genuinely cannot tell which of
   * your buttons is the commit; and it should not guess, because the answer is
   * sometimes "none of them". A dialog is given one iff Enter is unambiguous
   * and safe there:
   *
   * - a CREATE form with fields — New tray, New plan, New employee — where
   *   typing and pressing Enter is what a form has always meant;
   * - NOT a destructive confirm, where a stray Enter is exactly the keystroke
   *   you cannot take back (`DIALOG_DANGER_CLASS` panels have none);
   * - NOT a panel with several peer commands — the export panel's Download
   *   beside Finalize — where "the commit" isn't a single thing.
   *
   * Pass the same guard the commit button's `disabled` uses; an Enter that
   * fires a refused write is worse than one that does nothing.
   */
  onSubmit?: () => void;
}) {
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Enter" || !onSubmit) return;
      // ⌘↵ and friends are somebody else's shortcut (a multiline cell saves on
      // ⌘↵), and an IME's Enter is committing a character, not a form.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;

      const el = document.activeElement;
      // In a TEXTAREA Enter is a newline; on a BUTTON or a link the browser is
      // already about to activate the thing you focused, and committing as well
      // would fire two actions from one keystroke — including "Cancel, then
      // submit anyway".
      if (el instanceof HTMLTextAreaElement) return;
      if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      // An open PickList or ⋯ menu owns Enter — it is choosing an option, and
      // the panel is PORTALLED to the body, so its own handler cannot stop this
      // window listener from seeing the same keystroke.
      if (document.querySelector('[role="listbox"], [role="menu"]')) return;

      e.preventDefault();
      onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, onSubmit]);

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-4 ${top}`}
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
        className={`flex ${height} w-full ${width} flex-col whitespace-normal border-2 border-ink bg-white text-ink`}
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
 *
 * THE BLACK FILL HERE SURVIVED the 2026-08-02 sweep that turned every other
 * button white ("all buttons should be white. Only set filters are black"),
 * and it's the one Mark asked to have flagged rather than changed: inside a
 * modal the footer is a two-weight decision — a text Cancel and the commit —
 * and that pairing is the whole reason the commit is filled. The argument that
 * retired the black button everywhere else was about a filled cell sitting in a
 * ROW of outlined ones, which is not what a dialog footer is. Flip it if Mark
 * says so; it's one line, and GeneratePos's hand-rolled twin now uses it too.
 */
export const DIALOG_CANCEL_CLASS =
  "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted hover:text-ink disabled:opacity-35";

export const DIALOG_COMMIT_CLASS =
  "inline-flex h-9 items-center bg-ink px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-white";

/** A destructive commit — the accent edge, filled on hover, as everywhere else. */
export const DIALOG_DANGER_CLASS =
  "inline-flex h-9 items-center border border-accent bg-white px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35";
