"use client";

import { useMemo, useState } from "react";

/**
 * A list of server rows, with the edits just made shown AHEAD of the server.
 *
 * WHY IT EXISTS (Mark, 2026-09-23: a checklist tap took three seconds to
 * show). Screens here write through supabase-js and then `router.refresh()`,
 * which re-runs the whole route — and the control only changed once that came
 * back, because the only state it had was the server's. This lays each write
 * over its row the moment it is made, and the refresh still runs to catch up
 * everything else on the page (counts, totals, other people's changes).
 *
 * THE RULES, which are the whole design:
 * - A write's patch is shown at once, merged over its row by `id`.
 * - A FAILED write (the callback returns false) drops that row's patch, so the
 *   row falls back to what the database holds. Say why in the caller.
 * - The patches are dropped when fresh rows arrive from the server AND nothing
 *   is in flight. The in-flight guard matters: every refresh hands every row a
 *   new object, so without it, tapping two rows in quick succession would flick
 *   the second back to its old value when the FIRST write's refresh landed.
 *   It is done by adjusting state while rendering rather than in an effect, so
 *   there is never a frame of the old value.
 *
 * NOT `useOptimistic`: that one reverts when its transition ends, and a
 * `router.refresh()` called after an `await` is not reliably part of that
 * transition, so it can flash the old value before the new render lands.
 *
 * `WalkItem` has a single-row copy of this, written first; it keeps its own
 * because it also carries the row's local drafts.
 */
export function useOptimisticRows<T>(
  saved: T[],
  /** The row's identity. Defaults to its `id`. */
  keyOf: (row: T) => string = (row) => (row as { id: string }).id,
) {
  const [overlay, setOverlay] = useState<Record<string, Partial<T>>>({});
  const [inFlight, setInFlight] = useState(0);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    if (inFlight === 0 && Object.keys(overlay).length > 0) setOverlay({});
  }

  const rows = useMemo(
    () =>
      saved.map((r) => {
        const o = overlay[keyOf(r)];
        return o ? { ...r, ...o } : r;
      }),
    // `keyOf` is a fresh arrow each render at most call sites and always the
    // same function in effect, so it is left out rather than defeating the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, overlay],
  );

  /**
   * Show `patch` on row `id` now — or on several rows, for a batch write — then
   * run the write. `write` resolves true on success and false on failure;
   * anything it throws also counts as a failure.
   */
  async function optimistic(
    id: string | string[],
    patch: Partial<T>,
    write: () => Promise<boolean>,
  ): Promise<boolean> {
    const ids = typeof id === "string" ? [id] : id;
    setOverlay((o) => {
      const next = { ...o };
      for (const k of ids) next[k] = { ...o[k], ...patch };
      return next;
    });
    setInFlight((n) => n + 1);
    let ok = false;
    try {
      ok = await write();
      return ok;
    } finally {
      if (!ok) {
        setOverlay((o) => {
          const next = { ...o };
          for (const k of ids) delete next[k];
          return next;
        });
      }
      setInFlight((n) => n - 1);
    }
  }

  return { rows, optimistic };
}
