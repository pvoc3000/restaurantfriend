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
// IN MEMORY, and deliberately nowhere else (Mark, 2026-07-31: "should be reset
// on launch or when changing locations"). It was sessionStorage, which survives
// a reload and a sign-out in the same tab, so opening the app could drop you
// two thousand pixels into a list you last saw yesterday with no idea why. A
// module-level Map dies with the page, so a hard load — a launch, a reload, a
// sign-in — always starts at the top, while the thing this exists for still
// works: the (app) layout survives soft navigation, so leaving a list for a
// detail screen and coming back is all one page load. Not the URL either —
// this is nobody's idea of shareable view state.
//
// Changing LOCATION also wipes it (see clearScrollMemory), because the lists
// are location-scoped and where you were in DF01's is not a fact about DF02's.
//
// Restoring is a NEGOTIATION, not a single scrollTo. The list isn't at its full
// height the instant the component mounts (fonts land, the sticky bars measure
// themselves), so an early scrollTo silently clamps to whatever the document
// height is at that moment and leaves you short. We re-assert for a few frames
// until the position sticks — and surrender immediately if the reader starts
// scrolling, because at that point they know better than the memory does.

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/** ~200ms at 60fps. Long enough for the list to reach full height, short
 *  enough that a scroll you start yourself is never fought for long. */
const SETTLE_FRAMES = 12;

/** Persist at most this often while scrolling; the rest rides on the unmount. */
const WRITE_EVERY_MS = 120;

const positions = new Map<string, number>();

function read(key: string): number {
  return positions.get(key) ?? 0;
}

function write(key: string, y: number) {
  positions.set(key, Math.round(y));
}

/**
 * Forget every remembered position. Called when the active location changes —
 * every list in the app is location-scoped, so none of the stored positions
 * describe the lists you're about to be looking at.
 */
export function clearScrollMemory() {
  positions.clear();
}

/**
 * Wipe the memory and go to the top when the location changes.
 *
 * Switching location is a navigation to the SAME url, so nothing moves the
 * window by itself: without this you keep whatever scroll you had, three
 * thousand pixels into a list that now holds different rows. Declared BEFORE
 * useScrollMemory in the shell so the ordering works out — React runs the
 * cleanups first (flushing the old position), then the effects in order, so the
 * clear lands after that flush and before the new key is looked up.
 */
export function useResetScrollOnLocationChange(locationId: string | null) {
  const previous = useRef(locationId);
  useEffect(() => {
    // First mount is not a change — don't fight the page's own initial position.
    if (previous.current === locationId) return;
    previous.current = locationId;
    clearScrollMemory();
    window.scrollTo(0, 0);
  }, [locationId]);
}

// A screen whose identity is NOT its URL names its own key here, and the shell
// uses it instead of the pathname. Exactly one screen needs this so far: the
// order guide shows seven different lists at one path, and arrives at either
// `/order-guide` or `/order-guide?day=4` for the same one, so neither the path
// nor the query identifies what you were looking at.
//
// A module store read through useSyncExternalStore, like columnWidths: the
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

    const target = read(key);

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
      write(key, latest);
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

    // There is deliberately no pagehide flush any more. It existed to catch a
    // reload, which unmounts nothing — but the store is in memory now, so a
    // reload is exactly the moment the position SHOULD be forgotten.
    const flush = () => {
      if (moved) write(key, latest);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", surrender, { passive: true });
    scroller.addEventListener("touchstart", surrender, { passive: true });
    window.addEventListener("keydown", surrender);
    if (restoring) requestAnimationFrame(settle);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", surrender);
      scroller.removeEventListener("touchstart", surrender);
      window.removeEventListener("keydown", surrender);
      // Leaving is the moment that matters, and the throttle may have swallowed
      // the last move. Nothing to say if the reader never scrolled — whatever
      // is stored is still true.
      flush();
    };
  }, [key, ref]);
}
