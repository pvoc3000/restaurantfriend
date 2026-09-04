import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AppNav } from "@/components/AppNav";
import { HeaderShell } from "@/components/HeaderShell";
import { GearIcon, IconButton, OrgIcon } from "@/components/ui/IconButton";
import { canReachPage } from "@/lib/pageAccess";
import { WorkingLocation } from "@/components/WorkingLocation";
import { NAV_COOKIE, parseNavMemory } from "@/lib/navMemory";
import { sectionsForRole } from "@/lib/nav";
import type { AppSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";

export async function AppHeader({ session }: { session: AppSession }) {
  // Seeds the menu's memory on first paint. The client owns it from there —
  // this layout won't re-render on soft navigation (see lib/navMemoryStore.ts).
  const initialMemory = parseNavMemory((await cookies()).get(NAV_COOKIE)?.value);

  return (
    // The shell owns stickiness and the measured height — see
    // components/HeaderShell.
    <HeaderShell>
      <AppNav
        // Filtered HERE, on the server, where the session already is.
        sections={sectionsForRole(session.membership.role)}
        initialMemory={initialMemory}
        // Which shop's remembered screens the tabs should offer. A remembered
        // purchase order belongs to one location; `navPathKey` files them apart
        // so switching shops can't send you to another one's record.
        locationId={session.activeLocation?.id ?? null}
        // Row 1: where to go, and which shop you're doing it at. The location
        // switcher sat here until 2026-08-01, when the Locations list replaced
        // it and the tier-1 tab took over wearing the code; it is back
        // (Mark, 2026-08-27), LAST — after Settings, at the far right of the
        // masthead — and the tab is a plain "Locations" again. The
        // chrome-collapse toggle was here too until 2026-08-02; see
        // components/HeaderShell.
        controls={
          <>
            {/* TWO SETTINGS, TWO ICONS (Mark, 2026-09-04): the storefront is
                the ORG's — what the business says and is connected to, manager
                and owner only, so the icon is withheld from anyone the table
                refuses — and the gear is YOUR OWN: name, password, the shops
                you may work at. The house that stood first went with it; the
                section tabs are the way home, and `/` still lands per role. */}
            {canReachPage(session.membership.role, "/settings") && (
              <IconButton href="/settings" label="Org settings">
                <OrgIcon />
              </IconButton>
            )}

            <IconButton href="/account" label="Your settings">
              <GearIcon />
            </IconButton>

            {/* The ones this member MAY WORK AT — `workableLocations`, which
                is `activeLocations` narrowed by 073's grid and identical to it
                for anybody unrestricted. A switcher must never offer a shop
                `set_my_member_profile` would refuse. */}
            <WorkingLocation
              locations={session.workableLocations}
              working={session.activeLocation}
            />
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
