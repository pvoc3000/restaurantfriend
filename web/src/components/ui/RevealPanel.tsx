"use client";

import { useState, type ReactNode } from "react";

/**
 * A section that keeps only its header on screen and shows its body when you
 * point at it.
 *
 * Built for the two paperwork areas (Mark, 2026-08-06): both are a one-line
 * header over a grid of document chips, and the grid was taking a third of the
 * screen to say something you only look at occasionally. Collapsed, the header
 * still carries everything you act on — the title, the count, "Add as" and
 * Attach — so the section is not hidden, only its contents.
 *
 * ---------------------------------------------------------------------------
 * THE BODY IS ABSOLUTELY POSITIONED, AND THAT IS THE WHOLE DESIGN
 *
 * It must not change the page's layout when it opens. Two reasons, and the
 * first is a real bug avoided rather than a preference:
 *
 * On PO detail the paperwork card is a `fixed` footer whose height is MEASURED
 * by `useStickyFooterClearance`, which reserves that much space in the page and
 * feeds `useFillViewportHeight`. If opening grew the card, the spacer would
 * grow, the line table would resize, and the whole page would reflow on every
 * hover. Out of flow, the footer's measured height is always the collapsed one.
 *
 * And generally: a thing that reflows the page on hover moves whatever you were
 * about to click. A transient reveal has to overlay.
 *
 * ---------------------------------------------------------------------------
 * IT OPENS THREE WAYS, AND HOVER IS ONLY ONE
 *
 * Hover alone would make this unreachable on an iPad, which is a device this app
 * is actually used on — the same reason CLAUDE.md keeps rejecting controls that
 * "explain themselves only on hover". So there is also a disclosure toggle,
 * wearing `DataTable`'s dress because that is what an expander looks like here,
 * and it PINS: tapped open, the panel ignores the pointer leaving.
 *
 * Focus counts as well. Tab into anything inside and it stays open, or the act
 * of reaching a control would take it away.
 *
 * ---------------------------------------------------------------------------
 * CLOSED MEANS `visibility: hidden`, NOT UNMOUNTED
 *
 * The bodies here hold PDF `<object>` plugins. Unmounting on every collapse
 * would re-fetch and re-render each of them the next time you pointed at the
 * header, which is slow and visibly flickers. `visibility` also takes the
 * hidden controls out of the tab order for free, which `opacity` would not.
 */
export function RevealPanel({
  direction = "down",
  label,
  header,
  alwaysOpen = false,
  children,
}: {
  /** Which way the body opens. `up` for a footer pinned to the window bottom. */
  direction?: "up" | "down";
  /**
   * Skip the revealing entirely: the body is open, IN FLOW, and there is no
   * toggle. For when the panel has a screen to itself and the reason it hides —
   * that a grid of documents was spending a third of a record on itself — has
   * gone away (Mark, 2026-08-06, moving paperwork onto its own tab).
   *
   * A prop rather than a second component: the header, the drop zone, the
   * progress band and the error line are all the same, and only where the body
   * sits changes. Two components would drift, which is the `ui/Dialog` story.
   */
  alwaysOpen?: boolean;
  /** What the toggle is for, e.g. "paperwork" — read by screen readers. */
  label: string;
  /**
   * The always-visible row. Takes the toggle so the caller can place it — these
   * headers are flex rows with their controls pushed right, and only the caller
   * knows where the triangle belongs in one.
   */
  header: (toggle: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(false);
  const [pointerIn, setPointerIn] = useState(false);
  const [focusIn, setFocusIn] = useState(false);

  // NOTHING TO REVEAL IS NOT A THING TO REVEAL. Both callers pass
  // `items.length > 0 && <grid/>`, which is `false` on an empty file — without
  // this, pointing at the header of a person with no documents would open an
  // empty bordered box, which reads as a panel that failed to load.
  const hasBody = children !== null && children !== undefined && children !== false;
  const open = hasBody && (alwaysOpen || pinned || pointerIn || focusIn);

  const toggle = (
    <button
      type="button"
      onClick={() => setPinned((v) => !v)}
      aria-expanded={open}
      aria-label={pinned ? `Collapse ${label}` : `Keep ${label} open`}
      // `DataTable`'s expander, to the pixel: a bordered box rather than a bare
      // glyph, so it reads as a control and gives a real touch target, filled
      // black when it is holding the panel open.
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-[1.5px] border-ink text-[9px] leading-none transition-colors ${
        pinned ? "bg-ink text-white" : "bg-white text-ink hover:bg-neutral-100"
      }`}
    >
      {open ? (direction === "up" ? "▼" : "▲") : direction === "up" ? "▲" : "▼"}
    </button>
  );

  return (
    <div
      className={alwaysOpen ? undefined : "relative"}
      onMouseEnter={() => setPointerIn(true)}
      onMouseLeave={() => setPointerIn(false)}
      // React's onFocus/onBlur bubble, unlike the native events, so these catch
      // focus anywhere inside without a listener per control.
      onFocus={() => setFocusIn(true)}
      onBlur={() => setFocusIn(false)}
    >
      {/* No toggle when there is nothing to reveal, and none when it is already
          open for good — a control that cannot change anything is noise. */}
      {header(hasBody && !alwaysOpen ? toggle : null)}

      {hasBody && (
      <div
        // Flush against the header with the borders overlapped into one
        // hairline, so an open panel reads as the section having grown rather
        // than as a menu floating near it. No gap, deliberately: an 8px gap is
        // 8px of "not hovering" between the header and the thing it opened.
        //
        // In flow when it is always open: absolute positioning exists so the
        // reveal doesn't reflow the page, and a body that never hides has
        // nothing to avoid. It also drops the 60vh cap, which on a screen of
        // its own would scroll the documents inside a box inside the page.
        className={
          alwaysOpen
            ? "border border-ink bg-white px-4 py-3 -mt-px"
            : `absolute inset-x-0 z-20 max-h-[60vh] overflow-y-auto border border-ink bg-white px-4 py-3 transition-opacity duration-100 ${
                direction === "up" ? "bottom-full -mb-px" : "top-full -mt-px"
              } ${open ? "visible opacity-100" : "invisible opacity-0"}`
        }
      >
        {children}
      </div>
      )}
    </div>
  );
}
