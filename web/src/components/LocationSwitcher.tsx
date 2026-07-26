"use client";

import { useTransition } from "react";
import { setActiveLocation } from "@/app/actions";
import type { Location } from "@/lib/session";

/**
 * Two-tap active-location control (spec §0). Changing the select writes
 * org_members.last_active_location_id and revalidates every screen.
 */
export function LocationSwitcher({
  locations,
  activeLocationId,
}: {
  locations: Location[];
  activeLocationId: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    // No visible caption: the first section tab IS the active location's code,
    // so a "Location" label beside it repeated the word and cost the masthead
    // an extra wrapped row.
    <label className="flex items-center">
      <select
        aria-label="Active location"
        title="Active location"
        className="h-7 border border-white/40 bg-transparent px-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-white disabled:opacity-35 [&>option]:text-ink"
        value={activeLocationId ?? ""}
        disabled={isPending || locations.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          startTransition(async () => {
            await setActiveLocation(id);
          });
        }}
      >
        {/* Code only. The names run to "DONUT FRIEND 01 HIGHLAND PARK" and a
            select is as wide as its widest option, which cost the masthead a
            whole wrapped row — and the codes are what staff say out loud. */}
        {locations.map((l) => (
          <option key={l.id} value={l.id} title={l.name}>
            {l.code}
          </option>
        ))}
      </select>
    </label>
  );
}
