"use client";

import { useTransition } from "react";
import { setActiveLocation } from "@/app/actions";
import type { Location } from "@/lib/session";

/**
 * Two-tap active-location control (spec §0). Changing the select writes
 * org_members.last_active_location_id and revalidates every screen.
 *
 * It lists EVERY location, closed ones under their own heading (Mark,
 * 2026-07-30). A closed shop is still a record someone maintains, and
 * `/location` is where it's maintained — so switching to it is how you get
 * there. Every other screen then says the location is inactive rather than
 * rendering empty tables (see InactiveLocationGate).
 */
export function LocationSwitcher({
  locations,
  activeLocationId,
}: {
  locations: Location[];
  activeLocationId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const open = locations.filter((l) => l.is_active);
  const closed = locations.filter((l) => !l.is_active);

  return (
    // No visible caption: the first section tab IS the active location's code,
    // so a "Location" label beside it repeated the word and cost the masthead
    // an extra wrapped row.
    <label className="flex items-center">
      <select
        aria-label="Active location"
        title="Active location"
        // The optgroup twin of [&>option]:text-ink is not optional: the select
        // inherits the masthead's white, and a group LABEL without its own
        // colour renders white on the popup's white.
        className="h-6 border border-white/40 bg-transparent px-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-white disabled:opacity-35 [&_optgroup]:text-ink [&_option]:text-ink"
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
            whole wrapped row — and the codes are what staff say out loud.
            The open ones are ungrouped so nothing changes for the everyday
            case: a heading appears only where the list stops being places you
            work. */}
        {open.map((l) => (
          <option key={l.id} value={l.id} title={l.name}>
            {l.code}
          </option>
        ))}
        {closed.length > 0 && (
          <optgroup label="Inactive">
            {closed.map((l) => (
              <option key={l.id} value={l.id} title={l.name}>
                {l.code}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
