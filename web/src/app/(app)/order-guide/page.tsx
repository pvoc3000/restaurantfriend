import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import type { GuideEntry, GuideRow } from "@/lib/orderGuide";
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

  const today = new Date();
  const todayWeekday = ((today.getDay() + 6) % 7) + 1; // JS Sunday=0 → ISO Mon=1
  const requested = Number(one(params.day));
  const weekday =
    requested >= 1 && requested <= 7
      ? requested
      : availableDays.includes(todayWeekday)
        ? todayWeekday
        : availableDays[0] ?? todayWeekday;

  // The session's date — what entries are recorded against. The weekday picks
  // WHICH plan to walk; the date is when you walked it.
  const guideDate = today.toISOString().slice(0, 10);

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
      availableDays={availableDays}
      guideDate={guideDate}
      locationId={locationId}
      locationCode={session.activeLocation.code}
      orgId={session.membership.org_id}
    />
  );
}
