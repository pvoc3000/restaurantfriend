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

export type AppSession = {
  userId: string;
  email: string;
  membership: Membership;
  locations: Location[];
  activeLocation: Location | null;
};

/**
 * Everything a location-scoped screen needs: who you are, which org you belong
 * to, and which location you're "working at" right now (spec §0 — location is
 * session context). Redirects to /login if there's no session.
 *
 * Reads are RLS-scoped, so `locations` only ever contains your org's rows.
 */
export async function getAppSession(): Promise<AppSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role, display_name, last_active_location_id")
    .eq("user_id", user.id)
    .maybeSingle<Membership>();

  if (membershipError) throw membershipError;
  if (!membership) {
    throw new Error(
      `Signed in as ${user.email} but this user has no org_members row. ` +
        "Add one in Supabase Studio (see README §4)."
    );
  }

  const { data: locations, error: locationsError } = await supabase
    .from("locations")
    .select("id, code, name, kind, is_active")
    .eq("is_active", true)
    .order("code");

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
  };
}
