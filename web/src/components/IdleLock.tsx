"use client";

import { useEffect } from "react";

import { lockDevice } from "@/app/deviceActions";
import { IDLE_MS, idleExpired } from "@/lib/sharedDevice";

/**
 * Locks a REGISTERED shared iPad after five minutes without a touch. Renders
 * nothing; mounted by both layouts only when the session says the browser
 * holds the device cookie, so a desk browser never carries a timer.
 *
 * Two clocks, deliberately. A `setInterval` alone under-fires on an iPad:
 * Safari suspends JavaScript when the screen sleeps, so a report left open
 * at 9pm and picked up at 6am would still be that person's for a beat after
 * the wake. So the last activity is a TIMESTAMP, and `visibilitychange` /
 * `focus` compare against it the moment the page comes back — the wake is
 * what locks, not the timer.
 *
 * Activity is anything a hand does — pointer, key, touch, scroll — throttled
 * to one write a second. Nothing is lost by locking: every runner and the
 * guide persist as you go, which is the property that makes five minutes
 * affordable.
 */
export function IdleLock() {
  useEffect(() => {
    let last = Date.now();
    let locking = false;

    const touch = () => {
      const now = Date.now();
      if (now - last >= 1000) last = now;
    };

    const check = () => {
      if (locking) return;
      if (idleExpired(last, Date.now())) {
        locking = true;
        void lockDevice();
      }
    };

    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "scroll"];
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, Math.min(IDLE_MS, 30_000));

    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
