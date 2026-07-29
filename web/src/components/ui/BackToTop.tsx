"use client";

import { useSyncExternalStore } from "react";

/**
 * The conventional floating back-to-top control: absent until you've scrolled a
 * screenful, then a disc above the ActionBar (Mark, 2026-07-29). It used to be a
 * "Top" cell in the bar, which cost a full-width cell and sat with the commands
 * rather than with the scrolling it belongs to.
 *
 * It is currently a DELIBERATE exception to the design system, on request: grey
 * fill and a soft drop shadow, where the system says chrome is black and
 * elevation doesn't exist. See the className for what to change to put it back.
 *
 * What still holds: no fade — it is simply rendered or not, because the rule is
 * no motion on arrival. And the caret is drawn in the same hand as HomeIcon and
 * GearIcon — 16px, currentColor, 1.5px square-capped strokes, no fill.
 */

/** A screenful-ish. Below this the page barely moved and the button is noise. */
const APPEARS_AFTER = 400;

function subscribe(onChange: () => void) {
  // Passive: this listener only reads scrollY, so it must never block scrolling
  // — the guide is the longest page in the app and it's scrolled by thumb.
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * useSyncExternalStore rather than an effect + setState, the same choice as
 * chromeStore and columnWidths: the server has no scroll position, and a
 * setState in an effect is what the lint config rejects. The snapshot is a
 * boolean, so it's referentially stable and can't loop.
 */
function useScrolledDown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.scrollY > APPEARS_AFTER,
    () => false
  );
}

export function BackToTop() {
  const show = useScrolledDown();
  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "auto" })}
      aria-label="Back to the top of the list"
      title="Back to the top of the list"
      // bottom-16 clears the 52px ActionBar with 12px to spare.
      //
      // right-3 at EVERY width — 12px, deliberately not the page gutter (Mark,
      // 2026-07-29 asked for it closer to the edge; it was 48px on desktop,
      // aligned with the content like the four black bands). It shouldn't align
      // with them: this thing floats over the list instead of sitting in the
      // column, and convention puts a floating control near the window edge, not
      // indented to the text. So it no longer steps in at 1280 either.
      //
      // z-30 matches the bar: above the list and its sticky column labels
      // (z-20), below the detail slide-over (z-40) and the masthead (z-50).
      // 48px square — this is pressed standing, so it clears the 44px
      // touch-target minimum.
      //
      // GREY + SHADOW: deliberately against the design system, on request to
      // see it (Mark, 2026-07-29 — "I may decide it's bad but want to see it").
      // Two rules broken, both worth naming so this is easy to undo:
      //  - "chrome is black, not grey" (colors.css --rf-surface-chrome). The
      //    grey is --rf-neutral-600, the darkest that still reads as grey rather
      //    than as failed black, and white-on-it clears AA.
      //  - "elevation: there is none" (elevation.css), which is why the shadow
      //    has to be an arbitrary value — @theme sets --shadow-*: initial, so
      //    shadow-md and friends don't exist to use.
      // To revert: bg-[var(--rf-neutral-600)] → bg-ink, drop both shadow-*
      // classes, hover back to hover:bg-neutral-800.
      className="fixed bottom-16 right-3 z-30 grid h-12 w-12 place-items-center rounded-full bg-[var(--rf-neutral-600)] text-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition-colors hover:bg-[var(--rf-neutral-700)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.28)]"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
        <path
          d="M3 10.5 8 5.5l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </button>
  );
}
