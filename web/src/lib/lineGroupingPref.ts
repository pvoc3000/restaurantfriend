"use client";

// The Items tab's Group by — a per-user DISPLAY preference, so localStorage
// (the rule that puts column widths there), read through useSyncExternalStore
// for `lib/receivingLayout`'s reason: the server renders the default and the
// stored choice arrives at hydration without a mismatch.

import { useSyncExternalStore } from "react";
import { isLineGrouping, type LineGrouping } from "./specialOrderLines";

const KEY = "rf.specialOrderLines.groupBy";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): LineGrouping {
  try {
    const raw = window.localStorage.getItem(KEY);
    return isLineGrouping(raw) ? raw : "none";
  } catch {
    return "none";
  }
}

/**
 * The same choice, read once outside React — for a document being rendered
 * (Mark, 2026-10-07: a quote, invoice or receipt lists its items the way the
 * Items tab does). "none" wherever there is no browser preference to read.
 */
export function readLineGrouping(): LineGrouping {
  return typeof window === "undefined" ? "none" : read();
}

export function useLineGrouping(): [LineGrouping, (next: LineGrouping) => void] {
  const value = useSyncExternalStore(subscribe, read, () => "none" as LineGrouping);
  const set = (next: LineGrouping) => {
    try {
      if (next === "none") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // Not being able to persist shouldn't stop the menu working this session.
    }
    for (const l of listeners) l();
  };
  return [value, set];
}
