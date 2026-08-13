import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export type Location = {
  id: string;
  code: string;
  name: string;
  kind: "physical" | "virtual";
  is_active: boolean;
  /**
   * The shop's hourly labour rate — maintained on the Location record, read by
   * PAYROLL, and since 2026-08-12 a COSTING input too: a made element's cost
   * includes the prep time on its recipe, and that is hours until a rate turns
   * it into money.
   *
   * It used to be fetched by the one screen that showed it, deliberately —
   * "one column read by one screen, and the session is paid for by every
   * screen there is". That stopped being true when the recipe block's
   * arithmetic became the app's ONE cost calculation: it is now read by every
   * screen that quotes a cost, which is most of Production. One more column on
   * a query already fetching every location beats seven screens each making
   * their own round trip.
   */
  labor_rate: number | null;
};

export type Membership = {
  org_id: string;
  role: Role;
  display_name: string | null;
  last_active_location_id: string | null;
};

export type OrgSettings = { timezone?: string } & Record<string, unknown>;

export type AppSession = {
  userId: string;
  email: string;
  membership: Membership;
  /**
   * EVERY location in the org, inactive ones included (Mark, 2026-07-30) — the
   * Locations list shows all six, because an inactive location is still a
   * record someone has to maintain and `/locations/[id]` is where it's
   * maintained.
   *
   * Use this to LOOK UP a location by id. A `vendor_locations` row at DF03 now
   * renders its code instead of an em dash.
   */
  locations: Location[];
  /**
   * The subset you'd ENUMERATE — a row per location, a scope over locations.
   * Item detail's per-location rows, the vendor item's price rows and the
   * cleanup queue's all-locations mode all use this, so three closed shops
   * don't sprout dead rows on every screen in the app.
   */
  activeLocations: Location[];
  activeLocation: Location | null;
  /** orgs.settings, embedded here rather than fetched again: it's one jsonb
   *  column reached through an FK the membership query already traverses, and
   *  a separate round trip for it cost the order guide ~110ms. */
  orgSettings: OrgSettings;
  /** `orgs.name`. Empty only if the embed ever comes back null. */
  orgName: string;
};

/**
 * Everything a location-scoped screen needs: who you are, which org you belong
 * to, and which location you're "working at" right now (spec §0 — location is
 * session context). Redirects to /login if there's no session.
 *
 * Reads are RLS-scoped, so `locations` only ever contains your org's rows.
 *
 * Wrapped in React `cache()` because nearly every screen calls this from BOTH
 * the (app) layout and its own page. Without it that's a second round trip to
 * auth plus two more queries on every navigation — ~450ms of the order guide's
 * wait was the layout and the page asking the same three questions (measured
 * 2026-07-26). `cache()` dedupes within a single request only, so nothing is
 * shared between users or between navigations.
 */
export const getAppSession = cache(async function getAppSession(): Promise<AppSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Independent of each other — locations doesn't even need the user id, RLS
  // scopes it — so they go together rather than one after the other.
  const [
    { data: membership, error: membershipError },
    { data: locations, error: locationsError },
  ] = await Promise.all([
    supabase
      .from("org_members")
      .select("org_id, role, display_name, last_active_location_id, orgs(name, settings)")
      .eq("user_id", user.id)
      .maybeSingle<Membership & { orgs: { name: string; settings: OrgSettings | null } | null }>(),
    // No is_active filter: the Locations list carries every one of them. See
    // the two fields on AppSession for which list a screen should reach for.
    supabase
      .from("locations")
      .select("id, code, name, kind, is_active, labor_rate")
      .order("code"),
  ]);

  if (membershipError) throw membershipError;
  if (!membership) {
    throw new Error(
      `Signed in as ${user.email} but this user has no org_members row. ` +
        "Add one in Supabase Studio (see README §4)."
    );
  }

  if (locationsError) throw locationsError;

  // `labor_rate` is a numeric column, and PostgREST hands numerics back as
  // strings often enough that costing would silently multiply hours by "35".
  const list = (locations ?? []).map((l) => ({
    ...l,
    labor_rate: l.labor_rate === null || l.labor_rate === undefined ? null : Number(l.labor_rate),
  })) as Location[];
  const active = list.filter((l) => l.is_active);
  // Resolved over the FULL list, not the active one: a closed location as
  // working context would otherwise fall through to the `?? …[0]` and snap
  // silently back to DF01, which looks exactly like the write not landing.
  // The fallback stays active-only so a fresh user lands somewhere real.
  const activeLocation =
    list.find((l) => l.id === membership.last_active_location_id) ?? active[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    membership,
    locations: list,
    activeLocations: active,
    activeLocation,
    orgSettings: membership.orgs?.settings ?? {},
    // The org's own name, from the SAME embed rather than a second query.
    // Design rule 2: business names live in the database, never in code — and
    // the payroll export needs one to name its file.
    orgName: membership.orgs?.name ?? "",
  };
});
