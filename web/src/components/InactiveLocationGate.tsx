"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LOCATIONS_ROUTE = "/locations";

/**
 * The routes this gate lets through.
 *
 * `/locations` and its records, because an inactive location still answers for
 * its own record — and with the switcher gone the list is the only way to
 * another location, so gating it would strand you here.
 *
 * `/employees`, because it isn't location-scoped at all: a person belongs to
 * the ORG. Gating it would say "there is nothing here to show" about a screen
 * that would have shown the whole roster.
 *
 * `/special-orders` and `/customers` for the same reason, and one of their own
 * (special-orders brief, decision 8): the screens are deliberately ORG-WIDE,
 * because the phone rings wherever it rings and an order is routinely MADE at
 * one shop for PICKUP at another. Location and kitchen are filter dimensions
 * on the list rather than a scope around it, so there is nothing here for a
 * closed working location to empty.
 */
const UNSCOPED_ROUTES = [
  LOCATIONS_ROUTE,
  "/employees",
  "/special-orders",
  "/customers",
  // Both shops side by side IS the screen, so location is a filter dimension
  // here rather than a scope around it — there is nothing to empty when the
  // working location is closed.
  "/sales",
];

function isUnscopedRoute(pathname: string): boolean {
  return UNSCOPED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * What every screen except the Locations ones says while you're working at a
 * closed shop (Mark, 2026-07-30: "nothing works for inactive locations except
 * the location detail page, allowing the user to activate the location").
 *
 * Every location-scoped screen would otherwise render as an inexplicably empty
 * table — every query filters by `activeLocation.id` and simply matches
 * nothing. Nothing BREAKS; it just looks broken. This turns that into a
 * sentence and an offer.
 *
 * Still load-bearing after "only active locations can be worked at" (Mark,
 * 2026-08-01): that rule closes the ENTRY, not the exit. The Active toggle now
 * sits on the Locations list, so deactivating the very shop you're standing in
 * is one tap away — and a legacy `last_active_location_id` can put you here too.
 *
 * One component, one wiring line in the (app) layout. If it turns out to be in
 * the way, deleting both restores the empty tables and nothing else.
 */
export function InactiveLocationGate({
  code,
  isActive,
  locationId,
  children,
}: {
  code: string | null;
  isActive: boolean;
  locationId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (isActive || !locationId) return <>{children}</>;
  if (isUnscopedRoute(pathname)) return <>{children}</>;

  return (
    <div>
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">{code}</p>
      <h1 className="mt-1 text-[28px] leading-tight font-bold uppercase tracking-[0.06em] text-ink">
        Inactive location
      </h1>
      <div className="mt-4 border-t-2 border-ink" />
      <p className="mt-6 max-w-[72ch] text-sm text-muted">
        You&rsquo;re working at {code}, which is marked inactive. Its record can
        still be read and edited — everything else in the app is scoped to a
        location that trades, so there is nothing here to show.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Activate locationId={locationId} code={code} />
        <Link
          href={`${LOCATIONS_ROUTE}/${locationId}`}
          className="text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          Open the {code} record
        </Link>
        <Link
          href={LOCATIONS_ROUTE}
          className="text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          Choose another location
        </Link>
      </div>
    </div>
  );
}

/** Purchaser+ by RLS, like every other write on the locations table. Below
 *  that the update matches no rows and the message says so. */
function Activate({ locationId, code }: { locationId: string; code: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(null);
            const { error } = await supabase
              .from("locations")
              .update({ is_active: true })
              .eq("id", locationId);
            if (error) {
              setFailed(error.message);
              return;
            }
            router.refresh();
          })
        }
        className="inline-flex h-9 items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "Activating…" : `Activate ${code}`}
      </button>
      {failed && <span className="text-sm text-accent">{failed}</span>}
    </span>
  );
}
