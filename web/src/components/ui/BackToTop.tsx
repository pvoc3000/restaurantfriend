"use client";

import { useSyncExternalStore } from "react";

/**
 * The conventional floating back-to-top control: absent until you've scrolled a
 * screenful, then a black disc above the ActionBar (Mark, 2026-07-29). It used
 * to be a "Top" cell in the bar, which cost a full-width cell and sat with the
 * commands rather than with the scrolling it belongs to.
 *
 * Held to the design system in three ways. The disc is `bg-ink`, matching the
 * command bar directly beneath it, so it reads as chrome over the list rather
 * than as a record on it — colour here would mean state. There is no shadow and
 * no fade: it is simply rendered or not, because the system's rule is no motion
 * on arrival. And the caret is drawn in the same hand as HomeIcon and GearIcon —
 * 16px, currentColor, 1.5px square-capped strokes, no fill.
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
      // bottom-16 clears the 52px ActionBar with 12px to spare; right edge on
      // the page gutter, which steps in below 1280 like every other band.
      // z-30 matches the bar: above the list and its sticky column labels
      // (z-20), below the detail slide-over (z-40) and the masthead (z-50).
      // 48px square — this is pressed standing, so it clears the 44px
      // touch-target minimum.
      className="fixed bottom-16 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-neutral-800 xl:right-12"
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
