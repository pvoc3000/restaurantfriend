"use client";

import type { ChromeMode } from "@/lib/chromeMode";
import { setChromeMode, useChromeMode } from "@/lib/chromeModeStore";

/**
 * Switches between the two navigation chromes while Mark decides which he
 * prefers (2026-07-31). TEMPORARY — when the answer is in, this component and
 * the losing chrome go together; see components/SideChrome for the recipe.
 *
 * A WORD, not a glyph: the design system has no icon for this and says to use a
 * word when it doesn't. It names the DESTINATION rather than the current state,
 * the way every ActionBarButton reads — a button that says what pressing it
 * does. Styled as the twin of MenuCollapseButton, which it sits beside, because
 * they are the same species of control.
 *
 * It renders in THREE places and the third is the one that's easy to forget:
 * the masthead's utilities, the sidebar's top bar, and HeaderShell's COLLAPSED
 * STRIP — which replaces the utilities wholesale, so without a copy there a
 * collapsed top-menu user has no way back to the sidebar.
 */
export function ChromeToggle({ initialMode }: { initialMode: ChromeMode }) {
  const mode = useChromeMode(initialMode);
  const toTop = mode !== "top";

  const label = toTop
    ? "Switch to the menu across the top"
    : "Switch to the menu down the left";

  return (
    <button
      type="button"
      onClick={() => setChromeMode(toTop ? "top" : "side")}
      aria-label={label}
      title={label}
      // tracking-normal for the same reason MenuCollapseButton sets it: the
      // collapsed strip puts tracking-[0.12em] on its whole row, and without
      // this the button renders wider there than in the utilities.
      className="flex h-6 items-center border border-white/40 bg-transparent px-3 text-[12px] font-semibold leading-none tracking-normal whitespace-nowrap text-white hover:bg-white hover:text-ink"
    >
      {toTop ? "Top menu" : "Sidebar"}
    </button>
  );
}
