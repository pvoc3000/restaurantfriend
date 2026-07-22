import Link from "next/link";
import { signOut } from "@/app/actions";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import type { AppSession } from "@/lib/session";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/items", label: "Inventory" },
  { href: "/vendors", label: "Vendors" },
  { href: "/cleanup", label: "Cleanup" },
];

export function AppHeader({ session }: { session: AppSession }) {
  return (
    <header className="border-b border-neutral-200 bg-neutral-50">
      <div className="flex flex-wrap items-center gap-4 px-4 py-2">
        <span className="font-semibold tracking-tight">restaurantfriend</span>

        <nav className="flex items-center gap-3 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>

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
