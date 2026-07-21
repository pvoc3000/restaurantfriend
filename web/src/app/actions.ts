"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
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
