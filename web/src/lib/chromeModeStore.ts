"use client";

// The live half of the chrome-mode preference (lib/chromeMode.ts is the pure
// half). Mirrors lib/navMemoryStore exactly, including why it exists: in the App
// Router a SERVER layout does not re-render on soft navigation, so a cookie the
// client writes can't be read back by the layout for the rest of the session.
// The server seeds the value on first paint and the client owns it from there.
//
// The mutation lives in getSnapshot and NOT in getServerSnapshot, which matters
// more here than it looks: this module is evaluated once per server PROCESS, so
// a write during SSR would leak one user's chrome to the next request. React
// only calls getServerSnapshot on the server, and that one just returns the
// value the layout passed in.

import { useCallback, useSyncExternalStore } from "react";

import {
  CHROME_COOKIE,
  CHROME_COOKIE_MAX_AGE,
  type ChromeMode,
} from "@/lib/chromeMode";

const listeners = new Set<() => void>();

// Referentially stable by construction — a string, so unlike columnWidths this
// needs no parse cache.
let mode: ChromeMode | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function setChromeMode(next: ChromeMode) {
  if (mode === next) return;

  mode = next;
  document.cookie = `${CHROME_COOKIE}=${next}; path=/; max-age=${CHROME_COOKIE_MAX_AGE}; SameSite=Lax`;
  for (const listener of listeners) listener();
}

/**
 * `initial` is the cookie value parsed on the server. It seeds the store on the
 * client's first read, so the two snapshots agree and there's no hydration
 * mismatch — and it means the toggle is a single client re-render rather than a
 * round trip, because the layout hands down BOTH chromes already composed.
 */
export function useChromeMode(initial: ChromeMode): ChromeMode {
  const getSnapshot = useCallback(() => {
    if (mode === null) mode = initial;
    return mode;
  }, [initial]);

  const getServerSnapshot = useCallback(() => initial, [initial]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
