"use client";

import { useRef } from "react";

import { usePublishHeaderHeight } from "@/lib/headerHeight";

/**
 * The sidebar chrome's slim top strip — the bill.com shape, where the rail runs
 * the full height and the bar starts to the right of it.
 *
 * It carries exactly what the masthead's utilities cluster carries, and it has
 * to exist rather than folding into the rail:
 *
 *  · The location <select> needs ~64px and does not fit a 56px rail. Burying it
 *    in the expanded panel would take the location code off the screen in the
 *    resting state, and knowing WHICH SHOP you're ordering for is the one thing
 *    the collapsed masthead was built to keep.
 *  · signOut is a server action and LocationSwitcher's props are composed on the
 *    server, so neither can be built inside a client component. Same slot trick
 *    as AppHeader/AppNav: they arrive as `controls` and `identity`.
 *  · MenuCollapseButton has to survive into this chrome. The order guide reads
 *    useChromeCollapsed() to hide its shelf, and that's how the guide is walked
 *    — losing the button would strand the flag with no way to set it.
 *
 * It also publishes --rf-header-h, which the guide's sticky column labels hang
 * from. See lib/headerHeight.
 */
export function SideTopBar({
  controls,
  identity,
  onOpenMenu,
}: {
  controls: React.ReactNode;
  identity: React.ReactNode;
  /** Below xl there is no rail, so this is the only way to the menu. */
  onOpenMenu: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  usePublishHeaderHeight(ref);

  return (
    // Sticky and z-50, matching HeaderShell — the nav has to stay reachable
    // above anything a page floats over itself. The rail is z-50 too and comes
    // later in the DOM, so it paints over this bar's left end, which is what
    // makes the black corner read as one continuous column.
    //
    // The gutter variables rather than a literal pair: --rf-content-pl already
    // includes the rail's width, so the bar's contents start exactly where the
    // page content below them does.
    // BLACK, like the masthead it stands in for — the RAIL is the white element
    // in this chrome (Mark, 2026-07-31, second pass). The first attempt had it
    // the other way round, which put white on the two bars and left the rail
    // carrying all the weight; this way the chrome that frames the page reads
    // as chrome and the menu itself sits back.
    <header
      ref={ref}
      className="sticky top-0 z-50 bg-ink text-white pl-[var(--rf-content-pl)] pr-[var(--rf-content-pr)]"
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 py-1">
        {/* Below xl the rail isn't rendered — the order guide's row bottoms out
            at 710px and an iPad portrait window has 736 to give it, so there is
            no rail width that fits. A word, not a glyph, per the design system. */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Show the menu"
          className="flex h-6 items-center border border-white/40 px-3 text-[12px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-white hover:bg-white hover:text-ink xl:hidden"
        >
          Menu
        </button>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {controls}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {identity}
        </div>
      </div>
    </header>
  );
}
