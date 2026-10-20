"use client";

import { useEffect, useState } from "react";

import { snapshotScrollMemory } from "@/lib/scrollMemory";
import { snapshotViewMemory } from "@/lib/viewMemory";
import { lockDevice } from "@/app/deviceActions";
import {
  EXTEND_ACTION_KEY,
  EXTEND_EVENT,
  EXTEND_KEY,
  TOUCH_EVERY_MS,
  RESUME_KEY,
  SIGNED_IN_KEY,
  deviceLastActivity,
  extendedFor,
  idleExpired,
  idleLimitMs,
  idleOnLoad,
  idleWarningSeconds,
  readExtendedUser,
  recordExtendedUser,
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
 * one thing it renders. RED with white ink (Mark, the same day; it shipped
 * yellow) — the app's loud tone, `bg-accent`. The band is its own target on purpose: somebody with
 * dough on their hands can hit it without pressing whatever is underneath.
 * A lock on WAKE gets no warning; the five minutes were up while it slept.
 *
 * FIVE MINUTES, OR TWENTY (Mark, 2026-10-06): the batch log's Stay unlocked
 * switch — see `EXTEND_MS` in `lib/sharedDevice` for the rules. This component
 * reads the limit on every check and is what turns the switch OFF: on any tap
 * or key press, and on the lock itself. A tap is `pointerup`, which a touch
 * scroll never fires (the browser sends `pointercancel`), and which iOS does
 * deliver on plain text where it withholds `click`.
 *
 * A PAGE LOAD IS NOT A TOUCH (2026-10-13). The wake check needs a page that
 * survived the sleep, and Safari often loads a fresh one instead. So the mount
 * reads the device's last touch BEFORE recording its own and locks if that is
 * already past the limit — `idleOnLoad` in `lib/sharedDevice`.
 *
 * AND THE SERVER KEEPS ITS OWN COPY (same day): `beat` below tells it about
 * touches, and `proxy.ts` refuses a request once its copy has run out — see
 * `DEADLINE_COOKIE`. The page's lock still comes first whenever a page is
 * alive; the server's is for when none is.
 */
export function IdleLock({ userId }: { userId: string }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let last = Date.now();
    let locking = false;

    const lock = () => {
      locking = true;
      recordSignedInUser("");
      recordExtendedUser("");
      try {
        const path = window.location.pathname + window.location.search;
        localStorage.setItem(
          RESUME_KEY,
          serializeResume({
            userId,
            path,
            view: snapshotViewMemory(),
            scroll: snapshotScrollMemory(),
            title: document.querySelector("main h1")?.textContent?.trim() || undefined,
          })
        );
      } catch {
        // Private mode or blocked storage: the unlock lands on the home page.
      }
      // A HARD navigation, once the session is gone — see `lockDevice` for
      // why the action does not redirect itself.
      // Either way: if the server has already locked this session, the action
      // is refused, and /lock is still where this page is going.
      const leave = () => window.location.assign("/lock");
      void lockDevice().then(leave, leave);
    };

    // A PAGE LOAD IS NOT A TOUCH (2026-10-13). Before anything is recorded:
    // if the device already had this person signed in and has been idle past
    // the limit, this load is somebody picking the iPad up, so it locks. See
    // `idleOnLoad`.
    if (
      idleOnLoad(
        readSignedInUser(),
        userId,
        readActivity(),
        last,
        idleLimitMs(readExtendedUser(), userId)
      )
    ) {
      lock();
      return;
    }

    recordSignedInUser(userId);
    recordActivity(last);

    // THE SERVER'S COPY OF THE CLOCK (`/device-touch`): told about a touch at
    // most once a minute, and at once when Stay unlocked goes on or off, since
    // that changes how long it should wait. A failed call is retried on the
    // next touch.
    let lastBeat = 0;
    const beat = (force = false) => {
      const now = Date.now();
      if (locking || (!force && now - lastBeat < TOUCH_EVERY_MS)) return;
      lastBeat = now;
      fetch("/device-touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extended: extendedFor(readExtendedUser(), userId) }),
      }).catch(() => {
        lastBeat = 0;
      });
    };
    beat(true);
    const onExtend = () => beat(true);
    window.addEventListener(EXTEND_EVENT, onExtend);

    // The same one-a-second throttle now covers the storage write, too.
    const touch = () => {
      const now = Date.now();
      if (now - last >= 1000) {
        last = now;
        recordActivity(now);
        setSecondsLeft(null);
      }
      beat();
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
      const limit = idleLimitMs(readExtendedUser(), userId);
      // Another tab's touch counts here too, so the band goes when it does.
      setSecondsLeft(idleWarningSeconds(active, Date.now(), limit));
      if (idleExpired(active, Date.now(), limit)) lock();
    };

    /** Stay unlocked ends at the first tap or key — except the switch's own. */
    const endExtension = (e: Event) => {
      if (!extendedFor(readExtendedUser(), userId)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(`[data-bar-action="${EXTEND_ACTION_KEY}"]`)) return;
      recordExtendedUser("");
    };
    window.addEventListener("pointerup", endExtension, { passive: true, capture: true });
    window.addEventListener("keydown", endExtension, { passive: true, capture: true });

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
      // Switched off in another tab with the band up: recount at once.
      if (e.key === EXTEND_KEY) {
        check();
        beat(true);
      }
    };
    window.addEventListener("storage", onStorage);
    // Every second, since the band counts in seconds. It was every thirty.
    const timer = window.setInterval(check, 1000);

    return () => {
      window.removeEventListener("pointerup", endExtension, { capture: true });
      window.removeEventListener("keydown", endExtension, { capture: true });
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EXTEND_EVENT, onExtend);
      window.clearInterval(timer);
    };
  }, [userId]);

  if (secondsLeft === null) return null;
  return (
    // Above everything, CalcPad (80) included: this is about the whole device.
    // `h-16` IS THE TABLET BAR'S HEIGHT (Mark, 2026-10-06) — `BAR_CELL`'s own
    // 64px — so the band covers the bar exactly and nothing under it. A fixed
    // height, not `--rf-header-h`: the runners have no bar and the band should
    // be the same size there.
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[90] flex h-16 flex-col items-center justify-center border-b-2 border-ink bg-accent px-6 text-center text-white"
    >
      <p className="text-[20px] font-bold uppercase leading-tight tracking-[0.08em] tabular-nums">
        Locking in {secondsLeft} {secondsLeft === 1 ? "second" : "seconds"}
      </p>
      <p className="text-[16px] leading-tight">Touch the screen to stay signed in.</p>
    </div>
  );
}
