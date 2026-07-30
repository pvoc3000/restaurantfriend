"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SECTIONS,
  findSection,
  resolveRoute,
  sectionHref,
  sectionLabel,
} from "@/lib/nav";
import type { NavMemory } from "@/lib/navMemory";
import { remember, useNavMemory } from "@/lib/navMemoryStore";

// Both tiers are the same height and every tab fills it, so the two bands read
// as one black block with the tabs set into it.
//
// 28px, down from 44 in two steps (Mark, 2026-07-29, twice — the rows still sat
// too far apart). The gap between the two lines of TYPE is what you actually
// see, and it's half the band's leading twice over: 32px at h-11, 24 at h-9,
// now 16.
//
// 36px was the floor while the utilities cluster was h-7, because a control
// needs air above it or it looks pinned to the top of the screen. Going below it
// meant moving that air OUT of the band: the cluster is h-6 now and the whole
// masthead carries py-1, so the top control still clears the viewport edge by
// 6px while the bands themselves are tight. Masthead: 88px → 72 → 64.
const TIER_H = "h-7";
const TAB = `${TIER_H} flex items-center whitespace-nowrap px-4 no-underline`;

// A BAND is min-height, not height. Both bands are flex-wrap, and a fixed
// height on a wrapping row doesn't grow — it overflows, silently, onto whatever
// is beneath it. At 768 the utilities cluster wraps to a second line and landed
// on top of the sub-section tabs (measured 2026-07-29: a 36px row holding 68px
// of content). Letting the band grow is what the two-tier design always
// assumed; HeaderShell measures the result and republishes --rf-header-h, so
// everything sized against the masthead follows it down.
const TIER_MIN = "min-h-7";

/**
 * The two-tier menu, inherited from DF Operations: sections on top, that
 * section's sub-sections beneath. See lib/nav.ts for the menu itself and
 * lib/navMemoryStore.ts for the "last sub-section per section" memory.
 *
 * The two bands are one black block — no rule between them (Mark, 2026-07-25).
 * Active is yellow type on tier 1 and white type on tier 2, neither underlined:
 * the yellow says which module you're in, and within it the white sub-tab is
 * simply the brightest thing in the band.
 */
export function AppNav({
  initialMemory,
  locationCode,
  controls,
  identity,
}: {
  initialMemory: NavMemory;
  locationCode: string | null;
  /** Row 1 of the right-hand column: things that change what you're looking at
   *  — home, settings, which location, and the chrome collapse. Composed on the
   *  server so LocationSwitcher and the signOut form action don't have to cross
   *  into this client component. */
  controls: React.ReactNode;
  /** Row 2: who you're signed in as, and leaving. */
  identity: React.ReactNode;
}) {
  const pathname = usePathname();
  const here = resolveRoute(pathname);
  const memory = useNavMemory(initialMemory);

  // Remember where we are so this section's tab comes back here later. An
  // external-store write, not a setState — see lib/navMemoryStore.ts.
  const sectionSlug = here?.sectionSlug;
  const subSlug = here?.subSlug;
  useEffect(() => {
    if (sectionSlug && subSlug) remember(sectionSlug, subSlug);
  }, [sectionSlug, subSlug]);

  const currentSection = sectionSlug ? findSection(sectionSlug) : undefined;

  return (
    // The wordmark used to be a first column here, with both tiers in a second
    // one. It's gone (Mark, 2026-07-29) and the tabs start at the page gutter
    // instead — you know which app you're in, and the row is the six sections
    // plus a utilities cluster that has to fit beside them at 1280.
    //
    // py-1 is the bands' breathing room, moved OUT of the bands so they can be
    // 28px: it keeps the utilities off the top edge of the screen without
    // adding leading between the two rows of type.
    <div className="px-4 py-1 xl:px-12">
      {/* TWO COLUMNS, each two rows deep (Mark, 2026-07-29). The menu's tiers
          on the left, the utilities on the right — split so the right-hand
          column is two rows as well, controls over identity. Putting the
          utilities in a column of their own rather than inside tier 1 is what
          keeps the masthead at 64px: two 28px rows beside two 28px rows, not
          stacked inside one of them. */}
      <div className="flex items-start gap-x-4">
        {/* -ml-4 cancels the first tab's own px-4 so its TEXT lands on the
            gutter, flush with the page content below it, while the tab keeps
            its full hit area. */}
        <div className="-ml-4 min-w-0 flex-1">
          <nav
            aria-label="Sections"
            className={`flex flex-wrap items-center gap-y-1 text-[12px] font-semibold uppercase tracking-[0.06em] ${TIER_MIN}`}
          >
            {SECTIONS.map((section) => {
              const active = section.slug === sectionSlug;
              return (
                <Link
                  key={section.slug}
                  href={sectionHref(section, memory)}
                  aria-current={active ? "page" : undefined}
                  className={`${TAB} ${
                    active ? "text-mark" : "text-white/60 hover:text-white"
                  }`}
                >
                  {sectionLabel(section, locationCode)}
                </Link>
              );
            })}
          </nav>

          {/* Second tier. Home and Settings belong to no section, so it
              vanishes there rather than sitting empty — HeaderShell measures
              the header, so the height change is absorbed. */}
          {currentSection && (
            <nav
              aria-label={`${sectionLabel(currentSection, locationCode)} sub-sections`}
              className={`flex flex-wrap items-center gap-y-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${TIER_MIN}`}
            >
              {currentSection.subs.map((sub) => {
                const active = sub.slug === subSlug;
                return (
                  <Link
                    key={sub.slug}
                    href={sub.href}
                    aria-current={active ? "page" : undefined}
                    className={`${TAB} ${
                      active ? "text-white" : "text-white/50 hover:text-white"
                    }`}
                  >
                    {sub.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* The right-hand column. shrink-0 so it never compresses its own
            controls — the section tabs wrap first, which is the cheaper loss.
            Each row is a band of the same height as a menu tier, so the two
            columns line up. */}
        <div className="flex shrink-0 flex-col items-end">
          <div
            className={`flex flex-wrap items-center justify-end gap-x-4 gap-y-1 ${TIER_MIN}`}
          >
            {controls}
          </div>
          <div
            className={`flex flex-wrap items-center justify-end gap-x-4 gap-y-1 ${TIER_MIN}`}
          >
            {identity}
          </div>
        </div>
      </div>
    </div>
  );
}
