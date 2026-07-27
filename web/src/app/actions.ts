"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NAV_COOKIE } from "@/lib/navMemory";
import { GUIDE_VIEW_COOKIE } from "@/lib/orderGuide";
import { PO_VIEW_COOKIE } from "@/lib/poFilters";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The remembered guide view, PO list view and menu are per-session state,
  // not per-user config — the next person to sign in on this machine should
  // start from the defaults.
  const jar = await cookies();
  jar.delete(GUIDE_VIEW_COOKIE);
  jar.delete(PO_VIEW_COOKIE);
  jar.delete(NAV_COOKIE);
  redirect("/login");
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
