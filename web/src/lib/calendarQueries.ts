// The calendar's reads. Each layer is one query bounded by the days on screen;
// `lib/calendar` turns the rows into items.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CALENDAR_ENTRY_SELECT, type CalendarEntry } from "./blackoutDates";

type Row = Record<string, unknown>;

function toEntry(r: Row): CalendarEntry {
  return {
    id: r.id as string,
    title: r.title as string,
    starts_on: r.starts_on as string,
    ends_on: r.ends_on as string,
    location_ids: (r.location_ids ?? []) as string[],
    no_special_orders: Boolean(r.no_special_orders),
    no_standing_orders: Boolean(r.no_standing_orders),
    no_production: Boolean(r.no_production),
    shop_closed: Boolean(r.shop_closed),
    note: (r.note ?? null) as string | null,
  };
}

/**
 * The typed entries that touch `from`…`to`, either end optional.
 *
 * An entry OVERLAPS the window when it ends on or after `from` and starts on or
 * before `to` — not "starts inside it", which would lose a two-week closure
 * that began last month. Ordered, as every read here is, so the first entry to
 * cover a day is the same one `blackout_name` (181) names.
 */
export async function fetchEntries(
  supabase: SupabaseClient,
  window: { from?: string | null; to?: string | null } = {},
): Promise<{ entries: CalendarEntry[]; error: string | null }> {
  let query = supabase.from("calendar_entries").select(CALENDAR_ENTRY_SELECT);
  if (window.from) query = query.gte("ends_on", window.from);
  if (window.to) query = query.lte("starts_on", window.to);
  const { data, error } = await query.order("starts_on").order("created_at").limit(1000);
  if (error) return { entries: [], error: error.message };
  return { entries: ((data ?? []) as Row[]).map(toEntry), error: null };
}
