"use client";

import { useEffect, useState } from "react";

import { snapshotScrollMemory } from "@/lib/scrollMemory";
import { snapshotViewMemory } from "@/lib/viewMemory";
import { lockDevice } from "@/app/deviceActions";
import {
  RESUME_KEY,
  SIGNED_IN_KEY,
  deviceLastActivity,
  idleExpired,
  idleWarningSeconds,
  readActivity,
  readSignedInUser,
  recordActivity,
  recordSignedInUser,
  serializeResume,
  tabIsStale,
} from "@/lib/sharedDevice";

/**
 * Locks a REGISTERED shared iPad after five minutes without a touch. Renders
 * only its warning band (below); mounted by both layouts only when the session says the browser
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
 *
 * Before locking it notes the page in localStorage (`RESUME_KEY`), so the same
 * person unlocking goes back to it rather than to the home page — and, with
 * it, how the page was set up and scrolled (`lib/viewMemory`,
 * `lib/scrollMemory`), which the lock's full page
 * load would otherwise throw away.
 *
 * IT ALSO LOCKS THE OTHER TABS (2026-10-01). Each page records who it was
 * rendered for (`SIGNED_IN_KEY`). A tab still showing one person's page after
 * somebody else has unlocked in another tab, or after the device was locked
 * there, leaves the page with a hard navigation to "/". The server then shows
 * the current person's home, or the lock screen if nobody is signed in. Without
 * this, a shift report left open in a second tab rendered as Karina's view of
 * Abigail's report, which looked empty because Karina cannot read its ratings.
 *
 * AND THE IDLE CLOCK IS THE DEVICE'S, not the tab's (2026-10-01). Every touch is
 * also recorded in localStorage (`ACTIVE_KEY`), and a tab locks only when the
 * later of its own touch and that one is five minutes old. Before this, a tab
 * forgotten in the background could lock the iPad while somebody was working in
 * another tab, and since the lock signs out the shared session, that was
 * everybody's lock.
 *
 * IT SAYS SO FIRST (Mark, 2026-10-06). For the last `IDLE_WARN_MS` a band
 * across the top of the window counts down, and any touch — on the band or
 * anywhere else — is activity like any other and takes it away. This is the
 * one thing it renders. The band is its own target on purpose: somebody with
 * dough on their hands can hit it without pressing whatever is underneath.
 * A lock on WAKE gets no warning; the five minutes were up while it slept.
 */
export function IdleLock({ userId }: { userId: string }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let last = Date.now();
    let locking = false;
    recordSignedInUser(userId);
    recordActivity(last);

    // The same one-a-second throttle now covers the storage write, too.
    const touch = () => {
      const now = Date.now();
      if (now - last >= 1000) {
        last = now;
        recordActivity(now);
        setSecondsLeft(null);
      }
    };

    /** Another tab changed who is signed in — this page is not theirs. */
    const leaveIfStale = () => {
      if (locking || !tabIsStale(userId, readSignedInUser())) return false;
      locking = true;
      window.location.assign("/");
      return true;
    };

    const check = () => {
      if (locking) return;
      if (leaveIfStale()) return;
      const active = deviceLastActivity(last, readActivity());
      // Another tab's touch counts here too, so the band goes when it does.
      setSecondsLeft(idleWarningSeconds(active, Date.now()));
      if (idleExpired(active, Date.now())) {
        locking = true;
        recordSignedInUser("");
        try {
          const path = window.location.pathname + window.location.search;
          localStorage.setItem(
            RESUME_KEY,
            serializeResume({
              userId,
              path,
              view: snapshotViewMemory(),
              scroll: snapshotScrollMemory(),
            })
          );
        } catch {
          // Private mode or blocked storage: the unlock lands on the home page.
        }
        // A HARD navigation, once the session is gone — see `lockDevice` for
        // why the action does not redirect itself.
        void lockDevice().then(() => window.location.assign("/lock"));
      }
    };

    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "scroll"];
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    // Fires in every OTHER tab the moment one writes the key, so a tab that
    // is on screen beside the change leaves at once. A tab in the background
    // may be suspended and miss it; the visibility check above covers that.
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNED_IN_KEY || e.key === null) leaveIfStale();
    };
    window.addEventListener("storage", onStorage);
    // Every second, since the band counts in seconds. It was every thirty.
    const timer = window.setInterval(check, 1000);

    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [userId]);

  if (secondsLeft === null) return null;
  return (
    // Above everything, CalcPad (80) included: this is about the whole device.
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[90] border-b-2 border-ink bg-mark-fill px-6 py-5 text-center text-ink"
    >
      <p className="text-[20px] font-bold uppercase tracking-[0.08em] tabular-nums">
        Locking in {secondsLeft} {secondsLeft === 1 ? "second" : "seconds"}
      </p>
      <p className="mt-1 text-[16px]">Touch the screen to stay signed in.</p>
    </div>
  );
}
