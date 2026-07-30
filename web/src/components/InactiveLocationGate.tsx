"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** The one screen an inactive location still answers for. */
const LOCATION_ROUTE = "/location";

/**
 * What every screen except `/location` says while you're working at a closed
 * shop (Mark, 2026-07-30: "nothing works for inactive locations except the
 * location detail page, allowing the user to activate the location").
 *
 * The switcher lists all six locations so DF03–05 can be maintained at all.
 * That makes a closed shop selectable as working context, and every
 * location-scoped screen would then render as an inexplicably empty table —
 * every query filters by `activeLocation.id` and simply matches nothing.
 * Nothing BREAKS; it just looks broken. This turns that into a sentence and an
 * offer.
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
  if (pathname === LOCATION_ROUTE) return <>{children}</>;

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
          href={LOCATION_ROUTE}
          className="text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          Open the {code} record
        </Link>
        <span className="text-sm text-muted">
          or switch back in the header.
        </span>
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
        className="border-2 border-ink bg-ink px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-35"
      >
        {pending ? "Activating…" : `Activate ${code}`}
      </button>
      {failed && <span className="text-sm text-accent">{failed}</span>}
    </span>
  );
}
