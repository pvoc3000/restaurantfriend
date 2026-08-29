"use client";

import { useTransition } from "react";

import { setActiveLocation } from "@/app/actions";
import { PickList, type PickOption } from "@/components/ui/PickList";
import type { Location } from "@/lib/session";

/**
 * The working location, chosen from the masthead (Mark, 2026-08-27).
 *
 * There was a switcher here until 2026-08-01, when `/locations` took the job
 * over and it was deleted — the argument being that a list you can read is a
 * better place to choose a shop than a two-tap control in the corner. That
 * list is still where you READ about a shop; what it turned out not to be is a
 * good place to SWITCH from, because switching is something you do on the way
 * to somewhere else and it made you leave wherever you were to do it. So the
 * control comes back and the list keeps its `WorkingHere` column: two routes
 * to one act, which is what the two screens' two purposes ask for.
 *
 * It is a `PickList`, not the old native `<select>` — there are none of those
 * left in the app, and a masthead is exactly where an OS menu looks most out
 * of place. `align="right"` because it is the last thing on the row and a
 * panel hanging off the right edge would be clipped.
 *
 * ONLY ACTIVE LOCATIONS ARE OFFERED, which is `WorkingHere`'s rule rather than
 * the old switcher's: only an open shop is one you can work at, and the reason
 * the switcher listed closed ones — that switching to a shop was the only way
 * to reach its record — died with `/locations`. The working location is still
 * listed even if somebody has just closed it, or the trigger would show a raw
 * id in place of the code; it says so with a hint.
 *
 * The write is `setActiveLocation`, whose `revalidatePath("/", "layout")`
 * re-renders every screen in place — so there is nothing to navigate to and
 * `isPending` covers the action AND the render that follows it.
 */
export function WorkingLocation({
  locations,
  working,
}: {
  /** The ones you MAY WORK AT — `session.workableLocations`. This control
   *  offers a SWITCH, so it must never list a shop `set_my_member_profile`
   *  would refuse; `activeLocations` is the list for enumerating shops. */
  locations: Location[];
  working: Location | null;
}) {
  const [pending, startTransition] = useTransition();

  const options: PickOption[] = locations.map((l) => ({
    value: l.id,
    // The CODE, not the name: the names run to "Donut Friend 01 Highland Park",
    // and the codes are what staff say out loud. The name rides as the hint, so
    // the panel still answers "which one is that?" without the trigger paying
    // for it in width.
    label: l.code,
    hint: l.name,
  }));

  if (working && !locations.some((l) => l.id === working.id)) {
    options.unshift({ value: working.id, label: working.code, hint: "inactive" });
  }

  return (
    <PickList
      variant="masthead"
      align="right"
      // The trigger is four characters wide and the rows are a code plus a
      // shop's full name, so the panel needs its own floor — at the default
      // 168px "Donut Friend 01 Highland Park" breaks over four lines.
      panelMinWidth={300}
      ariaLabel="Working location"
      value={working?.id ?? null}
      options={options}
      placeholder="No shop"
      disabled={pending || options.length === 0}
      onPick={(id) => {
        if (!id || id === working?.id) return;
        startTransition(async () => {
          await setActiveLocation(id);
        });
      }}
    />
  );
}
