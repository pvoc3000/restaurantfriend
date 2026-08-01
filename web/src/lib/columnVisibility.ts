"use client";

// Which columns a list shows (Mark, 2026-07-31: "all list views should have a
// button that pops up a menu of the columns that the user can check and uncheck
// to show/hide").
//
// A per-user DISPLAY preference, so localStorage and `useSyncExternalStore` —
// the same rule and the same mechanism as column widths, which this sits beside
// under the same table key. Not the URL: hiding Last ordered is a fact about
// how you like to read the list, not about the view you'd share.
//
// Stored as the HIDDEN keys rather than the visible ones, which matters when
// the app changes: a column added next month is visible for everyone by
// default, where a stored allowlist would silently hide it from every user who
// had ever opened the menu.

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

// Referentially stable snapshots — a new Set per read would re-render forever.
const cache = new Map<string, { raw: string | null; parsed: Set<string> }>();
const EMPTY: Set<string> = new Set();

function key(storageKey: string) {
  return `${storageKey}.hidden`;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function announce() {
  for (const listener of listeners) listener();
}

function read(storageKey: string): Set<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(storageKey));
  } catch {
    return EMPTY; // Private mode — show everything rather than nothing.
  }
  const hit = cache.get(storageKey);
  if (hit && hit.raw === raw) return hit.parsed;

  let parsed = EMPTY;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (Array.isArray(value)) {
        parsed = new Set(value.filter((v): v is string => typeof v === "string"));
      }
    } catch {
      parsed = EMPTY; // Corrupt entry — ignore rather than break the list.
    }
  }
  cache.set(storageKey, { raw, parsed });
  return parsed;
}

function write(storageKey: string, hidden: Set<string>) {
  try {
    if (hidden.size === 0) window.localStorage.removeItem(key(storageKey));
    else window.localStorage.setItem(key(storageKey), JSON.stringify([...hidden]));
  } catch {
    // Not being able to persist shouldn't stop the menu working this session.
  }
  announce();
}

/** The hidden column keys for a table, and the two ways to change them. */
export function useColumnVisibility(storageKey: string) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => EMPTY // The server has no localStorage: everything shows, then the
    // stored set arrives at hydration. Same contract as column widths.
  );

  const toggle = useCallback(
    (columnKey: string) => {
      const next = new Set(read(storageKey));
      if (next.has(columnKey)) next.delete(columnKey);
      else next.add(columnKey);
      write(storageKey, next);
    },
    [storageKey]
  );

  const showAll = useCallback(() => write(storageKey, new Set()), [storageKey]);

  return { hidden, toggle, showAll };
}
