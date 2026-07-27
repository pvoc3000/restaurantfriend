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

// Every column here crosses the wire 877 times, so the list is exactly what the
// screen reads and nothing else — measured 2026-07-26, the same query costs
// 781ms wide and 284ms with one column, so roughly two thirds of it is payload.
// `is_orderable` / `hidden_reason` are deliberately absent: the query filters
// is_orderable = true, so they'd be a constant and a null on all 877 rows.
const SELECT = `
  item_location_id, inventory_item_id, item_name, category, base_unit,
  shop_section, shop_section_sort, par_qty,
  vendor_item_id, vendor_id, vendor_name,
  brand, vendor_item_description, product_id, package_desc, package_content,
  pack_count, pack_size, pack_unit,
  effective_price, unit_price, vendor_minimum, vendor_delivery_days,
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
    return <p className="text-sm text-muted">Pick a location to open its guide.</p>;
  }

  const locationId = session.activeLocation.id;

  // Date and weekday both come from the org's timezone so they can't disagree
  // (see guideToday). The weekday picks WHICH day's work to show; the date is
  // when you walked it, and is what entries are recorded against.
  // Comes with the session now (one embedded jsonb column on the membership
  // query) rather than its own round trip.
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
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

  // Fired BEFORE the guide rows and awaited after: the two don't depend on each
  // other, and the guide query takes ~850ms, so this one is free.
  // The trailing .then() is load-bearing: a Supabase query builder is a LAZY
  // thenable, so assigning it to a variable sends nothing. Calling .then() is
  // what actually puts the request on the wire now instead of when it's awaited.
  const entriesPromise = supabase
    .from("order_guide_entries")
    .select("vendor_item_id, on_hand, qty_to_order")
    .eq("location_id", locationId)
    .eq("guide_date", guideDate)
    .then((r) => r);

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
        <p className="text-sm text-accent">Could not load the guide: {error.message}</p>
      );
    }
    rows.push(...((data ?? []) as unknown as GuideRow[]));
    if (!data || data.length < 1000) break;
  }

  const { data: entryRows } = await entriesPromise;

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
