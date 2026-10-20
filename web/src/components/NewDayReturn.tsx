"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { findSection, findSub, resolveRoute } from "@/lib/nav";
import {
  DAY_ACTIVITY_KEY,
  isNewDay,
  isReturnablePath,
  NEW_DAY_BACK_KEY,
  readMs,
  serializeBack,
} from "@/lib/newDay";

/**
 * EACH NEW DAY STARTS ON THE START PAGE (Mark, 2026-10-20). Renders nothing.
 * Mounted by the `(app)` layout under both shells.
 *
 * It keeps the device's last touch (`DAY_ACTIVITY_KEY`, every tab) and, at the
 * first touch after three hours idle on a new day (`lib/newDay`), takes this
 * tab to /start — leaving a way back (`NEW_DAY_BACK_KEY`) that Start offers.
 *
 * WHEN IT ASKS. Only when an EXISTING tab comes back: it regains focus or
 * becomes visible, it is reloaded or restored, or the first pointer or key of
 * the day arrives on it — a desk's monitor sleeps without hiding the tab, so
 * the first mouse move is often the only sign. A page opened FRESH is never
 * moved: "a link should go to the link", whether from an email or a bookmark.
 *
 * WHAT IT WILL NOT DO. It never moves a page with a dialog open — something
 * was left half-done. And when the touch that triggers it is a press or a key,
 * that press is swallowed, so the first click of the morning cannot fire a
 * button on yesterday's page.
 */
export function NewDayReturn({ zone }: { zone: string }) {
  const router = useRouter();
  const pathname = usePathname();

  // The way back is offered on the Start page the new day landed on, and only
  // there: going anywhere else spends it.
  useEffect(() => {
    if (pathname === "/start") return;
    try {
      sessionStorage.removeItem(NEW_DAY_BACK_KEY);
    } catch {
      // Blocked storage: nothing was stored either.
    }
  }, [pathname]);

  useEffect(() => {
    let lastSeen = 0;

    const read = () => {
      try {
        return readMs(localStorage.getItem(DAY_ACTIVITY_KEY));
      } catch {
        return null;
      }
    };
    const record = (now: number) => {
      try {
        localStorage.setItem(DAY_ACTIVITY_KEY, String(now));
      } catch {
        // Blocked storage: the rule simply never fires.
      }
    };

    /** True when it moved the tab. */
    const check = (now: number): boolean => {
      const previous = read();
      record(now);
      const here = window.location.pathname;
      if (here === "/start" || !isNewDay(previous, now, zone)) return false;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return false;
      const href = here + window.location.search;
      if (isReturnablePath(href)) {
        try {
          sessionStorage.setItem(NEW_DAY_BACK_KEY, serializeBack({ href, label: pageLabel(here), at: now }));
        } catch {
          // No way back to offer; the move still happens.
        }
      }
      router.push("/start");
      return true;
    };

    // A fresh page load is honoured; a reload or a restore is the tab coming back.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && (nav.type === "reload" || nav.type === "back_forward")) check(Date.now());
    else record(Date.now());
    lastSeen = Date.now();

    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      lastSeen = Date.now();
      check(lastSeen);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onReturn();
    };
    const onActivity = (e: Event) => {
      const now = Date.now();
      // One write a second is plenty for a three-hour rule.
      if (now - lastSeen < 1000) return;
      lastSeen = now;
      if (check(now) && (e.type === "pointerdown" || e.type === "keydown")) {
        e.preventDefault();
        e.stopPropagation();
        // The press would still mint a click on whatever it started on.
        const squelch = (ce: MouseEvent) => {
          ce.preventDefault();
          ce.stopPropagation();
        };
        window.addEventListener("click", squelch, true);
        setTimeout(() => window.removeEventListener("click", squelch, true), 0);
      }
    };

    const activity = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const type of activity) window.addEventListener(type, onActivity, { capture: true, passive: type !== "pointerdown" && type !== "keydown" });
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      for (const type of activity) window.removeEventListener(type, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, zone]);

  return null;
}

/** What to call the page being left: its own heading, else its menu entry. */
function pageLabel(pathname: string): string {
  const heading = document.querySelector("main h1")?.textContent?.trim();
  if (heading) return heading;
  const at = resolveRoute(pathname);
  const section = at && findSection(at.sectionSlug);
  return (section && findSub(section, at.subSlug)?.label) ?? "where you were";
}
