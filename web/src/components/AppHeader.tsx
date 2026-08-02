import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AppNav } from "@/components/AppNav";
import { HeaderShell, MenuCollapseButton } from "@/components/HeaderShell";
import { GearIcon, HomeIcon, IconButton } from "@/components/ui/IconButton";
import { NAV_COOKIE, parseNavMemory } from "@/lib/navMemory";
import type { AppSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";

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
        // Row 1: what you're looking at. Where to go, and whether the chrome is
        // showing (Mark, 2026-07-29 — the old single row is now two, to match
        // the menu's two tiers). The location SWITCHER used to sit here; the
        // Locations list replaced it (Mark, 2026-08-01), and the code you're
        // working at is still on screen at all times — the tier-1 tab wears it
        // (lib/nav sectionLabel) and so does the collapsed strip.
        controls={
          <>
            <IconButton href="/" label="Home">
              <HomeIcon />
            </IconButton>

            <IconButton href="/settings" label="Settings">
              <GearIcon />
            </IconButton>

            {/* Last in this row: it's the control you reach for once, when
                you're about to start walking. It belongs with the view
                controls rather than with the session ones — it changes what
                you can see, not who you are. */}
            <MenuCollapseButton />
          </>
        }
        // Row 2: who you are, and leaving.
        identity={
          <>
            <span className="whitespace-nowrap text-[12px] uppercase tracking-[0.12em] text-white/55">
              {session.membership.display_name ?? session.email}
              <span> · {ROLE_LABEL[session.membership.role]}</span>
            </span>

            {/* No box (Mark, 2026-07-29). It's type in the same idiom as the
                section tabs — quiet until you hover — which also stops row 2
                reading as a row of controls when it's really a statement about
                who you are with one way out of it. */}
            {/* flex, or the button sits 1.3px low against the name beside it
                (measured 2026-07-29). A form is a block, and an inline-block
                button inside one sits on a text baseline — so the form's box
                came out 22.5px around an 18px button, with the descender space
                below it, and the row's items-center centred the FORM rather
                than the button. flex makes the form exactly its button's
                height. */}
            <form action={signOut} className="flex">
              <button
                type="submit"
                className="text-[12px] font-semibold uppercase tracking-[0.06em] text-white/60 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </>
        }
      />
    </HeaderShell>
  );
}
