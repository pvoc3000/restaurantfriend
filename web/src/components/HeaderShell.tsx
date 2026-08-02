"use client";

import { useEffect, useRef } from "react";

/**
 * The masthead's shell: sticky, and the publisher of its own height.
 *
 * It used to COLLAPSE to a strip, driven by a ▲ in the utilities cluster — two
 * black bands plus the utilities row cost ~88px, which Mark wanted back on the
 * order guide (2026-07-27). Removed 2026-08-02 ("I don't think it's necessary
 * any longer"), and the whole mechanism went with the button rather than just
 * the button: the same flag hid the guide's shelf, so leaving the state behind
 * with nothing to toggle it would have stranded anyone who had collapsed it.
 * Gone with it: `lib/chromeStore`, the collapsed strip that restated where you
 * were, and the guide's `-mt-8` compensation.
 *
 * What REMAINS load-bearing is the measured height. `--rf-header-h` is what
 * every sticky table head offsets against (lib/tableHead) and what the order
 * guide's scroll pane subtracts, so it stays measured rather than becoming a
 * constant — the masthead still wraps to two or three rows at iPad widths, and
 * any constant is wrong at some width.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

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
  }, []);

  return (
    // Sticky, and z-50 so it stays above anything a page floats over itself
    // (the cleanup drawer) — the nav has to stay reachable. Anchored panels sit
    // above it at z-70 and dialogs at z-60; see lib/anchoredPanel.
    <header ref={ref} className="sticky top-0 z-50 bg-ink text-white">
      {children}
    </header>
  );
}
