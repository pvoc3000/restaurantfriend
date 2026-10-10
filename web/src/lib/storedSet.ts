"use client";

import { useCallback, useSyncExternalStore } from "react";

// A small SET of strings kept in localStorage — a per-user DISPLAY preference,
// like column order and column widths (`lib/columnOrder`, whose shape this
// follows): `useSyncExternalStore`, so the server renders the empty set and the
// stored one arrives at hydration without a mismatch.

const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; parsed: readonly string[] }>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): readonly string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY; // Private mode — the default rather than a crash.
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.parsed;

  let parsed: readonly string[] = EMPTY;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (Array.isArray(value)) parsed = value.filter((v): v is string => typeof v === "string");
    } catch {
      parsed = EMPTY; // A corrupt entry is ignored rather than breaking the page.
    }
  }
  cache.set(key, { raw, parsed });
  return parsed;
}

/** The stored strings under `key`, and a setter. Empty until hydration. */
export function useStoredSet(key: string): [readonly string[], (next: readonly string[]) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );
  const set = useCallback(
    (next: readonly string[]) => {
      try {
        if (next.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not being able to persist should not stop the choice working now.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [stored, set];
}
