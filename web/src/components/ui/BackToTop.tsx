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
      // LEFT, not the conventional right (Mark, 2026-07-29). Convention loses to
      // the shape of this screen: the guide puts every control it has in the
      // rightmost column — the −/box/+ stepper, deliberately against the right
      // edge where a thumb lands — so a bottom-right disc floats over the one
      // thing you tap all day and can swallow a + on the last visible row.
      // Bottom-LEFT it covers the Vendor cell, which is text you read and never
      // touch. left-3 at EVERY width: 12px off the window edge rather than the
      // page gutter, because it floats over the list instead of sitting in the
      // column.
      //
      // z-30 matches the bar: above the list and its sticky column labels
      // (z-20), below the detail slide-over (z-40) and the masthead (z-50).
      // 48px square — this is pressed standing, so it clears the 44px
      // touch-target minimum.
      //
      // GREY + SHADOW + TRANSLUCENCE: deliberately against the design system, on
      // request to see it (Mark, 2026-07-29 — "I may decide it's bad but want to
      // see it", then "I like being able to see text underneath it"). Three
      // rules broken, all worth naming so this is easy to undo:
      //  - "chrome is black, not grey" (colors.css --rf-surface-chrome). The
      //    grey is --rf-neutral-600, the darkest that still reads as grey rather
      //    than as failed black.
      //  - "elevation: there is none" (elevation.css), which is why the shadow
      //    has to be an arbitrary value — @theme sets --shadow-*: initial, so
      //    shadow-md and friends don't exist to use.
      //  - opacity as a surface treatment, which the system doesn't otherwise
      //    use. 85% leaves the row legible through the disc and still measures
      //    ~5.1:1 for the white caret over white content — past AA for text, and
      //    well past the 3:1 a glyph needs. Solid on hover, so pressing it feels
      //    like a button rather than a film.
      //
      //    #545454d9 is --rf-neutral-600 at 85%, written as a LITERAL because
      //    neither token-preserving spelling survives the build, both tried:
      //      · an arbitrary var() background with a slash-opacity modifier —
      //        Tailwind can't see a var's alpha, emits a broken var with a
      //        literal ellipsis in it, and Turbopack's CSS parser then rejects
      //        the whole sheet. The dev server 500s.
      //      · an arbitrary color-mix() wrapping the same var — identical
      //        failure, same mangled var.
      //    Do NOT write either spelling in this file even inside a comment:
      //    Tailwind scans comments, so the class is regenerated from the note
      //    describing it and the build breaks again. (That is how this comment
      //    came to be phrased in prose.)
      //    The hex therefore has to be kept in step with the token by hand — if
      //    --rf-neutral-600 ever moves off #545454, this moves with it.
      // To revert: bg-[#545454d9] → bg-ink, drop both shadow-* classes, hover
      // back to hover:bg-neutral-800.
      className="fixed bottom-16 left-3 z-30 grid h-12 w-12 place-items-center rounded-full bg-[#545454d9] text-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition-colors hover:bg-[var(--rf-neutral-700)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.28)]"
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
