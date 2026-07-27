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
const TIER_H = "h-11";
const TAB = `${TIER_H} flex items-center whitespace-nowrap px-4 no-underline`;

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
  utilities,
}: {
  initialMemory: NavMemory;
  locationCode: string | null;
  /** Composed on the server so LocationSwitcher and the signOut form action
   *  don't have to cross into this client component. */
  utilities: React.ReactNode;
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
    // Two COLUMNS, not two stacked rows: the wordmark is its own column and
    // both tiers live in the second one, so tier 2 begins exactly where tier 1's
    // first tab does. A grid would align them too, but this keeps each tier its
    // own flex-wrap row — the masthead still has to wrap at iPad widths.
    <div className="flex items-start gap-x-4 px-12">
      <span
        className={`${TIER_H} flex items-center whitespace-nowrap text-[13px] font-bold uppercase tracking-[0.06em]`}
      >
        Restaurant Friend
      </span>

      <div className="min-w-0 flex-1">
        <div className={`flex flex-wrap items-center gap-y-1 ${TIER_H}`}>
          <nav
            aria-label="Sections"
            className="flex flex-wrap items-center gap-y-1 text-[12px] font-semibold uppercase tracking-[0.06em]"
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

          {/* Tight gaps on purpose: six section tabs plus this cluster is what
              fits on one row at 1280, and a wrap here pushes the whole masthead
              to three bands. */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 pl-4">
            {utilities}
          </div>
        </div>

        {/* Second tier. Home and Settings belong to no section, so it vanishes
            there rather than sitting empty — DetailPanel measures the header,
            so the height change is absorbed. */}
        {currentSection && (
          <nav
            aria-label={`${sectionLabel(currentSection, locationCode)} sub-sections`}
            className={`flex flex-wrap items-center gap-y-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${TIER_H}`}
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
    </div>
  );
}
