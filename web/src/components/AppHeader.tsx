import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AppNav } from "@/components/AppNav";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { GearIcon, HomeIcon, IconButton } from "@/components/ui/IconButton";
import { NAV_COOKIE, parseNavMemory } from "@/lib/navMemory";
import type { AppSession } from "@/lib/session";

export async function AppHeader({ session }: { session: AppSession }) {
  // Seeds the menu's memory on first paint. The client owns it from there —
  // this layout won't re-render on soft navigation (see lib/navMemoryStore.ts).
  const initialMemory = parseNavMemory((await cookies()).get(NAV_COOKIE)?.value);

  return (
    // Sticky and above the detail panel (z-50 vs the panel's z-40): the panel
    // is a slide-over, not a modal, so the nav has to stay reachable — a
    // full-viewport backdrop over the header made every nav link unclickable.
    // Sticky is load-bearing, not decorative: the panel is fixed and starts
    // below the header, so a header that scrolled away would leave a dead strip.
    <header className="sticky top-0 z-50 bg-ink text-white">
      <AppNav
        initialMemory={initialMemory}
        locationCode={session.activeLocation?.code ?? null}
        utilities={
          <>
            <IconButton href="/" label="Home">
              <HomeIcon />
            </IconButton>

            <IconButton href="/settings" label="Settings">
              <GearIcon />
            </IconButton>

            <LocationSwitcher
              locations={session.locations}
              activeLocationId={session.activeLocation?.id ?? null}
            />

            <span className="whitespace-nowrap text-[12px] uppercase tracking-[0.12em] text-white/55">
              {session.membership.display_name ?? session.email}
              <span> · {session.membership.role}</span>
            </span>

            <form action={signOut}>
              <button
                type="submit"
                className="h-7 border border-white/40 bg-transparent px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-white hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </>
        }
      />
    </header>
  );
}
