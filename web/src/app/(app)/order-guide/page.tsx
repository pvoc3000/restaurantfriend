import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import {
  guideToday,
  parseGuideView,
  serverTimeZone,
  GUIDE_VIEW_COOKIE,
  type GuideEntry,
  type GuideRow,
} from "@/lib/orderGuide";
import { OrderGuide } from "@/components/purchasing/OrderGuide";

const SELECT = `
  item_location_id, inventory_item_id, item_name, category, base_unit,
  shop_section, shop_section_sort, par_qty, par_mode,
  vendor_item_id, vendor_id, vendor_name, vendor_order_type,
  brand, vendor_item_description, product_id, package_desc, package_content,
  pack_count, pack_size, pack_unit,
  effective_price, unit_price, vendor_minimum, vendor_delivery_days,
  is_orderable, hidden_reason,
  should_order, is_favorite, vendor_order_days, item_order_days, favorite_days
`;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function OrderGuidePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();

  if (!session.activeLocation) {
    return <p className="text-sm text-neutral-600">Pick a location to open its guide.</p>;
  }

  const locationId = session.activeLocation.id;

  // Date and weekday both come from the org's timezone so they can't disagree
  // (see guideToday). The weekday picks WHICH day's work to show; the date is
  // when you walked it, and is what entries are recorded against.
  const { data: org } = await supabase
    .from("orgs")
    .select("settings")
    .eq("id", session.membership.org_id)
    .maybeSingle();

  const timeZone =
    (org?.settings as { timezone?: string } | null)?.timezone ?? serverTimeZone();
  const { date: guideDate, weekday: todayWeekday } = guideToday(timeZone);

  // How you left the guide last time, from the session cookie — so coming back
  // via the nav link doesn't reset the day, filter and grouping you'd set
  // (Mark, 2026-07-23). Read on the server so the first paint is already right.
  const view = parseGuideView((await cookies()).get(GUIDE_VIEW_COOKIE)?.value);

  // Precedence: an explicit ?day= (a shared link, or the panel's back-trail)
  // beats the remembered day, which beats today. The guide exists every day, so
  // a day with no should-order lines just renders quiet.
  const requested = Number(one(params.day));
  const weekday =
    requested >= 1 && requested <= 7 ? requested : (view.weekday ?? todayWeekday);

  // Membership is the view's job now: one line per orderable vendor item ×
  // inventory item at this location, plan row or not. The old hand-rolled
  // merge of "plan rows plus their alternates" is gone with it.
  const rows: GuideRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("v_order_guide")
      .select(SELECT)
      .eq("location_id", locationId)
      .eq("weekday", weekday)
      // The guide shows ONLY what can actually be ordered (Mark, 2026-07-22).
      // `is_orderable` is the view's composed active cascade, so one filter
      // covers every way a line can be dead.
      //
      // Deliberate departure from spec §4.7a, which asked for blocked lines
      // shown greyed with the reason. That belongs on the catalog screens,
      // where you can act on it; during a walk it's noise. `/cleanup` remains
      // where dead pairings get found and fixed.
      .eq("is_orderable", true)
      .order("shop_section_sort")
      .order("item_name")
      .range(from, from + 999);

    if (error) {
      return (
        <p className="text-sm text-red-700">Could not load the guide: {error.message}</p>
      );
    }
    rows.push(...((data ?? []) as unknown as GuideRow[]));
    if (!data || data.length < 1000) break;
  }

  const { data: entryRows } = await supabase
    .from("order_guide_entries")
    .select("vendor_item_id, on_hand, qty_to_order")
    .eq("location_id", locationId)
    .eq("guide_date", guideDate);

  return (
    <OrderGuide
      rows={rows}
      entries={(entryRows ?? []) as GuideEntry[]}
      weekday={weekday}
      initialFilter={view.filter}
      initialGrouping={view.grouping}
      initialIgnoreDays={view.ignoreDays}
      guideDate={guideDate}
      locationId={locationId}
      locationCode={session.activeLocation.code}
      orgId={session.membership.org_id}
      canGeneratePos={["owner", "admin", "purchaser"].includes(
        session.membership.role
      )}
    />
  );
}
