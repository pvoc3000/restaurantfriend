"use client";

// Whether the page CHROME is collapsed — the masthead down to its strip, and
// on the order guide the shelf (title, day picker, vendor totals, filters) out
// of the way entirely. One flag, because one button drives both: everything
// that isn't the list itself goes together (Mark, 2026-07-29).
//
// A per-user DISPLAY preference, so localStorage rather than the URL or a
// cookie (the same rule that puts column widths there and filters in the query
// string).
//
// Read through useSyncExternalStore rather than an effect + setState: the
// server has no localStorage, so the server snapshot is "expanded" and React
// swaps in the stored value after hydration without a mismatch — and without a
// setState in an effect, which the lint config rejects. Booleans are
// referentially stable, so unlike columnWidths this needs no parse cache.

import { useSyncExternalStore } from "react";

// The key still says "menu" — it predates the flag growing to cover the shelf,
// and renaming it would silently re-expand the chrome for anyone who had set it.
const KEY = "rf.chrome.menuCollapsed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab collapsing the chrome should collapse it here too — one iPad
  // and one laptop on the same account is the normal case.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode / storage disabled — the chrome simply stays put.
    return false;
  }
}

export function setChromeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Not being able to persist shouldn't stop the toggle working this session.
  }
  for (const listener of listeners) listener();
}

export function useChromeCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
