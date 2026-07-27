import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AppNav } from "@/components/AppNav";
import { HeaderShell, MenuCollapseButton } from "@/components/HeaderShell";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { GearIcon, HomeIcon, IconButton } from "@/components/ui/IconButton";
import { NAV_COOKIE, parseNavMemory } from "@/lib/navMemory";
import type { AppSession } from "@/lib/session";

export async function AppHeader({ session }: { session: AppSession }) {
  // Seeds the menu's memory on first paint. The client owns it from there —
  // this layout won't re-render on soft navigation (see lib/navMemoryStore.ts).
  const initialMemory = parseNavMemory((await cookies()).get(NAV_COOKIE)?.value);

  return (
    // The shell owns stickiness, the collapse toggle and the measured height —
    // see components/HeaderShell.
    <HeaderShell locationCode={session.activeLocation?.code ?? null}>
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

            {/* Last in the cluster: it's the control you reach for once, when
                you're about to start walking. */}
            <MenuCollapseButton />
          </>
        }
      />
    </HeaderShell>
  );
}
