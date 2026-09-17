import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canResolveRequests, canWriteCatalog } from "@/lib/roles";
import type { RawSearchParams } from "@/lib/itemFilters";
import {
  guideToday,
  parseGuideDate,
  weekdayOf,
  parseGuideView,
  serverTimeZone,
  GUIDE_VIEW_COOKIE,
  type GuideEntry,
  type GuideRow,
  type LastPurchase,
} from "@/lib/orderGuide";
import { fetchDueReminders, fetchOpenRequests } from "@/lib/guideBands";
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

/** Only what the item header renders — see the note on SELECT above. */
const LAST_PURCHASE_SELECT = `
  item_location_id, last_order_date, vendor_item_id, vendor_name,
  vendor_item_description, brand, package_desc, package_content,
  pack_count, pack_size, pack_unit
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

  // Today comes from the ORG's timezone so an evening walk isn't filed under
  // tomorrow (see guideToday).
  // Comes with the session now (one embedded jsonb column on the membership
  // query) rather than its own round trip.
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const { date: today } = guideToday(timeZone);

  // WHICH DAY'S WALK. Today unless `?date=` says otherwise — see
  // parseGuideDate, which refuses the future and anything that doesn't
  // round-trip. This used to be today and nothing else, which is why an
  // unfinished walk read as having been thrown away at midnight: the entries
  // were always still there, the page just stopped asking for them.
  const guideDate = parseGuideDate(one(params.date), today);

  // How you left the guide last time, from the session cookie — so coming back
  // via the nav link doesn't reset the day, filter and grouping you'd set
  // (Mark, 2026-07-23). Read on the server so the first paint is already right.
  const view = parseGuideView((await cookies()).get(GUIDE_VIEW_COOKIE)?.value);

  // DERIVED, never chosen (Mark, 2026-08-25). The weekday is what scopes the
  // list — order days, favorites, par — and it is simply the day the walked
  // date falls on. There is no `?day=` any more: two controls for one idea let
  // you read Friday's list while writing Tuesday's numbers.
  const weekday = weekdayOf(guideDate);

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

  // Due reminders (spec §2 step 1) and what the shop has asked for — the
  // header's two bands (lib/guideBands, shared with the desk Start page). On
  // the wire alongside the entries: both are free next to the guide's ~850ms.
  const remindersPromise = fetchDueReminders(supabase, locationId, guideDate);
  const requestsPromise = fetchOpenRequests(supabase, locationId);

  /**
   * WHEN THIS ITEM WAS LAST BOUGHT, AND AS WHAT (Mark, 2026-08-10) — migration
   * 048's view, one row per item-location at this location.
   *
   * On the wire with the entries and reminders for the same reason: it doesn't
   * depend on the guide rows and the guide query is ~850ms, so overlapped it
   * costs nothing on the clock. ~450 rows at DF01, against the guide's 875.
   *
   * `.then()` is what puts it on the wire — a Supabase query builder is a lazy
   * thenable and assigning it sends nothing.
   */
  const lastPurchasePromise = supabase
    .from("v_item_last_purchase")
    .select(LAST_PURCHASE_SELECT)
    .eq("location_id", locationId)
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
      // where you can act on it; during a walk it's noise.
      .eq("is_orderable", true)
      // shop_section_sort is the AREA number and is shared by every shelf in
      // that area, so it needs the section name after it to be a total order —
      // same tiebreak groupGuide applies (see lib/orderGuide.ts).
      .order("shop_section_sort")
      .order("shop_section")
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
  const reminders = await remindersPromise;
  /**
   * A MISSING VIEW MUST NOT TAKE THE GUIDE DOWN. Until 048 is applied this
   * errors, and the guide is the screen the shop is walked on — so the rows,
   * the quantities and the totals all still render and only the last-purchase
   * line is absent.
   *
   * But it isn't swallowed either: an absent line and "never bought" look
   * identical, so the header would quietly assert something false about every
   * item. The error rides through to a single muted note under the title,
   * which disappears the moment the migration lands.
   */
  const { data: lastPurchaseRows, error: lastPurchaseError } =
    await lastPurchasePromise;

  const requests = await requestsPromise;

  return (
    <OrderGuide
      // Remount when the guide's identity changes. Switching location is a
      // navigation to the SAME route, so React keeps the component instance
      // alive and `useState(() => …initialEntries)` — an initialiser that runs
      // once per mount — silently keeps the previous location's quantities.
      // The guide then showed DF01's numbers against DF02's lines and totalled
      // them in the vendor bar (writes went to the right place; only the
      // display lied). Keying on the pair is cheaper than syncing state in an
      // effect, and it drops the per-item expansions too, which is what we
      // want anyway.
      key={`${locationId}:${guideDate}`}
      rows={rows}
      lastPurchases={(lastPurchaseRows ?? []) as unknown as LastPurchase[]}
      lastPurchaseError={lastPurchaseError?.message ?? null}
      entries={(entryRows ?? []) as GuideEntry[]}
      reminders={reminders}
      weekday={weekday}
      initialFilter={view.filter}
      initialGrouping={view.grouping}
      initialIgnoreDays={view.ignoreDays}
      initialVendors={view.vendors}
      initialTerm={view.term}
      guideDate={guideDate}
      today={today}
      locationId={locationId}
      locationCode={session.activeLocation.code}
      requests={requests}
      userId={session.userId}
      orgId={session.membership.org_id}
      canGeneratePos={canWriteCatalog(session.membership.role)}
      canResolveRequests={canResolveRequests(session.membership.role)}
    />
  );
}
