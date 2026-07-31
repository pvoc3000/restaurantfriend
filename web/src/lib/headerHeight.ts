"use client";

// Publishes the header's real height as --rf-header-h.
//
// Extracted from HeaderShell when the sidebar chrome arrived (2026-07-31), so
// the two chromes can't drift: the order guide's column labels stick to
// `top-[var(--rf-header-h)]`, and a chrome that forgot to publish would leave
// them floating 64px low over the list — on the heaviest screen in the app.
// Exactly one chrome is mounted at a time (components/AppChrome picks), so
// exactly one publisher runs and there is no race.
//
// MEASURED, not assumed: the masthead wraps to two or three rows at iPad
// widths, collapses to a 32px strip, and the sidebar's top bar is a different
// height again — so any constant is wrong at some width in some chrome. The
// value in globals.css is only a seed for the first paint.

import { useEffect, type RefObject } from "react";

export function usePublishHeaderHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const publish = () =>
      document.documentElement.style.setProperty(
        "--rf-header-h",
        `${Math.round(el.getBoundingClientRect().height)}px`
      );

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
