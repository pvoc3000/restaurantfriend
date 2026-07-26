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
    <label className="flex items-center gap-3">
      <span className="text-[12px] uppercase tracking-[0.12em] text-white/55">
        Location
      </span>
      <select
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
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
