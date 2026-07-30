"use client";

// Where you were in a long list, so leaving it and coming back doesn't cost you
// your place (Mark, 2026-07-30). This is what detail views stopped doing for
// free when they went back to being full-screen pages: the slide-over left the
// list mounted underneath, and a page navigation tears it down and rebuilds it
// at the top.
//
// It is UNIVERSAL and nothing opts in (Mark, 2026-07-30: "any list view now and
// in the future"). `components/ScrollMemory.tsx` runs it once from the (app)
// layout, keyed by active location + pathname, so a screen gets this by
// existing — there is no hook to remember to call when adding one.
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

import { useEffect, useSyncExternalStore, type RefObject } from "react";

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

// A screen whose identity is NOT its URL names its own key here, and the shell
// uses it instead of the pathname. Exactly one screen needs this so far: the
// order guide shows seven different lists at one path, and arrives at either
// `/order-guide` or `/order-guide?day=4` for the same one, so neither the path
// nor the query identifies what you were looking at.
//
// A module store read through useSyncExternalStore, like chromeStore: the
// override is published by a page deep in the tree and consumed by a component
// in the layout, which no prop can reach.
let override: string | null = null;
const listeners = new Set<() => void>();

function subscribeToOverride(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Name this screen's scroll key for as long as it's mounted. Effects run
 * child-first, so this is set before the shell's own effect reads it — but the
 * shell's first RENDER still sees the default key. That's harmless: the default
 * key for such a screen never gets written to, so its restore finds nothing and
 * does nothing, and the re-render with the real key follows immediately.
 */
export function useScrollMemoryKey(key: string) {
  useEffect(() => {
    override = key;
    for (const listener of listeners) listener();
    return () => {
      // Only clear what we set — a screen replacing another has already
      // published its own key by the time this runs.
      if (override !== key) return;
      override = null;
      for (const listener of listeners) listener();
    };
  }, [key]);
}

/** The published key, or null to fall back to the shell's URL-derived one. */
export function useScrollMemoryKeyOverride(): string | null {
  return useSyncExternalStore(
    subscribeToOverride,
    () => override,
    () => null
  );
}

/**
 * Remember this page's scroll position under `key`, and put it back on the way
 * in. The key identifies WHAT is being scrolled, not the route. Changing the
 * key mid-life is the normal case — the shell holds one of these for the whole
 * session and re-keys on every navigation — so the old position is flushed and
 * the new one looked up.
 *
 * Scrolls the WINDOW by default. Pass `ref` for a list that scrolls inside its
 * own pane instead — DataTable's `scroll` mode, which is the only other place
 * a list can be scrolled in this app. An empty key is a no-op, so a component
 * can call this unconditionally and decide per render whether it applies.
 */
export function useScrollMemory(key: string, ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!key) return;
    // A pane that hasn't rendered has no scroll to remember. Refs are populated
    // before effects run, so this means "not this time", not "not yet".
    const pane = ref ? ref.current : null;
    if (ref && !pane) return;

    const getY = () => (pane ? pane.scrollTop : window.scrollY);
    const setY = (y: number) => {
      if (pane) pane.scrollTop = y;
      else window.scrollTo(0, y);
    };
    // Wheel and touch land on the pane when there is one; a keypress is
    // page-wide either way.
    const scroller: EventTarget = pane ?? window;

    const storageKey = PREFIX + key;
    const target = read(storageKey);

    // While we're still putting the position back, don't record: the values
    // going past are the ones we're scrolling THROUGH, and recording a 0 from
    // the top of a half-built list is exactly how the memory gets erased.
    let restoring = target > 0;
    let frames = 0;

    // The last position we believe in, kept in a variable rather than read back
    // off the scroller when it's needed: by the time this re-keys or unmounts,
    // the router may already have scrolled the page somewhere else.
    let latest = 0;
    let moved = false;
    let wroteAt = 0;

    // Throttled by the CLOCK, not by requestAnimationFrame. rAF doesn't run in
    // a hidden tab, so a frame-deferred write can simply never happen — the
    // last thing you did before switching away is exactly what you'd want
    // remembered, and it was the thing being dropped (measured 2026-07-30).
    const onScroll = () => {
      if (restoring) return;
      latest = getY();
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
      setY(target);
      frames += 1;
      // Within a pixel is arrived. Otherwise the list is still too short to
      // reach the target, so wait a frame and ask again.
      if (frames < SETTLE_FRAMES && Math.abs(getY() - target) > 1) {
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

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", surrender, { passive: true });
    scroller.addEventListener("touchstart", surrender, { passive: true });
    window.addEventListener("keydown", surrender);
    window.addEventListener("pagehide", flush);
    if (restoring) requestAnimationFrame(settle);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", surrender);
      scroller.removeEventListener("touchstart", surrender);
      window.removeEventListener("keydown", surrender);
      window.removeEventListener("pagehide", flush);
      // Leaving is the moment that matters, and the throttle may have swallowed
      // the last move. Nothing to say if the reader never scrolled — whatever
      // is stored is still true.
      flush();
    };
  }, [key, ref]);
}
