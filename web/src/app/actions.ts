"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Persist the active location per user (spec §0 / rule 3). */
export async function setActiveLocation(locationId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { error } = await supabase
    .from("org_members")
    .update({ last_active_location_id: locationId })
    .eq("user_id", user.id);

  if (error) throw error;

  revalidatePath("/", "layout");
}
