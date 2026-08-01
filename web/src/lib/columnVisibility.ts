"use client";

// Which columns a list shows (Mark, 2026-07-31: "all list views should have a
// button that pops up a menu of the columns that the user can check and uncheck
// to show/hide").
//
// A per-user, PER-DEVICE display preference, so localStorage and
// `useSyncExternalStore` — the same rule and the same mechanism as column
// widths, which this sits beside under the same table key. Not the URL: hiding
// Last ordered is a fact about how you like to read the list, not about the
// view you'd share. And deliberately not the account (Mark's call, 2026-08-01,
// after weighing both): a desk and an iPad want different columns — that's the
// whole reason `compactBelow` exists — so one account-wide layout would fit
// neither, and widths especially are device-shaped.
//
// THREE states per column, two of them stored (Mark's iPad report, 2026-08-01).
// Visibility used to be one hidden-set composed with the responsive compact
// drop, and the combination lied: on an iPad the width tier removed "Order
// via" and "Account" with no stored setting anywhere, so the menu showed them
// CHECKED while the table didn't show them, and unchecking/rechecking changed
// nothing — which reads exactly like desktop settings having followed the
// account to the iPad. Now a column is either explicitly hidden, explicitly
// shown, or untouched — and only the untouched fall to the compact default.
// The reader's explicit choice always beats the width tier, and the menu's
// checkboxes reflect what the table is actually doing.
//
// Stored as the HIDDEN keys and the SHOWN keys rather than one allowlist,
// which matters when the app changes: a column added next month is untouched
// for everyone by default, where a stored allowlist would silently hide it
// from every user who had ever opened the menu. `shown` entries are written
// whenever the reader checks a box — redundant on a wide screen, but they
// record the intent that matters the day the same device is narrow.

import { useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Pure logic — fixture-tested (scripts/fixtures/columnVisibility.fixtures.ts).
// ---------------------------------------------------------------------------

/**
 * Whether the table shows this column right now. Pinned columns always show;
 * an explicit hide beats everything else; the compact drop applies only to
 * columns the reader has never explicitly shown.
 */
export function isColumnVisible(
  column: { key: string; pinned?: boolean; hideWhenCompact?: boolean },
  compact: boolean,
  hidden: ReadonlySet<string>,
  shown: ReadonlySet<string>
): boolean {
  if (column.pinned) return true;
  if (hidden.has(column.key)) return false;
  if (compact && column.hideWhenCompact && !shown.has(column.key)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The store.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

// Referentially stable snapshots — a new Set per read would re-render forever.
const cache = new Map<string, { raw: string | null; parsed: Set<string> }>();
const EMPTY: Set<string> = new Set();

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

function read(fullKey: string): Set<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(fullKey);
  } catch {
    return EMPTY; // Private mode — defaults rather than nothing.
  }
  const hit = cache.get(fullKey);
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
  cache.set(fullKey, { raw, parsed });
  return parsed;
}

function write(fullKey: string, keys: Set<string>) {
  try {
    if (keys.size === 0) window.localStorage.removeItem(fullKey);
    else window.localStorage.setItem(fullKey, JSON.stringify([...keys]));
  } catch {
    // Not being able to persist shouldn't stop the menu working this session.
  }
  announce();
}

/** A table's explicit hide/show sets, and the two ways to change them. */
export function useColumnVisibility(storageKey: string) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => read(`${storageKey}.hidden`),
    () => EMPTY // The server has no localStorage: defaults, then the stored
    // sets arrive at hydration. Same contract as column widths.
  );
  const shown = useSyncExternalStore(
    subscribe,
    () => read(`${storageKey}.shown`),
    () => EMPTY
  );

  const setVisible = useCallback(
    (columnKey: string, visible: boolean) => {
      const nextHidden = new Set(read(`${storageKey}.hidden`));
      const nextShown = new Set(read(`${storageKey}.shown`));
      if (visible) {
        nextHidden.delete(columnKey);
        nextShown.add(columnKey);
      } else {
        nextHidden.add(columnKey);
        nextShown.delete(columnKey);
      }
      write(`${storageKey}.hidden`, nextHidden);
      write(`${storageKey}.shown`, nextShown);
    },
    [storageKey]
  );

  // "Show all" means ALL — including the columns the width tier would drop, or
  // on a narrow screen the button's own label is a second lie.
  const showAll = useCallback(
    (keys: readonly string[]) => {
      write(`${storageKey}.hidden`, new Set());
      write(`${storageKey}.shown`, new Set(keys));
    },
    [storageKey]
  );

  return { hidden, shown, setVisible, showAll };
}
