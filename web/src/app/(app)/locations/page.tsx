import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { LocationsList, type LocationRow } from "@/components/location/LocationsList";
import { canEditPage } from "@/lib/pageAccess";

/**
 * Every location in the org, and where you choose the one you're working at
 * (Mark, 2026-08-01 — FMP's shape, replacing the masthead switcher).
 *
 * Its own query rather than `session.locations`: that list is on every request
 * in the app and carries no address, and widening it to a jsonb column for one
 * screen's City would be paid for everywhere. Six rows, RLS-scoped, and no
 * `is_active` filter — a closed shop is exactly what this list exists to show
 * you, and its toggle is how it reopens.
 */
export default async function LocationsPage() {
  const session = await getAppSession();
  const supabase = await createClient();

  // Writes on `locations` need purchaser+ (the generic policy from 001), so
  // below that the Active column isn't offered at all. Choosing where YOU work
  // is a different write — set_my_member_profile, granted to every member — so
  // the Working column stays.
  const editable = canEditPage(session.membership.role, "/locations");

  const { data, error } = await supabase
    .from("locations")
    .select("id, code, name, kind, is_active, address")
    .order("code");

  if (error) {
    return <p className="text-sm text-accent">Could not load locations: {error.message}</p>;
  }

  // The address document is unpacked here so the client component never has to
  // know its shape (see components/location/AddressFields).
  const rows: LocationRow[] = (data ?? []).map((l) => {
    const address = (l.address ?? {}) as Record<string, unknown>;
    const shipping = (address.shipping ?? {}) as Record<string, unknown>;
    const city = shipping.city;
    return {
      id: l.id as string,
      code: l.code as string,
      name: l.name as string,
      kind: l.kind as "physical" | "virtual",
      is_active: l.is_active as boolean,
      city: typeof city === "string" && city.trim() !== "" ? city : null,
    };
  });

  return (
    <div className="space-y-6">
      {/* Deliberately NOT keyed by the working location, unlike every other
          location-scoped screen: these rows ARE the locations, so none of them
          goes stale when the working one changes, and remounting would throw
          away the reader's search and sort on every "Work here" tap. */}
      <LocationsList
        rows={rows}
        workableIds={session.workableLocations.map((l) => l.id)}
        workingLocationId={session.activeLocation?.id ?? null}
        editable={editable}
        orgId={session.membership.org_id}
      />
    </div>
  );
}
