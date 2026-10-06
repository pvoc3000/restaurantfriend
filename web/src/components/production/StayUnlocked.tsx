"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { ICON_LOCK_OPEN } from "@/components/tablet/BarLabel";
import {
  EXTEND_ACTION_KEY,
  EXTEND_EVENT,
  EXTEND_MS,
  extendedFor,
  readActivity,
  readExtendedUser,
  recordExtendedUser,
} from "@/lib/sharedDevice";
import { publishBarActions } from "@/lib/tabletBarActions";

function subscribe(onChange: () => void) {
  window.addEventListener(EXTEND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EXTEND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** "10:42" — the iPad's own clock, since that is the one on the wall of it. */
function clock(ms: number): string {
  const at = new Date(ms);
  const hour = at.getHours() % 12 || 12;
  return `${hour}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * STAY UNLOCKED — the batch log's switch in the tablet bar (Mark, 2026-10-06).
 * Twenty minutes of idle time instead of five, for one stretch at the bench;
 * the rules, and why each, are at `EXTEND_MS` in `lib/sharedDevice`. Renders
 * nothing: it seats one command in the bar (`lib/tabletBarActions`).
 *
 * Mounted by the batch log record only, and only on a registered shared iPad —
 * nowhere else has an idle lock to extend. Unmounting turns it off, which is
 * what "leaving the batch log" means; `pagehide` covers a hard navigation,
 * where no unmount runs.
 *
 * ON, the cell inverts and reads "Until 10:42": when it will lock if nobody
 * touches it, so the baker can see it took and a passer-by can see why the iPad
 * is open. `IdleLock` does the turning off; this only reflects it.
 *
 * IT ALSO ASKS THE SCREEN TO STAY AWAKE (`navigator.wakeLock`, Safari 16.4+).
 * Without that the iPad's own Auto-Lock darkens it in a few minutes and the
 * baker has to touch it to read, which is the thing this exists to spare them.
 * A refusal is silent: the extension still holds, the screen just sleeps.
 */
export function StayUnlocked({ userId }: { userId: string }) {
  const on = useSyncExternalStore(
    subscribe,
    () => extendedFor(readExtendedUser(), userId),
    () => false
  );
  // When it locks if nothing is touched. State, not arithmetic in render: a
  // scroll moves it, and the clock is not something a render may read.
  const [until, setUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!on) return;
    const read = () => {
      const last = Number(readActivity());
      setUntil((Number.isFinite(last) && last > 0 ? last : Date.now()) + EXTEND_MS);
    };
    const timer = window.setInterval(read, 5000);
    return () => window.clearInterval(timer);
  }, [on]);

  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let over = false;
    const hold = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          if (over) void s.release();
          else sentinel = s;
        })
        .catch(() => {
          // Low power mode, or refused: the screen sleeps as it always did.
        });
    };
    hold();
    // The system drops the hold whenever the page is hidden.
    document.addEventListener("visibilitychange", hold);
    return () => {
      over = true;
      document.removeEventListener("visibilitychange", hold);
      void sentinel?.release();
    };
  }, [on]);

  useEffect(() => {
    publishBarActions([
      {
        key: EXTEND_ACTION_KEY,
        word: on ? `Until ${clock(until ?? Date.now() + EXTEND_MS)}` : "Stay 20 min",
        icon: ICON_LOCK_OPEN,
        pressed: on,
        title: on
          ? "This iPad stays unlocked until then. Any tap turns this off."
          : "Keep this iPad unlocked for 20 minutes without a touch",
        onClick: () => {
          if (on) {
            recordExtendedUser("");
            return;
          }
          setUntil(Date.now() + EXTEND_MS);
          recordExtendedUser(userId);
        },
      },
    ]);
  }, [on, until, userId]);

  // Leaving the batch log gives the seat back and turns the switch off.
  useEffect(() => {
    const off = () => {
      if (extendedFor(readExtendedUser(), userId)) recordExtendedUser("");
    };
    window.addEventListener("pagehide", off);
    return () => {
      window.removeEventListener("pagehide", off);
      off();
      publishBarActions(null);
    };
  }, [userId]);

  return null;
}
