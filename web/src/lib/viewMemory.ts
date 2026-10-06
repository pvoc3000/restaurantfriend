"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * HOW YOU HAD A LIST SET UP, kept while you walk from record to record (Mark,
 * 2026-08-09: "when navigating using the buttons in the upper right hand corner
 * of the detail screen, I'd like the search and filters to be retained").
 *
 * The buttons are `ui/RecordNav` — first/previous/next/last through the found
 * set — and the screens they walk carry lists of their own: a batch log has
 * thirty batches with a search box and a grouping over them. Those controls are
 * local `useState` in a client component, and stepping to the next record
 * unmounts it, so a search you typed to find the glazes was gone the moment you
 * moved to the next day. Walking records is precisely the case where you want
 * the same view applied to each one.
 *
 * IN MEMORY, exactly like `lib/scrollMemory` and `lib/recordSet`, and for the
 * same reason: the (app) layout survives soft navigation, so a walk through
 * twenty records is one page load. A hard load has nothing worth restoring —
 * being dropped tomorrow into a list silently narrowed by a term you typed
 * yesterday is the trap this deliberately avoids, and it is also why this is not
 * localStorage. Not the URL either: `RecordNav`'s hrefs come from the published
 * record set and know nothing about the screen they land on, so putting it there
 * would mean every list publishing its own query into every link.
 *
 * A KEY PER CONTROL, not per record. That is the whole point — the value has to
 * outlive the record it was set on.
 */
const store = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

/**
 * THE ONE HARD LOAD THAT DOES RESTORE: unlocking after an idle lock (Mark,
 * 2026-10-06 — a baker timed out mid batch log and had every picker to set
 * again). The rule above still holds everywhere else. This is not tomorrow's
 * stale search: it is the same person, minutes later, on the page the lock took
 * from them, and `resumeViewFor` gives it to nobody else.
 *
 * `IdleLock` snapshots the store beside the page's path; `LockScreen` hands the
 * snapshot over in sessionStorage — this tab's, read once here and deleted —
 * because the unlock is a second full load and the Map cannot cross it.
 */
const HANDOVER_KEY = "rf.view.handover";

if (typeof window !== "undefined") {
  try {
    const raw = sessionStorage.getItem(HANDOVER_KEY);
    sessionStorage.removeItem(HANDOVER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) store.set(key, value);
    }
  } catch {
    // Blocked storage or a corrupt value: the screen starts clean.
  }
}

/** Everything remembered, for `IdleLock` to keep across the lock. */
export function snapshotViewMemory(): Record<string, unknown> {
  return Object.fromEntries(store);
}

/** Leave a snapshot for the page this tab is about to load. Never throws. */
export function handOverViewMemory(view: Record<string, unknown> | null): void {
  try {
    if (view) sessionStorage.setItem(HANDOVER_KEY, JSON.stringify(view));
    else sessionStorage.removeItem(HANDOVER_KEY);
  } catch {
    // Blocked storage: the page comes back, without its view.
  }
}

/**
 * `useState` that seeds from the store and writes through on every change.
 *
 * `useSyncExternalStore`, not `useState`, since the handover: the SERVER
 * renders every control at its fallback, so a restored value read in a
 * `useState` initializer would be a hydration mismatch. This hydrates at the
 * fallback and re-renders with the stored value, which is what the hook is for.
 *
 * A value that came through the handover is JSON from storage, so a caller with
 * a closed vocabulary checks it (see `BatchItemsTable`'s `isGrouping`).
 */
export function useRememberedView<T>(key: string, fallback: T): [T, (next: T) => void] {
  // The first fallback, kept: callers pass `[]` and `{…}` literals, and a
  // snapshot that changes identity every render is a loop.
  const [initial] = useState(fallback);
  const subscribe = useCallback(
    (notify: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(notify);
      return () => {
        set.delete(notify);
      };
    },
    [key]
  );
  const value = useSyncExternalStore(
    subscribe,
    () => (store.has(key) ? (store.get(key) as T) : initial),
    () => initial
  );
  const set = useCallback(
    (next: T) => {
      store.set(key, next);
      for (const notify of listeners.get(key) ?? []) notify();
    },
    [key]
  );
  return [value, set];
}

// NO `clearViewMemory()`. The obvious companion would be one called on sign-out
// — except `signOut` is a SERVER action and cannot reach a client module's Map,
// so the function would have looked like protection while doing nothing. It is
// also unnecessary: this store dies with the page, and signing out is a full
// load, so the next person starts clean by construction. That is the same
// reasoning `lib/scrollMemory` gives for being in memory rather than
// sessionStorage, which really did survive a sign-out in the same tab.
