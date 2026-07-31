import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { ChromeToggle } from "@/components/ChromeToggle";
import { MenuCollapseButton } from "@/components/HeaderShell";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { SideNav } from "@/components/SideNav";
import { GearIcon, HomeIcon, IconButton } from "@/components/ui/IconButton";
import type { ChromeMode } from "@/lib/chromeMode";
import { NAV_COOKIE, parseNavMemory } from "@/lib/navMemory";
import type { AppSession } from "@/lib/session";

/**
 * AppHeader's twin for the left-rail chrome: composes the same server-only
 * pieces — LocationSwitcher's props and the signOut form action — and hands them
 * to a client component as slots.
 *
 * ————————————————————————————————————————————————————————————————
 * THIS CHROME IS ON TRIAL (Mark, 2026-07-31) and one of the two will be deleted
 * once he knows which he prefers. To DELETE THE SIDEBAR:
 *
 *   · remove components/{SideChrome,SideNav,SideTopBar,AppChrome,ChromeToggle}
 *     and components/ui/NavIcons
 *   · remove lib/{chromeMode,chromeModeStore}
 *   · in app/(app)/layout.tsx: drop the cookie read and the <AppChrome> wrapper,
 *     leaving <AppHeader> as a direct child again
 *   · in app/globals.css: drop the --rf-nav-w / --rf-content-* block, and put
 *     `px-4 xl:px-12` back on <main> and on ui/ActionBar; put `left-3` back on
 *     ui/BackToTop
 *   · drop <ChromeToggle> from AppHeader's controls and from HeaderShell's strip
 *   · lib/headerHeight can stay — it's HeaderShell's own effect, just named
 *
 * To delete the TOP MENU instead (AppHeader, AppNav, HeaderShell):
 * MenuCollapseButton has to move out of HeaderShell into SideTopBar FIRST. The
 * order guide reads useChromeCollapsed() to hide its shelf, and deleting the
 * button without rehoming it strands the flag with nothing able to set it.
 *
 * lib/nav.ts and lib/navMemoryStore are shared and stay either way.
 * ————————————————————————————————————————————————————————————————
 */
export async function SideChrome({
  session,
  chromeMode,
}: {
  session: AppSession;
  chromeMode: ChromeMode;
}) {
  // Seeds the menu's memory on first paint, exactly as AppHeader does — the
  // client store is a module singleton, so the two chromes share one memory and
  // switching between them carries your position across.
  const initialMemory = parseNavMemory((await cookies()).get(NAV_COOKIE)?.value);

  return (
    <SideNav
      initialMemory={initialMemory}
      initialMode={chromeMode}
      locationCode={session.activeLocation?.code ?? null}
      // Same two slots as AppNav, same contents, same order — the utilities
      // shouldn't move just because the menu did.
      controls={
        <>
          <IconButton href="/" label="Home">
            <HomeIcon />
          </IconButton>

          <ChromeToggle initialMode={chromeMode} />

          <IconButton href="/settings" label="Settings">
            <GearIcon />
          </IconButton>

          <LocationSwitcher
            locations={session.locations}
            activeLocationId={session.activeLocation?.id ?? null}
          />

          <MenuCollapseButton />
        </>
      }
      identity={
        <>
          <span className="text-[12px] tracking-[0.12em] whitespace-nowrap text-white/55 uppercase">
            {session.membership.display_name ?? session.email}
            <span> · {session.membership.role}</span>
          </span>

          <form action={signOut} className="flex">
            <button
              type="submit"
              className="text-[12px] font-semibold tracking-[0.06em] text-white/60 uppercase hover:text-white"
            >
              Sign out
            </button>
          </form>
        </>
      }
    />
  );
}
