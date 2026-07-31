"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SideTopBar } from "@/components/SideTopBar";
import { NavIcon } from "@/components/ui/NavIcons";
import type { ChromeMode } from "@/lib/chromeMode";
import { setChromeMode, useChromeMode } from "@/lib/chromeModeStore";
import { SECTIONS, resolveRoute, sectionHref, sectionLabel } from "@/lib/nav";
import type { NavMemory } from "@/lib/navMemory";
import { useNavMemory, useRememberNavPosition } from "@/lib/navMemoryStore";

/**
 * The left navigation rail — the alternative chrome, on trial against the two
 * black bands (Mark, 2026-07-31, from bill.com / QuickBooks / Square / Indeed).
 *
 * It is a SYNTHESIS of the two references Mark supplied:
 *  · Indeed — a narrow strip of marks, a hamburger at the top that expands it to
 *    labels, and expanding PUSHES the content right rather than floating over
 *    it.
 *  · Square — the second tier is a nested list inline under its parent, shut by
 *    default and opened by a caret, rather than Indeed's popup panel.
 *
 * The menu itself is still lib/nav.ts, unchanged: SECTIONS, resolveRoute,
 * sectionHref and sectionLabel are shared with AppNav, so the two chromes can
 * never disagree about what the menu contains or which page is current. Only the
 * slug→mark map is new (components/ui/NavIcons).
 *
 * TAPPING A MARK NAVIGATES — it does not open the panel. That keeps the app's
 * most-used interaction at one tap, the same as a section tab today; going via
 * the panel would make every navigation two taps and you'd end up judging the
 * layout by a decision that could have gone the other way. The trade-off is
 * real and is the thing the trial is meant to measure: today the second tier is
 * always on screen, so hopping between sibling screens is one tap, and here it
 * costs opening the panel first.
 *
 * WIDTHS. At xl and up the rail is 56px and the open panel is 240px, and
 * globals.css turns each into page padding, so the content is genuinely pushed.
 * Below xl neither is in the layout at all — --rf-nav-w stays 0 — and the panel
 * becomes an overlay with a scrim, opened from the top bar's Menu button. The
 * order guide's row bottoms out at 710px of content against an iPad portrait's
 * 736, so no rail width fits there; Square, bill.com and Indeed all take the
 * sidebar off-canvas on tablet for the same reason.
 */
export function SideNav({
  initialMemory,
  initialMode,
  locationCode,
  controls,
  identity,
}: {
  initialMemory: NavMemory;
  initialMode: ChromeMode;
  locationCode: string | null;
  controls: React.ReactNode;
  identity: React.ReactNode;
}) {
  const pathname = usePathname();
  const here = resolveRoute(pathname);
  const memory = useNavMemory(initialMemory);
  useRememberNavPosition(here?.sectionSlug, here?.subSlug);

  const mode = useChromeMode(initialMode);
  const open = mode === "side-open";

  // The overlay below xl keeps its OWN open state rather than reading the
  // cookie. The cookie has to be a mode because pushing changes the
  // server-rendered geometry — but below xl nothing is pushed, and a panel that
  // restored itself from a desktop session would land on an iPad as a scrim over
  // the whole screen before you'd touched anything.
  const [narrowOpen, setNarrowOpen] = useState(false);

  useEffect(() => {
    if (!narrowOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNarrowOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrowOpen]);

  // Which section's subs are showing. DERIVED from the route, with a manual
  // override that only holds while you stay in the same section — so navigating
  // to another module discloses that module without an effect syncing state
  // behind your back (which is also what the lint config forbids). Accordion,
  // one at a time: all six open is 39 rows, taller than any window.
  const current = here?.sectionSlug ?? null;
  const [override, setOverride] = useState<{
    forSection: string | null;
    slug: string | null;
  } | null>(null);
  const disclosed =
    override && override.forSection === current ? override.slug : current;

  const closeNarrow = () => setNarrowOpen(false);

  return (
    <>
      <SideTopBar
        controls={controls}
        identity={identity}
        onOpenMenu={() => setNarrowOpen(true)}
      />

      {/* THE RAIL. Not rendered while the panel is open — the panel replaces it
          rather than sitting beside it. `hidden xl:flex`, never below xl. */}
      {!open && (
        <aside
          aria-label="Sections"
          className="fixed inset-y-0 left-0 z-50 hidden w-14 flex-col bg-ink text-white xl:flex"
        >
          <RailButton
            label="Show the menu labels"
            onClick={() => setChromeMode("side-open")}
          />
          <nav className="flex flex-col">
            {SECTIONS.map((section) => {
              const active = section.slug === current;
              const label = sectionLabel(section, locationCode);
              return (
                <Link
                  key={section.slug}
                  href={sectionHref(section, memory)}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  // 56px cells, the app's own row height. The active mark is a
                  // yellow left edge — the vertical form of the design system's
                  // yellow underline — plus yellow type, which together are the
                  // one yellow thing the system allows per screen.
                  className={`flex h-14 items-center justify-center border-l-[3px] no-underline ${
                    active
                      ? "border-mark text-mark"
                      : "border-transparent text-white/60 hover:text-white"
                  }`}
                >
                  <NavIcon name={section.slug} />
                </Link>
              );
            })}
          </nav>
        </aside>
      )}

      {/* THE SCRIM, below xl only. The desktop panel is a pushed column, not an
          overlay, so it never dims anything. */}
      {narrowOpen && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={closeNarrow}
          // bg-black/55 is the app's scrim, from ui/Dialog — matched rather
          // than spelled as a token with an opacity modifier, which is the
          // shape that has broken this build before (see ui/BackToTop).
          className="fixed inset-0 z-40 bg-black/55 xl:hidden"
        />
      )}

      {/* THE PANEL. One element serving both presentations, with the width split
          done in CSS so there's no media query in JS to disagree with the
          layout: hidden at xl unless the mode says open, hidden below xl unless
          the Menu button says open. */}
      {(open || narrowOpen) && (
        <aside
          aria-label="Sections"
          className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col overflow-y-auto bg-ink text-white ${
            open ? "" : "xl:hidden"
          } ${narrowOpen ? "" : "max-xl:hidden"}`}
        >
          <RailButton
            label="Hide the menu labels"
            word="Collapse"
            onClick={() => {
              setChromeMode("side");
              closeNarrow();
            }}
          />

          <nav className="flex flex-col pb-4">
            {SECTIONS.map((section) => {
              const active = section.slug === current;
              const isOpen = disclosed === section.slug;
              const label = sectionLabel(section, locationCode);

              return (
                <div key={section.slug}>
                  <div
                    className={`flex items-stretch border-l-[3px] ${
                      active ? "border-mark" : "border-transparent"
                    }`}
                  >
                    {/* The row both navigates AND discloses — Square's
                        behaviour. The caret is a SIBLING button, not a child, so
                        there's no interactive element inside a link and nothing
                        has to stop a click propagating. */}
                    <Link
                      href={sectionHref(section, memory)}
                      onClick={closeNarrow}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-11 min-w-0 flex-1 items-center gap-3 pl-4 text-[12px] font-semibold tracking-[0.06em] uppercase no-underline ${
                        active ? "text-mark" : "text-white/60 hover:text-white"
                      }`}
                    >
                      <NavIcon name={section.slug} />
                      <span className="truncate">{label}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        setOverride({
                          forSection: current,
                          slug: isOpen ? null : section.slug,
                        })
                      }
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} the ${label} screens`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-white/50 hover:text-white"
                    >
                      {/* ▼ open, a quarter turn anti-clockwise when shut — the
                          app's one disclosure idiom, shared with
                          MenuCollapseButton and the guide's item triangle. */}
                      <span
                        aria-hidden
                        className={`inline-block transition-transform ${isOpen ? "" : "-rotate-90"}`}
                      >
                        ▼
                      </span>
                    </button>
                  </div>

                  {isOpen &&
                    section.subs.map((sub) => {
                      const here2 = active && sub.slug === here?.subSlug;
                      return (
                        <Link
                          key={sub.slug}
                          href={sub.href}
                          onClick={closeNarrow}
                          aria-current={here2 ? "page" : undefined}
                          // pl-11 lands the label under the section label, past
                          // the 24px mark and its gap.
                          className={`flex h-9 items-center pr-4 pl-11 text-[11px] font-semibold tracking-[0.06em] uppercase no-underline ${
                            here2 ? "text-white" : "text-white/50 hover:text-white"
                          }`}
                        >
                          <span className="truncate">{sub.label}</span>
                        </Link>
                      );
                    })}
                </div>
              );
            })}
          </nav>
        </aside>
      )}
    </>
  );
}

/**
 * The rail's own expand/collapse. ONE control in both states, in the same cell
 * at the same height — the lesson MenuCollapseButton records: a toggle that
 * changes shape reads as a different object rather than as the same switch
 * flipped. It gains a word when there's room for one.
 */
function RailButton({
  label,
  word,
  onClick,
}: {
  label: string;
  word?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-14 shrink-0 items-center gap-3 text-white/60 hover:text-white ${
        word ? "pl-4" : "justify-center"
      }`}
    >
      <NavIcon name="menu" />
      {word && (
        <span className="text-[12px] font-semibold tracking-[0.06em] uppercase">
          {word}
        </span>
      )}
    </button>
  );
}
