"use client";

// Where you were in a long list, so leaving it and coming back doesn't cost you
// your place (Mark, 2026-07-30). This is what detail views stopped doing for
// free when they went back to being full-screen pages: the slide-over left the
// list mounted underneath, and a page navigation tears it down and rebuilds it
// at the top.
//
// sessionStorage, not local: a scroll position is about the walk you're on, and
// it should die with the tab the way the guide's view cookie dies with the
// session. Not the URL either — this is nobody's idea of shareable view state.
//
// Restoring is a NEGOTIATION, not a single scrollTo. The list isn't at its full
// height the instant the component mounts (fonts land, the sticky bars measure
// themselves), so an early scrollTo silently clamps to whatever the document
// height is at that moment and leaves you short. We re-assert for a few frames
// until the position sticks — and surrender immediately if the reader starts
// scrolling, because at that point they know better than the memory does.

import { useEffect } from "react";

const PREFIX = "rf.scroll.";

/** ~200ms at 60fps. Long enough for the list to reach full height, short
 *  enough that a scroll you start yourself is never fought for long. */
const SETTLE_FRAMES = 12;

/** Persist at most this often while scrolling; the rest rides on the unmount. */
const WRITE_EVERY_MS = 120;

function read(key: string): number {
  try {
    const y = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(y) && y > 0 ? y : 0;
  } catch {
    // Private mode / storage disabled — the list simply opens at the top.
    return 0;
  }
}

function write(key: string, y: number) {
  try {
    window.sessionStorage.setItem(key, String(Math.round(y)));
  } catch {
    // Not being able to remember is not a reason to break scrolling.
  }
}

/**
 * Remember this page's scroll position under `key`, and put it back on the way
 * in. The key identifies WHAT is being scrolled, not the route — the order
 * guide passes location + date + weekday, so Monday at DF01 and Thursday at
 * DF02 keep their own places instead of sharing one. Changing the key mid-life
 * is fine: the old position is flushed and the new one looked up.
 *
 * Window scroll only. The guide's list is in the page's own flow (there is no
 * inner pane — see OrderGuide), which is the case for every list in the app.
 */
export function useScrollMemory(key: string) {
  useEffect(() => {
    const storageKey = PREFIX + key;
    const target = read(storageKey);

    // While we're still putting the position back, don't record: the values
    // going past are the ones we're scrolling THROUGH, and recording a 0 from
    // the top of a half-built list is exactly how the memory gets erased.
    let restoring = target > 0;
    let frames = 0;

    // The last position we believe in, kept in a variable rather than read back
    // off the window when it's needed: by the time this component unmounts the
    // router may already have scrolled the page somewhere else.
    let latest = 0;
    let moved = false;
    let wroteAt = 0;

    // Throttled by the CLOCK, not by requestAnimationFrame. rAF doesn't run in
    // a hidden tab, so a frame-deferred write can simply never happen — the
    // last thing you did before switching away is exactly what you'd want
    // remembered, and it was the thing being dropped (measured 2026-07-30).
    const onScroll = () => {
      if (restoring) return;
      latest = window.scrollY;
      moved = true;
      const now = performance.now();
      if (now - wroteAt < WRITE_EVERY_MS) return;
      wroteAt = now;
      write(storageKey, latest);
    };

    // The reader taking over ends the argument. Deliberately NOT the scroll
    // event — our own scrollTo fires that, so it would cancel us instantly.
    const surrender = () => {
      restoring = false;
    };

    const settle = () => {
      if (!restoring) return;
      window.scrollTo(0, target);
      frames += 1;
      // Within a pixel is arrived. Otherwise the document is still too short to
      // reach the target, so wait a frame and ask again.
      if (frames < SETTLE_FRAMES && Math.abs(window.scrollY - target) > 1) {
        requestAnimationFrame(settle);
      } else {
        restoring = false;
      }
    };

    // A reload or a closed tab unmounts nothing, so the flush has to happen
    // here too. pagehide rather than unload — iOS Safari fires the one and not
    // the other, and an iPad is what the guide is walked on.
    const flush = () => {
      if (moved) write(storageKey, latest);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", surrender, { passive: true });
    window.addEventListener("touchstart", surrender, { passive: true });
    window.addEventListener("keydown", surrender);
    window.addEventListener("pagehide", flush);
    if (restoring) requestAnimationFrame(settle);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", surrender);
      window.removeEventListener("touchstart", surrender);
      window.removeEventListener("keydown", surrender);
      window.removeEventListener("pagehide", flush);
      // Leaving is the moment that matters, and the throttle may have swallowed
      // the last move. Nothing to say if the reader never scrolled — whatever
      // is stored is still true.
      flush();
    };
  }, [key]);
}
