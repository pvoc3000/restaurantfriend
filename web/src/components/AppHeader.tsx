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
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-neutral-50">
      <div className="flex flex-wrap items-center gap-4 px-4 py-2">
        <span className="font-semibold tracking-tight">restaurantfriend</span>

        <NavLinks />

        <div className="ml-auto flex items-center gap-4">
          <LocationSwitcher
            locations={session.locations}
            activeLocationId={session.activeLocation?.id ?? null}
          />

          <span className="text-sm text-neutral-600">
            {session.membership.display_name ?? session.email}
            <span className="ml-1 text-neutral-400">({session.membership.role})</span>
          </span>

          <form action={signOut}>
            <button
              type="submit"
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm hover:bg-neutral-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
