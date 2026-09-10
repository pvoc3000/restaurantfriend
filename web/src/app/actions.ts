"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE } from "@/lib/sharedDevice";
import { SHELL_COOKIE, type Shell } from "@/lib/shell";
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
 * Which shell THIS BROWSER gets — the desk masthead or the tablet bar
 * (`lib/shell`). A device property, so it is set server-side (Safari caps a
 * script-written cookie at seven days) for a year, and it is NOT in
 * `clearSessionCookies`: the iPad must still be a tablet after a lock, an
 * unlock or a sign-out. The caller hard-navigates to `/` afterwards so the
 * new shell's own landing paints; the layout revalidation is for any tab
 * that stays put.
 */
export async function setShell(shell: Shell) {
  const jar = await cookies();
  jar.set(SHELL_COOKIE, shell, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
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
