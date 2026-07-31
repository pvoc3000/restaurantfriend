"use client";

// Column labels that stay on screen while you scroll a list (Mark, 2026-07-31:
// "scrolling in all current and future list views shouldn't hide the column
// titles"). The order guide had always done it; nothing else did.
//
// Shared from here rather than living in DataTable, because the two biggest
// lists in the app — /vendors and /items — hand-roll their own <table> and do
// not use DataTable at all, and /cleanup deliberately predates it. A constant
// and a hook are what those three can actually reuse.
//
// THE TRAP, measured on the vendor list at scrollTop 600 (2026-07-31):
// a sticky header and a horizontal-scroll wrapper are MUTUALLY EXCLUSIVE. An
// element with `overflow-x: auto` is a scroll container — the spec computes
// `overflow-y` to `auto` alongside it — so a sticky cell inside pins to THAT
// box, which never scrolls vertically, and simply leaves with the page. The
// header measured −337px with the wrapper as it was and +64px (the masthead)
// with it visible. `overflow-y: clip` doesn't rescue it either; also measured.
// Hence useOverflowOnlyWhenNeeded below.

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

// One MediaQueryList per threshold, cached: matchMedia objects are cheap but
// not free, and every table on a screen asks the same question.
const queries = new Map<number, MediaQueryList>();

function query(px: number): MediaQueryList {
  let m = queries.get(px);
  if (!m) {
    m = window.matchMedia(`(min-width: ${px}px)`);
    queries.set(px, m);
  }
  return m;
}

/**
 * Is the viewport at least this wide? A media query rather than a stored width,
 * so a re-render happens when the answer CHANGES rather than on every pixel of
 * a window drag.
 *
 * The server snapshot is `true` — the wide answer. SSR has no viewport, and
 * rendering the full table first means a desk browser never flickers; a narrow
 * client swaps to its compact set right after hydration. useSyncExternalStore
 * calls getServerSnapshot during hydration too, so there's no mismatch.
 *
 * A threshold of 0 always matches, which is how a table with no compact set
 * opts out while still calling the hook unconditionally.
 */
export function useViewportAtLeast(px: number): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (px <= 0) return () => {};
      const m = query(px);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [px]
  );

  return useSyncExternalStore(
    subscribe,
    () => (px <= 0 ? true : query(px).matches),
    () => true
  );
}

/**
 * Head-row classes for a table in the PAGE's own flow: its cells stick under
 * the masthead, at whatever height the masthead currently is.
 *
 * On the TH and not the THEAD: in a border-collapse table, sticky on thead or
 * tr is unreliable in WebKit, and iPad Safari at the 16.4 floor is what these
 * lists are read on. The order guide puts it on the th for the same reason.
 *
 * z-20 is the published ladder's sticky-thead rung (tokens/layout.css) — below
 * the ActionBar at 30 and the masthead at 50.
 *
 * The 2px rule is drawn as an inset shadow rather than a border because a
 * sticky cell inside border-collapse loses its bottom border as it detaches,
 * and it rides on the same element so it travels with it.
 */
export const STICKY_HEAD_ROW =
  "[&>th]:sticky [&>th]:top-[var(--rf-header-h)] [&>th]:z-20 [&>th]:bg-white [&>th]:shadow-[inset_0_-2px_0_var(--rf-neutral-900)]";

/**
 * The same, for a table that scrolls inside its OWN pane — it sticks to the top
 * of the pane, and only ever competes with its own rows, so it sits at 10.
 */
export const STICKY_HEAD_ROW_IN_PANE =
  "[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-white [&>th]:shadow-[inset_0_-2px_0_var(--rf-neutral-900)]";

/**
 * Make the wrapper a horizontal-scroll container ONLY when the table genuinely
 * doesn't fit — see the trap above. Every table that fits then gets sticky
 * labels; the ones that don't (at a desk width, the vendor's items table at
 * 1893px and the PO list at 1393) keep their scrollbar instead, which is the
 * case where the layout is already compromised.
 *
 * The class on the wrapper should stay `overflow-x-auto`: that's the safe
 * pre-JS default — it prevents a wide table pushing the whole PAGE sideways on
 * the first paint — and this relaxes it to `visible` once it has measured.
 *
 * Written straight to the node rather than held in state, the same way
 * Receiving sizes its columns: no re-render of eighty rows when the window
 * resizes, and nothing for the set-state-in-effect lint to object to.
 */
export function useOverflowOnlyWhenNeeded(
  ref: React.RefObject<HTMLElement | null>,
  enabled = true
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const measure = () => {
      const table = el.querySelector("table");
      if (!table) return;
      // A pixel of tolerance: a column set sums to whole pixels but its rect can
      // land on a fraction under browser zoom.
      const fits = table.getBoundingClientRect().width <= el.clientWidth + 1;
      el.style.overflowX = fits ? "visible" : "auto";

      // And turn the sticky OFF while it scrolls. A sticky cell inside a scroll
      // container doesn't merely fail to stick: with `top: 64px` and a
      // scrollTop that never leaves 0, the offset PUSHES IT DOWN 64px, so the
      // first rows render above the column labels. Measured 2026-07-31 on the
      // PO list at 1330 — header at y=321, first row at y=299, i.e. the labels
      // sitting below the row they label, with fragments of it peeking over the
      // top. The attribute is what globals.css hangs `position: static` off.
      el.toggleAttribute("data-rf-hscroll", !fits);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The table too, not just the wrapper: dragging a column wider is the one
    // way the answer changes without the window moving.
    const table = el.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [ref, enabled]);
}
