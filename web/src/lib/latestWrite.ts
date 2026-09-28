"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Save the LATEST value, one write at a time, without ever making the control
 * wait (Mark, 2026-09-28, after the order guide's steppers).
 *
 * For a control that shows its new value on the tap and writes it behind: an
 * Active box, a weekday picker, a recipe row's switch. They used to disable
 * themselves inside a transition that ran the write AND `router.refresh()`,
 * and a refresh re-renders the whole route, so a second tap within a second or
 * two was swallowed.
 *
 * Calls made while a save is running are not sent one by one, since two
 * updates in flight can land in either order and leave the database holding
 * the one you tapped away from. Only the newest waits, and it goes when the
 * running save lands. `settled` runs once the queue is empty, or on the first
 * failure (which drops anything queued behind it), with that failure's message
 * or null. The caller refreshes there, and puts its value back on a failure.
 */
export function useLatestWrite<T>(
  save: (value: T) => PromiseLike<string | null>,
  settled: (error: string | null) => void
): (value: T) => void {
  const saveRef = useRef(save);
  const settledRef = useRef(settled);
  useEffect(() => {
    saveRef.current = save;
    settledRef.current = settled;
  });
  // Wrapped so a queued `null` or `false` can be told from "nothing queued".
  const wanted = useRef<{ value: T } | null>(null);
  const running = useRef(false);

  return useCallback((value: T) => {
    wanted.current = { value };
    if (running.current) return;
    running.current = true;
    void (async () => {
      let error: string | null = null;
      while (wanted.current && !error) {
        const { value: sending } = wanted.current;
        wanted.current = null;
        error = await saveRef.current(sending);
      }
      wanted.current = null;
      running.current = false;
      settledRef.current(error);
    })();
  }, []);
}
