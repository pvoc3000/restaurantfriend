"use client";

// Persisted table column widths. These are a per-user display preference, not
// part of the view being shared, so they live in localStorage rather than the
// URL (filters and sort are in the URL — see lib/itemFilters.ts).
//
// Read through useSyncExternalStore rather than an effect: the server has no
// localStorage, so the server snapshot is "no overrides" and React swaps in the
// stored widths after hydration without a mismatch — and without a setState in
// an effect, which the lint config rejects.

import { useCallback, useMemo, useSyncExternalStore } from "react";

export type ColumnWidths = Record<string, number>;

const listeners = new Set<() => void>();

// getSnapshot must return a referentially stable value or React re-renders
// forever, so the parsed object is cached until the raw string changes.
const cache = new Map<string, { raw: string | null; parsed: ColumnWidths }>();

const EMPTY: ColumnWidths = {};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab writing the same key should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSnapshot(storageKey: string): ColumnWidths {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    // Private mode / storage disabled — fall back to defaults.
    return EMPTY;
  }
  const hit = cache.get(storageKey);
  if (hit && hit.raw === raw) return hit.parsed;

  let parsed: ColumnWidths = EMPTY;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object") {
        parsed = Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0)
            .map(([k, v]) => [k, v as number])
        );
      }
    } catch {
      parsed = EMPTY; // Corrupt entry — ignore it rather than crash the screen.
    }
  }
  cache.set(storageKey, { raw, parsed });
  return parsed;
}

function write(storageKey: string, widths: ColumnWidths) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Not being able to persist shouldn't break resizing in this session.
  }
  for (const listener of listeners) listener();
}

/**
 * `defaults` must be a stable reference (a module-level constant) — it's part
 * of the memo key for the merged result.
 */
export function useColumnWidths(storageKey: string, defaults: ColumnWidths) {
  const stored = useSyncExternalStore(
    subscribe,
    useCallback(() => readSnapshot(storageKey), [storageKey]),
    () => EMPTY
  );

  const widths = useMemo(() => ({ ...defaults, ...stored }), [defaults, stored]);

  const setWidth = useCallback(
    (column: string, px: number) => {
      write(storageKey, { ...readSnapshot(storageKey), [column]: Math.round(px) });
    },
    [storageKey]
  );

  const reset = useCallback(() => write(storageKey, {}), [storageKey]);

  const customized = Object.keys(stored).length > 0;

  return { widths, setWidth, reset, customized };
}
