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

/**
 * The two-tier menu, inherited from DF Operations: sections on top, that
 * section's sub-sections beneath. See lib/nav.ts for the menu itself and
 * lib/navMemoryStore.ts for the "last sub-section per section" memory.
 *
 * Both tiers mark the active item in yellow (Mark, 2026-07-25). The design
 * system spends yellow on one thing per screen, so the tiers are told apart by
 * everything else instead: 12px vs 11px, a brighter inactive white on top, and
 * a hairline between the bands. Both bands are black — there is no grey chrome.
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
    <>
      <div className="flex min-h-14 flex-wrap items-center gap-x-8 gap-y-2 px-12 py-2">
        <span className="whitespace-nowrap text-[13px] font-bold uppercase tracking-[0.06em]">
          Restaurant Friend
        </span>

        <nav
          aria-label="Sections"
          className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] font-semibold uppercase tracking-[0.06em]"
        >
          {SECTIONS.map((section) => {
            const active = section.slug === sectionSlug;
            return (
              <Link
                key={section.slug}
                href={sectionHref(section, memory)}
                aria-current={active ? "page" : undefined}
                // A bottom BORDER, not text-decoration: Safari places an
                // underline-offset rule inconsistently against the header's own
                // border and it can vanish. The transparent border on inactive
                // items keeps every tab the same height.
                className={`border-b-2 pb-0.5 whitespace-nowrap no-underline ${
                  active
                    ? "border-[var(--rf-yellow-500)] text-[var(--rf-yellow-500)]"
                    : "border-transparent text-white/60 hover:text-white"
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {utilities}
        </div>
      </div>

      {/* Second tier. Home and Settings belong to no section, so the band —
          and the rule above it — disappears there rather than sitting empty.
          DetailPanel measures the header, so the height change is absorbed. */}
      {currentSection && (
        <div className="border-t border-white/15 px-12 py-2">
          <nav
            aria-label={`${sectionLabel(currentSection, locationCode)} sub-sections`}
            className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.06em]"
          >
            {currentSection.subs.map((sub) => {
              const active = sub.slug === subSlug;
              return (
                <Link
                  key={sub.slug}
                  href={sub.href}
                  aria-current={active ? "page" : undefined}
                  className={`border-b-2 pb-0.5 whitespace-nowrap no-underline ${
                    active
                      ? "border-[var(--rf-yellow-500)] text-[var(--rf-yellow-500)]"
                      : "border-transparent text-white/50 hover:text-white"
                  }`}
                >
                  {sub.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
