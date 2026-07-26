import { signOut } from "@/app/actions";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { NavLinks } from "@/components/NavLinks";
import type { AppSession } from "@/lib/session";

export function AppHeader({ session }: { session: AppSession }) {
  return (
    // Sticky and above the detail panel (z-50 vs the panel's z-40): the panel
    // is a slide-over, not a modal, so the nav has to stay reachable — a
    // full-viewport backdrop over the header made every nav link unclickable.
    // Sticky is load-bearing, not decorative: the panel is fixed and starts
    // below the header, so a header that scrolled away would leave a dead strip.
    <header className="sticky top-0 z-50 bg-ink text-white">
      <div className="flex min-h-16 flex-wrap items-center gap-12 px-12 py-3">
        <span className="whitespace-nowrap text-[15px] font-bold uppercase tracking-[0.06em]">
          Restaurant Friend
        </span>

        <NavLinks />

        <div className="ml-auto flex items-center gap-8">
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
        </div>
      </div>
    </header>
  );
}
