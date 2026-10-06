"use client";

// WHICH CHECKLISTS SOMEBODY HAS ALREADY WALKED AWAY FROM, on this device.
//
// Mark, 2026-10-06: "flag checklist rows that haven't been completed yet, but
// not until the user leaves the checklist page. I don't want to overwhelm them
// when they first look at a checklist, but if they navigate away without
// completing something, or everything, it's fair to flag the things they
// missed."
//
// localStorage, like every other thing only this screen wants to remember, and
// read through useSyncExternalStore for `lib/receivingLayout`'s reason: the
// server renders "not left" and the stored answer arrives at hydration.

import { useEffect, useSyncExternalStore } from "react";
import { withLeftRun } from "./checklists";

const KEY = "rf.checklists.left";

function read(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A leave is written a tick AFTER the walk unmounts, and a mount cancels it.
 * React's dev double-mount unmounts and remounts in one breath, and without
 * this the first look at a checklist would already count as having left it.
 */
const leaving = new Map<string, number>();

// Nothing changes the answer while the walk is mounted — it is only ever
// written after an unmount — so there is nothing to subscribe to.
const subscribe = () => () => {};

/** Has this checklist been left before, with something still unanswered? */
export function useLeftBefore(runId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => read().includes(runId),
    () => false,
  );
}

/**
 * Remember that the walk was left, when it is left with rows unanswered.
 * `outstanding` is read at the moment of leaving, so a walk completed before
 * you turn the page records nothing.
 */
export function useNoteLeaving(runId: string, outstanding: boolean) {
  useEffect(() => {
    window.clearTimeout(leaving.get(runId));
    leaving.delete(runId);
    if (!outstanding) return;
    return () => {
      leaving.set(
        runId,
        window.setTimeout(() => {
          leaving.delete(runId);
          try {
            window.localStorage.setItem(KEY, JSON.stringify(withLeftRun(read(), runId)));
          } catch {
            // Not being able to remember costs a red fill, nothing else.
          }
        }, 0),
      );
    };
  }, [runId, outstanding]);
}
