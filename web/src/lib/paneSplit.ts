"use client";

import { useSyncExternalStore } from "react";

/**
 * WHERE A DRAGGABLE DIVIDER SITS, per named split, remembered per device.
 *
 * A display preference, so localStorage — the same rule that puts column widths
 * there and filters in the query string. Read through `useSyncExternalStore`
 * rather than an effect plus setState: the server has no localStorage, so the
 * server snapshot is the default and React swaps in the stored value after
 * hydration with no mismatch and nothing for the set-state-in-effect rule to
 * object to.
 *
 * A FRACTION, never pixels. The frames these divide are measured to the window,
 * so a stored pixel offset means something different on a laptop than on the
 * desk monitor — and something absurd after a window resize. A fraction says
 * "give the list about three fifths", which survives both.
 *
 * The receiving screen's `lib/receivingLayout` predates this and keeps its own
 * store, because it also holds a three-valued layout MODE that only that screen
 * has. If a third split ever wants a mode, this is where the two should meet.
 */

const listeners = new Map<string, Set<() => void>>();
/** The last value read or written, so `getSnapshot` is referentially stable. */
const cache = new Map<string, number>();

export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;

export function clampSplit(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

function storageKey(name: string) {
  return `rf.split.${name}`;
}

function read(name: string, fallback: number): number {
  try {
    const raw = Number(window.localStorage.getItem(storageKey(name)));
    return Number.isFinite(raw) && raw > 0 ? clampSplit(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function setSplit(name: string, value: number) {
  const next = clampSplit(value);
  if (cache.get(name) === next) return;
  cache.set(name, next);
  try {
    window.localStorage.setItem(storageKey(name), String(next));
  } catch {
    // A private window with storage disabled still drags; it just forgets.
  }
  for (const listener of listeners.get(name) ?? []) listener();
}

export function useSplit(name: string, fallback: number): number {
  return useSyncExternalStore(
    (onChange) => {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(onChange);
      // `storage` fires in OTHER tabs, which is the point: two windows on the
      // same log should not disagree about the divider after a reload.
      window.addEventListener("storage", onChange);
      return () => {
        set.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      // Cached rather than read straight from localStorage: getSnapshot must be
      // stable between renders or React loops, and a fresh read returns a fresh
      // number every time.
      const held = cache.get(name);
      if (held !== undefined) return held;
      const value = read(name, fallback);
      cache.set(name, value);
      return value;
    },
    () => fallback
  );
}
