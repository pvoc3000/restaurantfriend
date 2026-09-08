"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE } from "@/lib/sharedDevice";
import { clearSessionCookies } from "@/lib/sessionCookies";

export async function signOut() {
  const supabase = await createClient();
  // `local`, not the default `global`: global revokes every refresh token
  // the user holds, and signing out of a shared iPad must not sign the
  // manager out of their own phone.
  await supabase.auth.signOut({ scope: "local" });
  // The remembered views and the menu are per-session state, not per-user
  // config — the next person on this machine starts from the defaults.
  const jar = await cookies();
  clearSessionCookies(jar);
  // A registered iPad goes back to its picker; anything else to the
  // password screen. The device cookie itself survives a sign-out.
  redirect(jar.has(DEVICE_COOKIE) ? "/lock" : "/login");
}

/**
 * Persist the active location per user (spec §0 / rule 3).
 *
 * Goes through the set_my_member_profile() function (migration 002) rather
 * than updating org_members directly: RLS filters rows, not columns, so a
 * direct write would need a policy that also lets members edit their own
 * `role`. The function can only touch the two columns it names.
 */
export async function setActiveLocation(locationId: string) {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_my_member_profile", {
    p_location_id: locationId,
  });

  if (error) throw error;

  revalidatePath("/", "layout");
}

/**
 * The member's own display name — the other column `set_my_member_profile`
 * names, and the one thing on /account that reaches `org_members`. The
 * masthead reads it, so the layout revalidates. An empty string CLEARS it
 * (the function's own contract), after which the masthead falls back to the
 * email.
 */
export async function setDisplayName(name: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_member_profile", {
    p_display_name: name.trim(),
  });
  if (error) throw error;
  revalidatePath("/", "layout");
}
