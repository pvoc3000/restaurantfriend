"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";

import { ChromeToggle } from "@/components/ChromeToggle";
import type { ChromeMode } from "@/lib/chromeMode";
import { setChromeCollapsed, useChromeCollapsed } from "@/lib/chromeStore";
import { usePublishHeaderHeight } from "@/lib/headerHeight";
import { findSection, findSub, resolveRoute, sectionLabel } from "@/lib/nav";

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
 * to find it. It also keeps the header sticky.
 *
 * The flag reaches past this component: it collapses the page's whole chrome,
 * so the order guide's shelf — title, day picker, vendor totals, filters —
 * goes with the menu (Mark, 2026-07-29). One button, one thing to learn, and
 * what's left on screen is the list and its column labels.
 *
 * Collapsed state is remembered per user (lib/chromeStore), so you set it once
 * and walk. The strip says where you ARE — "DF01: Purchasing / Order Guide"
 * (Mark, 2026-07-29) — rather than the app's own name, which you already know.
 * It's the two tiers of the menu restated in one line, so collapsing costs you
 * the ability to navigate but not the knowledge of where you stand.
 */
export function HeaderShell({
  locationCode,
  chromeMode,
  children,
}: {
  locationCode: string | null;
  /** Only so the strip can carry the chrome toggle — see below. */
  chromeMode: ChromeMode;
  children: React.ReactNode;
}) {
  const collapsed = useChromeCollapsed();
  const ref = useRef<HTMLElement>(null);

  // Where you are, for the collapsed strip. The same resolution the menu uses,
  // so the strip and the tabs can never disagree about which page is current.
  const pathname = usePathname();
  const here = resolveRoute(pathname);
  const section = here ? findSection(here.sectionSlug) : undefined;
  const sub = section && here ? findSub(section, here.subSlug) : undefined;
  const sectionName = section ? sectionLabel(section, locationCode) : null;
  // The location section is LABELLED with the code (lib/nav sectionLabel), so
  // naming it here would read "DF01: DF01 / Tasks". Say the code once.
  const showSection = sectionName !== null && sectionName !== locationCode;
  // Home and Settings belong to no section — there's nothing to trail, and the
  // code alone is still worth saying.
  const hasTrail = showSection || sub !== undefined;

  // Publish the header's real height so screens that size themselves against
  // the viewport get the space back when it collapses. Shared with the sidebar
  // chrome's top bar, which has to publish the same variable — see
  // lib/headerHeight for why it's measured rather than assumed.
  usePublishHeaderHeight(ref);

  return (
    // Sticky, and z-50 so it stays above anything a page floats over itself
    // (dialogs, the cleanup drawer) — the nav has to stay reachable.
    <header ref={ref} className="sticky top-0 z-50 bg-ink text-white">
      {collapsed ? (
        <div className="flex h-8 items-center gap-4 px-4 text-[11px] uppercase tracking-[0.12em] xl:px-12">
          {/* One colour throughout (Mark, 2026-07-29). The strip is a single
              statement of where you are, so greying parts of it made it read as
              several things of differing importance. Weight still separates the
              location code from its trail; colour no longer does. */}
          <span className="flex min-w-0 items-baseline gap-1.5 text-white">
            {locationCode && (
              <span className="font-bold tracking-[0.06em]">
                {locationCode}
                {hasTrail ? ":" : ""}
              </span>
            )}
            {showSection && <span>{sectionName}</span>}
            {showSection && sub && <span>/</span>}
            {sub && <span className="truncate">{sub.label}</span>}
            {!locationCode && !hasTrail && (
              <span className="font-bold tracking-[0.06em]">Restaurant Friend</span>
            )}
          </span>
          {/* The SAME control that collapsed it, in the same place, still
              looking like itself (Mark, 2026-07-29) — a toggle you can see is
              a toggle, rather than a caret that becomes a word.
              The chrome toggle rides along because collapsing replaces the
              utilities cluster WHOLESALE: without a copy here, someone who
              walks with the masthead collapsed has no way to reach the sidebar
              at all. Temporary, like the toggle itself. */}
          <span className="ml-auto flex items-center gap-4">
            <ChromeToggle initialMode={chromeMode} />
            <MenuCollapseButton />
          </span>
        </div>
      ) : (
        children
      )}
    </header>
  );
}

/**
 * The collapse toggle. ONE button in both states, rendered twice — with the
 * utilities when the masthead is open, in the strip when it isn't — so the
 * control never changes shape under you (Mark, 2026-07-29). It used to turn
 * into a text button reading "Menu ▾" while collapsed, which read as a
 * different object rather than as the same switch flipped.
 *
 * The caret is the state, and it's the app's own disclosure convention (Mark,
 * 2026-07-29): ▼ while the masthead is open, ▶ while it's shut — exactly what
 * the order guide's per-item triangle does. Rotated rather than swapped for a
 * different glyph: it's the same mark, and the quarter turn is what says the
 * toggle moved.
 */
export function MenuCollapseButton() {
  const collapsed = useChromeCollapsed();
  const label = collapsed
    ? "Show the menu and this screen's controls"
    : "Hide the menu and this screen's controls — a strip stays behind to bring them back";

  return (
    <button
      type="button"
      onClick={() => setChromeCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      // tracking-normal on purpose: the strip sets tracking-[0.12em] on its
      // whole row, and without this the caret inherits it and the same button
      // renders 2px wider there than it does in the utilities.
      className="flex h-6 items-center border border-white/40 bg-transparent px-3 text-[12px] font-semibold leading-none tracking-normal text-white hover:bg-white hover:text-ink"
    >
      {/* ▼ is the resting glyph, so open needs no rotation. Collapsed turns it
          a quarter turn ANTI-clockwise (south → east) to point right; +90 would
          send it west. */}
      <span
        aria-hidden
        className={`inline-block transition-transform ${collapsed ? "-rotate-90" : ""}`}
      >
        ▼
      </span>
    </button>
  );
}
