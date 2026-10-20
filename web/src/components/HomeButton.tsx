"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { startAttention } from "@/app/startActions";
import { HomeIcon, IconButton } from "@/components/ui/IconButton";

/** Asked at most this often while the page is in use… */
const EVERY_MS = 5 * 60 * 1000;
/** …and again on coming back to the tab, or moving between screens, once
 *  this much has passed — so acting on something soon shows in the count. */
const STALE_MS = 60 * 1000;

/**
 * THE MASTHEAD'S HOME BUTTON, WITH A COUNT (Mark, 2026-10-20: "we should
 * figure out how to get people to the start page more often"). The badge is
 * how many things on YOUR start page need somebody — the yellow numbers on
 * your own widgets, at your working shop (`startAttention`). Nothing at zero.
 *
 * Asked from the browser AFTER the page has painted, never on the way to it:
 * the count runs the same queries the widgets do, and no screen should wait on
 * the masthead. The layout outlives soft navigation, so this asks once per
 * load, then every five minutes, and on coming back if the count is a minute
 * old.
 */
export function HomeButton() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const askedAt = useRef(0);

  useEffect(() => {
    let alive = true;
    const ask = () => {
      askedAt.current = Date.now();
      startAttention().then(
        (n) => alive && setCount(n),
        () => {
          // A failed count is no badge, not an error in the masthead.
        },
      );
    };
    const maybe = () => {
      if (document.visibilityState === "visible" && Date.now() - askedAt.current > STALE_MS) ask();
    };
    if (Date.now() - askedAt.current > STALE_MS) ask();
    const timer = window.setInterval(maybe, EVERY_MS);
    document.addEventListener("visibilitychange", maybe);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", maybe);
    };
    // Re-run on a move between screens: it asks only if the count is stale.
  }, [pathname]);

  const shown = count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  return (
    <span className="relative inline-grid">
      <IconButton href="/start" label={shown ? `Home — ${count} need attention` : "Home"}>
        <HomeIcon />
      </IconButton>
      {shown && (
        // The mark FILL under ink — yellow is a fill, never an ink — and square
        // like everything else in the masthead.
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 -top-1.5 min-w-4 bg-mark-fill px-[3px] text-center text-[10px] font-bold leading-[14px] text-ink tabular-nums"
        >
          {shown}
        </span>
      )}
    </span>
  );
}
