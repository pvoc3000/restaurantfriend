"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `xl`. The CSS and any measurement taken against it must agree, or
 *  a screen caps its own height at a width where its columns are still
 *  stacked. */
export const WIDE_LAYOUT = "(min-width: 1280px)";

/**
 * Whether the wide layout is on, read in JS so a measured height can agree with
 * the breakpoint the CSS is using.
 *
 * `useSyncExternalStore` rather than an effect: it is what the
 * `set-state-in-effect` lint wants, and it keeps the server render honest —
 * the server snapshot is `false`, so the first paint is the stacked layout and
 * nothing is measured until the client knows its own width.
 */
export function useWideLayout(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const mq = window.matchMedia(WIDE_LAYOUT);
    mq.addEventListener("change", notify);
    return () => mq.removeEventListener("change", notify);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_LAYOUT).matches,
    () => false
  );
}
