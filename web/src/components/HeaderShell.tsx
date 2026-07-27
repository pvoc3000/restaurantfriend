"use client";

import { useEffect, useRef } from "react";

import { setMenuCollapsed, useMenuCollapsed } from "@/lib/chromeStore";

/**
 * The masthead's shell: sticky, and collapsible to a strip.
 *
 * Two black bands plus the utilities row cost ~88px at the top of every screen
 * — fine on a desk, too much on the order guide, which is the one screen you
 * read standing up and scroll for a hundred items (Mark, 2026-07-27: "they take
 * up too much space and should probably scroll away… we would need a shortcut
 * to bring it back"). Collapsing rather than scrolling away is what that
 * shortcut wants to be: the strip is ALWAYS there, so the menu comes back with
 * one tap wherever you are in the list, instead of having to scroll to the top
 * to find it. It also keeps the header sticky, which is load-bearing — the
 * detail slide-over is fixed and starts below the header, so a header that
 * scrolled off would leave a dead strip across the top of the panel.
 *
 * Collapsed state is remembered per user (lib/chromeStore), so you set it once
 * and walk. The strip keeps the two things you'd otherwise lose: which app this
 * is, and WHICH LOCATION you're ordering for.
 */
export function HeaderShell({
  locationCode,
  children,
}: {
  locationCode: string | null;
  children: React.ReactNode;
}) {
  const collapsed = useMenuCollapsed();
  const ref = useRef<HTMLElement>(null);

  // Publish the header's real height so screens that size themselves against
  // the viewport get the space back when it collapses. MEASURED, not assumed:
  // the masthead wraps to two or three rows at iPad widths, so any constant is
  // wrong at some width. (DetailPanel measures it separately for its own top
  // offset — same reason.)
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
    // Sticky and above the detail panel (z-50 vs the panel's z-40): the panel
    // is a slide-over, not a modal, so the nav has to stay reachable — a
    // full-viewport backdrop over the header made every nav link unclickable.
    <header ref={ref} className="sticky top-0 z-50 bg-ink text-white">
      {collapsed ? (
        <div className="flex h-8 items-center gap-4 px-12 text-[11px] uppercase tracking-[0.12em]">
          <span className="font-bold tracking-[0.06em]">Restaurant Friend</span>
          {locationCode && <span className="text-white/55">{locationCode}</span>}
          <button
            type="button"
            onClick={() => setMenuCollapsed(false)}
            title="Show the menu"
            className="ml-auto inline-flex items-center gap-2 font-semibold text-white/70 hover:text-white"
          >
            Menu ▾
          </button>
        </div>
      ) : (
        children
      )}
    </header>
  );
}

/**
 * The other half of the toggle, sitting with the masthead's utilities. A caret
 * rather than a word: it's the inverse of the strip's "Menu ▾", and the
 * utilities row is already the tightest thing on the bar (six section tabs plus
 * this cluster is exactly what fits at 1280).
 */
export function MenuCollapseButton() {
  return (
    <button
      type="button"
      onClick={() => setMenuCollapsed(true)}
      aria-label="Hide the menu"
      title="Hide the menu — a strip stays behind to bring it back"
      className="h-7 border border-white/40 bg-transparent px-3 text-[12px] font-semibold leading-none text-white hover:bg-white hover:text-ink"
    >
      ▲
    </button>
  );
}
