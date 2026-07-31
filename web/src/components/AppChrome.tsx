"use client";

import type { ChromeMode } from "@/lib/chromeMode";
import { useChromeMode } from "@/lib/chromeModeStore";

/**
 * Picks which navigation chrome is on screen, and publishes the choice to CSS.
 *
 * Both chromes arrive already COMPOSED, as props, from the (app) layout — which
 * is a server component, so it can build the LocationSwitcher and the signOut
 * form action that neither client chrome could build for itself. The cost is
 * rendering the unused one; the benefit is that flipping between them is a
 * single client re-render with no server round trip and no loading.tsx flash,
 * which is the whole point when the exercise is an A/B.
 *
 * `display: contents` so this wrapper adds no box: the body's column flex still
 * sees the header and <main> as its own children, and `flex-1` on <main> still
 * means "grow vertically" rather than quietly changing meaning inside a new row.
 * That is also why the sidebar is FIXED and paid for with padding rather than
 * being a flex column beside the content — see globals.css.
 *
 * The data attribute is what globals.css keys --rf-nav-w off. It inherits down
 * the DOM to the fixed ActionBar and BackToTop inside <main>, because custom
 * properties follow the document tree and `position: fixed` doesn't change that
 * — the same fact that bites overlays inheriting text-white from the ActionBar.
 */
export function AppChrome({
  initialMode,
  top,
  side,
  children,
}: {
  initialMode: ChromeMode;
  top: React.ReactNode;
  side: React.ReactNode;
  children: React.ReactNode;
}) {
  const mode = useChromeMode(initialMode);

  return (
    <div data-chrome={mode} className="contents">
      {mode === "top" ? top : side}
      {children}
    </div>
  );
}
