// THE ORDER GUIDE'S TWO HEADER BANDS — due reminders and open purchase
// requests — as QUERIES, shared by the guide and the desk Start page (Mark,
// 2026-09-17: "add the order guide's reminders and purchase requests to it").
// One place, so the two screens cannot disagree about what is due or open.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GuideRequest } from "@/components/purchasing/GuideRequests";

import { REMINDER_SELECT, type Reminder } from "./reminders";

/**
 * Reminders due at this location on or before `date`, not yet dismissed.
 *
 * `lte` rather than `eq`: a reminder set for a day nobody walked must not
 * expire unseen. It stays up until it's dismissed, which is what makes it a
 * reminder rather than a notification. Migration 018's partial index is this
 * query's shape.
 */
export async function fetchDueReminders(
  supabase: SupabaseClient,
  locationId: string,
  date: string
): Promise<Reminder[]> {
  const { data } = await supabase
    .from("purchase_reminders")
    .select(REMINDER_SELECT)
    .eq("location_id", locationId)
    .lte("show_on_date", date)
    .is("dismissed_at", null)
    .order("show_on_date");
  return (data ?? []) as unknown as Reminder[];
}

/**
 * WHAT THIS SHOP HAS ASKED FOR, with who asked.
 *
 * The item name comes through an EMBED (one round trip over a handful of rows;
 * the FK makes it to-ONE, so `inventory_items` arrives as an object). WHO
 * ASKED comes from `org_members`, because `requested_by` points at
 * `auth.users` and there is no FK to embed through — and it must not be
 * filtered to the current user: `members_read` shows every member of your org,
 * and the whole point is the OTHER people's names.
 *
 * A failure is swallowed into an empty list: an absent band reads as nothing
 * outstanding, which is what a screen that could not ask would say anyway, and
 * the band is not worth taking the guide down for.
 */
export async function fetchOpenRequests(
  supabase: SupabaseClient,
  locationId: string
): Promise<GuideRequest[]> {
  const [{ data: requestRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select(
        "id, request_text, details, priority, requested_by, inventory_item_id, inventory_items ( name )"
      )
      .eq("location_id", locationId)
      .eq("status", "open")
      .order("created_at"),
    supabase.from("org_members").select("user_id, display_name"),
  ]);

  const memberName = new Map(
    (memberRows ?? []).map((m) => [
      m.user_id as string,
      (m.display_name as string | null) ?? null,
    ])
  );

  return (requestRows ?? []).map((r) => {
    // Typed defensively: PostgREST hands back an array the moment somebody
    // widens the relationship, and a silent `undefined` would drop the name.
    const item = r.inventory_items as { name?: string } | { name?: string }[] | null;
    const named = Array.isArray(item) ? item[0] : item;
    return {
      id: r.id as string,
      request_text: r.request_text as string,
      details: (r.details as string | null) ?? null,
      priority: (r.priority as GuideRequest["priority"]) ?? "normal",
      requested_by: (r.requested_by as string | null) ?? null,
      // Null rather than a stand-in word: a band row is a sentence, and an
      // unknown name is better left off than padded out.
      requesterName: r.requested_by
        ? (memberName.get(r.requested_by as string) ?? null)
        : null,
      inventory_item_id: (r.inventory_item_id as string | null) ?? null,
      itemName: named?.name ?? null,
    };
  });
}
