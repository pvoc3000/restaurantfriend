import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Location = {
  id: string;
  code: string;
  name: string;
  kind: "physical" | "virtual";
  is_active: boolean;
};

export type Membership = {
  org_id: string;
  role: "owner" | "admin" | "purchaser" | "staff";
  display_name: string | null;
  last_active_location_id: string | null;
};

export type OrgSettings = { timezone?: string } & Record<string, unknown>;

export type AppSession = {
  userId: string;
  email: string;
  membership: Membership;
  locations: Location[];
  activeLocation: Location | null;
  /** orgs.settings, embedded here rather than fetched again: it's one jsonb
   *  column reached through an FK the membership query already traverses, and
   *  a separate round trip for it cost the order guide ~110ms. */
  orgSettings: OrgSettings;
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
      .select("org_id, role, display_name, last_active_location_id, orgs(settings)")
      .eq("user_id", user.id)
      .maybeSingle<Membership & { orgs: { settings: OrgSettings | null } | null }>(),
    supabase
      .from("locations")
      .select("id, code, name, kind, is_active")
      .eq("is_active", true)
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

  const list = (locations ?? []) as Location[];
  // Fall back to the first location so a fresh user always has a context.
  const activeLocation =
    list.find((l) => l.id === membership.last_active_location_id) ?? list[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    membership,
    locations: list,
    activeLocation,
    orgSettings: membership.orgs?.settings ?? {},
  };
});
