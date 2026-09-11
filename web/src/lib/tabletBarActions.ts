"use client";

// A SCREEN'S OWN COMMANDS, SEATED IN THE TABLET BAR.
//
// `lib/recordNavSlot`'s shape and its reason: the bar is in the LAYOUT and the
// commands are the PAGE's, and no prop runs between a layout and the page inside
// it — so the page publishes here and the bar reads it. First caller: the order
// guide's Next favorite and Next section (Mark, 2026-09-10: "should move to the
// upper nav bar on tablets"), which walk a 66,000px list and are pressed
// mid-walk, where the top bar is always on screen and a thumb already is.
//
// Under the desk shell nothing writes here and the bar does not exist.
//
// THE SNAPSHOT CHANGES ONLY WHEN SOMETHING THE BAR DRAWS CHANGES — a word, a
// disabled state, a tooltip. The page publishes on every render (its handlers
// are fresh closures each time), and replacing the snapshot on each would
// re-render the bar for nothing; so the handlers are updated IN PLACE on the
// seated object, and the bar calls whichever is current at the moment of the
// press.

import { useSyncExternalStore } from "react";

export type BarAction = {
  key: string;
  /** The word under the icon, and the button's accessible name. */
  word: string;
  /** A `BarLabel` icon path. */
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled, or what it will do. */
  title?: string;
  /**
   * `leading` sits right after Home; `trailing` (the default) takes the right
   * end. The order guide's Refresh is leading (Mark, 2026-09-10: "move refresh
   * next to the home button").
   */
  side?: "leading" | "trailing";
};

const listeners = new Set<() => void>();
let seated: BarAction[] | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function drawn(a: BarAction[] | null): string {
  return a === null
    ? ""
    : a
        .map(
          (x) =>
            `${x.key}|${x.word}|${x.icon}|${x.disabled ? 1 : 0}|${x.title ?? ""}|${x.side ?? "trailing"}`
        )
        .join("\n");
}

/** A screen seats its commands; `null` gives the seat back. */
export function publishBarActions(next: BarAction[] | null) {
  if (seated !== null && next !== null && drawn(seated) === drawn(next)) {
    // Nothing drawn changed — keep the snapshot, refresh the handlers.
    seated.forEach((action, i) => {
      action.onClick = next[i].onClick;
    });
    return;
  }
  seated = next === null ? null : next.map((action) => ({ ...action }));
  for (const listener of listeners) listener();
}

export function useBarActions(): BarAction[] | null {
  return useSyncExternalStore(
    subscribe,
    () => seated,
    () => null
  );
}
