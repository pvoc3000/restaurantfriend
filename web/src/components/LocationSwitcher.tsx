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
    <label className="flex items-center gap-2 text-sm">
      <span className="text-neutral-500">Location</span>
      <select
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
        value={activeLocationId ?? ""}
        disabled={isPending || locations.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          startTransition(async () => {
            await setActiveLocation(id);
          });
        }}
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
