"use client";

import { useCallback, useState } from "react";

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

/**
 * `useState` that seeds from the store and writes through on every change.
 *
 * The key is read ONCE, when the component mounts — which is right for every
 * caller here (a constant per list) and would be wrong for a key that changes
 * under a live component, since the state would not re-seed. If one ever needs
 * that, compare the key during render the way `BatchHistory` does rather than
 * reaching for an effect.
 */
export function useRememberedView<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : fallback
  );
  const set = useCallback(
    (next: T) => {
      store.set(key, next);
      setValue(next);
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
