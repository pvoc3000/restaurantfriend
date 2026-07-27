"use client";

// Whether the masthead is collapsed to its strip. A per-user DISPLAY
// preference, so localStorage rather than the URL or a cookie (the same rule
// that puts column widths there and filters in the query string).
//
// Read through useSyncExternalStore rather than an effect + setState: the
// server has no localStorage, so the server snapshot is "expanded" and React
// swaps in the stored value after hydration without a mismatch — and without a
// setState in an effect, which the lint config rejects. Booleans are
// referentially stable, so unlike columnWidths this needs no parse cache.

import { useSyncExternalStore } from "react";

const KEY = "rf.chrome.menuCollapsed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab collapsing the menu should collapse it here too — one iPad and
  // one laptop on the same account is the normal case.
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
    // Private mode / storage disabled — the menu simply stays put.
    return false;
  }
}

export function setMenuCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Not being able to persist shouldn't stop the toggle working this session.
  }
  for (const listener of listeners) listener();
}

export function useMenuCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
