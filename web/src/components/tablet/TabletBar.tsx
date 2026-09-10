"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { SwitchUser } from "@/components/SwitchUser";
import { WorkingLocation } from "@/components/WorkingLocation";
import type { Location } from "@/lib/session";
import { TABLET_HOME } from "@/lib/shell";
import { usePublishedHeight } from "@/lib/tableHead";
import { BAR_CELL } from "./barCell";
import { BarLabel, ICON_HOME, ICON_PERSON } from "./BarLabel";
import { BarRecordNav } from "./BarRecordNav";
import { TabletBack } from "./TabletBack";

/**
 * THE TABLET SHELL'S WHOLE CHROME — one black bar, no menus (Mark,
 * 2026-09-09: "The menu system we developed would be gone … replace it with a
 * simple nav bar. We would just need a back button … a home button … If we're
 * in a detail view the nav buttons to go to next/last would be helpful.")
 *
 * Back · Home · [record book], and — ON THE LANDING PAGE ONLY — the shop
 * picker and Switch user (Mark, 2026-09-09: "to make room for other controls,
 * location switching and the account button only need to be on the
 * landing/home page. I don't think we need the title of the page in the menu
 * bar, either"). Every cell is a 64px box with the icon over its word, the
 * runners' footer idiom. No title: the page's own heading says what it is.
 *
 * IT PUBLISHES `--rf-header-h`, not `--rf-runner-h`. Every list in the app
 * offsets its sticky column labels against the masthead's variable
 * (`STICKY_HEAD_ROW_UNDER_CONTROLS`), so a bar that stands where the masthead
 * stood and publishes the same name makes every existing table stick
 * correctly with no per-screen change. That is the deliberate fork; the
 * runner variable is for a banner INSIDE a chrome-less route.
 *
 * `z-50` and `bg-ink`, the masthead's rung and ground. No second tier, so
 * `AppNav`'s memory is simply never written under this shell — the desk shell
 * finds its cookie exactly as it left it.
 */
export function TabletBar({
  locations,
  working,
  registeredDevice,
}: {
  locations: Location[];
  working: Location | null;
  registeredDevice: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  usePublishedHeight(ref, "--rf-header-h");
  const atHome = usePathname() === TABLET_HOME;

  return (
    <header ref={ref} className="sticky top-0 z-50 bg-ink text-white">
      {/* BACK AND HOME ON THE LEFT, THE RECORD BOOK ON THE RIGHT (Mark,
          2026-09-09, his second arrangement): the two that leave a screen sit
          where every browser puts them, and the four that walk a found set
          sit together at the far end, FileMaker's own layout. The landing
          page's shop picker and Switch user take the right end there, where
          no record book can be. */}
      <div className="flex items-center gap-1 px-2">
        <TabletBack />
        <Link href={TABLET_HOME} className={BAR_CELL}>
          <BarLabel icon={ICON_HOME} word="Home" />
        </Link>
        <div className="min-w-0 flex-1" />
        <BarRecordNav />
        {atHome && (
          <div className="flex items-center gap-4 px-3">
            <WorkingLocation locations={locations} working={working} size="lg" />
            {registeredDevice ? (
              <SwitchUser size="lg" />
            ) : (
              <Link href="/account" className={BAR_CELL}>
                <BarLabel icon={ICON_PERSON} word="Account" />
              </Link>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
