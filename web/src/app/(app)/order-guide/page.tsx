import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import { guideToday, serverTimeZone, type GuideEntry, type GuideRow } from "@/lib/orderGuide";
import { OrderGuide } from "@/components/purchasing/OrderGuide";

const SELECT = `
  item_location_id, inventory_item_id, item_name, category, base_unit,
  shop_section, shop_section_sort, par_qty, par_mode,
  vendor_item_id, vendor_id, vendor_name, vendor_order_type,
  brand, vendor_item_description, product_id, package_desc, package_content,
  effective_price, unit_price, vendor_minimum, vendor_delivery_days,
  is_orderable, hidden_reason
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

  // Which weekdays this location actually has a plan for. All ordering happens
  // Monday today (§4.4), so the day dimension exists but must never make you
  // think about days you don't use — default to a day that has rows.
  const { data: planDays } = await supabase
    .from("order_guide_plan_days")
    .select("weekday, inventory_item_locations!inner(location_id)")
    .eq("inventory_item_locations.location_id", locationId)
    .limit(2000);

  const availableDays = [...new Set((planDays ?? []).map((d) => d.weekday))].sort(
    (a, b) => a - b
  );

  // Date and weekday both come from the org's timezone so they can't disagree
  // (see guideToday). The weekday picks WHICH plan to walk; the date is when
  // you walked it, and is what entries are recorded against.
  const { data: org } = await supabase
    .from("orgs")
    .select("settings")
    .eq("id", session.membership.org_id)
    .maybeSingle();

  const timeZone =
    (org?.settings as { timezone?: string } | null)?.timezone ?? serverTimeZone();
  const { date: guideDate, weekday: todayWeekday } = guideToday(timeZone);

  const requested = Number(one(params.day));
  const weekday =
    requested >= 1 && requested <= 7
      ? requested
      : availableDays.includes(todayWeekday)
        ? todayWeekday
        : availableDays[0] ?? todayWeekday;

  const rows: GuideRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("v_order_guide")
      .select(SELECT)
      .eq("location_id", locationId)
      .eq("weekday", weekday)
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

  // The guide shows ONLY what can actually be ordered (Mark, 2026-07-22).
  // `is_orderable` is the view's composed active cascade — vendor AND vendor
  // item AND inventory item AND item-location all active — so one flag covers
  // every way a line can be dead, including a plan row whose vendor item no
  // longer resolves at all.
  //
  // Deliberate departure from spec §4.7a, which asked for blocked lines shown
  // greyed with the reason. That belongs on the catalog screens, where you can
  // act on it; during a walk it's noise. `/cleanup` remains where dead pairings
  // get found and fixed.
  const orderableRows = rows.filter((row) => row.is_orderable === true);

  const { data: entryRows } = await supabase
    .from("order_guide_entries")
    .select("vendor_item_id, on_hand, qty_to_order")
    .eq("location_id", locationId)
    .eq("guide_date", guideDate);

  return (
    <OrderGuide
      rows={orderableRows}
      entries={(entryRows ?? []) as GuideEntry[]}
      weekday={weekday}
      availableDays={availableDays}
      guideDate={guideDate}
      locationId={locationId}
      locationCode={session.activeLocation.code}
      orgId={session.membership.org_id}
    />
  );
}
