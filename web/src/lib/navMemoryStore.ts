"use client";

// The live half of the remembered menu (lib/navMemory.ts is the pure half).
//
// Why a store and not just the cookie: in the App Router a SERVER layout does
// not re-render when you navigate between sibling routes, so the cookie the
// client writes on arrival can't be read back by the layout for the rest of the
// session — every section tab's href would be frozen at whatever it was on the
// last hard load. So the server seeds the value on first paint (no flash, the
// hrefs are right immediately) and the client owns it from there.
//
// Read through useSyncExternalStore rather than an effect + setState, for the
// same reason lib/columnWidths.ts does: the lint config rejects a setState in an
// effect, and remember() below is an external-store write, not a setState.

import { useCallback, useSyncExternalStore } from "react";

import { EMPTY_NAV_MEMORY, NAV_COOKIE, serializeNavMemory, type NavMemory } from "@/lib/navMemory";

const listeners = new Set<() => void>();

// getSnapshot must return a referentially stable value or React re-renders
// forever, so this object is replaced only when something actually changed.
let memory: NavMemory | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Record where you are. Called on every navigation; a no-op when nothing
 * changed, which is the common case (re-renders that aren't navigations).
 */
export function remember(sectionSlug: string, subSlug: string) {
  const current = memory ?? EMPTY_NAV_MEMORY;
  if (current[sectionSlug] === subSlug) return;

  memory = { ...current, [sectionSlug]: subSlug };
  // Session cookie — no max-age, so it dies with the browser session, and
  // signOut() deletes it so the next person starts from the defaults.
  document.cookie = `${NAV_COOKIE}=${serializeNavMemory(memory)}; path=/; SameSite=Lax`;
  for (const listener of listeners) listener();
}

/**
 * `initial` is the cookie value parsed on the server. It seeds the store on the
 * client's first read, so the server and client snapshots agree and there's no
 * hydration mismatch.
 */
export function useNavMemory(initial: NavMemory): NavMemory {
  const getSnapshot = useCallback(() => {
    if (memory === null) memory = initial;
    return memory;
  }, [initial]);

  const getServerSnapshot = useCallback(() => initial, [initial]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
