import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { money } from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  VendorItemFields,
  type VendorItemRecord,
} from "@/components/catalog/VendorItemFields";
import {
  VendorItemLocations,
  type VendorItemLocationRow,
} from "@/components/catalog/VendorItemLocations";

const SELECT = `
  id, brand, description, product_id, package_desc, package_content, price,
  pack_count, pack_size, pack_unit,
  notes, is_active, inventory_item_id,
  vendors ( id, name, is_active ),
  inventory_items ( id, name, base_unit )
`;

type PriceChange = {
  id: string;
  location_id: string | null;
  old_price: number | null;
  new_price: number | null;
  source: string;
  changed_at: string;
};

/**
 * Vendor item detail — the one screen that answers "where is this the source we
 * prefer, and what does it cost there". Everything on it is either per-location
 * (favorite days, price override, last ordered) or historical (price changes),
 * which is exactly what a row in the vendor-items grid has no room to carry.
 *
 * Shared by the dedicated page and the slide-over panel, like ItemDetail and
 * VendorDetail; breadcrumbs are the full page's job.
 */
export async function VendorItemDetail({
  id,
  rawParams,
  inPanel = false,
}: {
  id: string;
  rawParams: RawSearchParams;
  inPanel?: boolean;
}) {
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  const { data: vendorItem, error } = await supabase
    .from("vendor_items")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-accent">Could not load vendor item: {error.message}</p>
    );
  }
  if (!vendorItem) notFound();

  const vi = vendorItem as unknown as VendorItemRecord & {
    inventory_item_id: string | null;
  };

  // Per-location context, in parallel: where the item is stocked, which days
  // this vendor item is the favorite, and any price override.
  const [{ data: itemLocations }, { data: overrides }] = await Promise.all([
    vi.inventory_item_id
      ? supabase
          .from("inventory_item_locations")
          .select("id, location_id, default_par, is_active")
          .eq("inventory_item_id", vi.inventory_item_id)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("vendor_item_location_prices")
      .select("location_id, price")
      .eq("vendor_item_id", id),
  ]);

  const ilRows = (itemLocations ?? []) as {
    id: string;
    location_id: string;
    default_par: number | null;
    is_active: boolean;
  }[];

  const { data: planRows } = await supabase
    .from("order_guide_plan_days")
    .select("item_location_id, weekday")
    .eq("vendor_item_id", id);

  // Last ordered per location, straight off the PO tables — v_last_orders
  // exists (migration 001) but was never granted to `authenticated`, so the
  // app can't read it. Void orders don't count as having been ordered.
  const { data: poLines } = await supabase
    .from("purchase_order_items")
    .select("purchase_orders!inner ( order_date, location_id, status )")
    .eq("vendor_item_id", id)
    .neq("purchase_orders.status", "void")
    .order("purchase_orders(order_date)", { ascending: false })
    .limit(400);

  const lastOrderByLocation = new Map<string, string>();
  for (const line of (poLines ?? []) as unknown as {
    purchase_orders: { order_date: string; location_id: string } | null;
  }[]) {
    const po = line.purchase_orders;
    if (!po) continue;
    // Rows arrive newest-first, so the first hit per location is the answer.
    if (!lastOrderByLocation.has(po.location_id)) {
      lastOrderByLocation.set(po.location_id, po.order_date);
    }
  }

  const { data: history } = await supabase
    .from("price_history")
    .select("id, location_id, old_price, new_price, source, changed_at")
    .eq("vendor_item_id", id)
    .order("changed_at", { ascending: false })
    .limit(10);

  const ilByLocation = new Map(ilRows.map((r) => [r.location_id, r]));
  const overrideByLocation = new Map(
    ((overrides ?? []) as { location_id: string; price: number }[]).map((o) => [
      o.location_id,
      o.price,
    ])
  );
  const favoritesByIl = new Map<string, number[]>();
  for (const p of (planRows ?? []) as { item_location_id: string; weekday: number }[]) {
    const list = favoritesByIl.get(p.item_location_id) ?? [];
    list.push(p.weekday);
    favoritesByIl.set(p.item_location_id, list);
  }

  const locationRows: VendorItemLocationRow[] = session.locations.map((location) => {
    const il = ilByLocation.get(location.id) ?? null;
    return {
      location,
      itemLocationId: il?.id ?? null,
      itemLocationActive: il?.is_active ?? false,
      defaultPar: il?.default_par ?? null,
      favoriteDays: il ? (favoritesByIl.get(il.id) ?? []).sort((a, b) => a - b) : [],
      overridePrice: overrideByLocation.get(location.id) ?? null,
      lastOrderDate: lastOrderByLocation.get(location.id) ?? null,
    };
  });

  const label = vi.description ?? vi.brand ?? "Vendor item";
  // A pasted URL has no trail to follow, so fall back to the owning vendor —
  // the place this row actually lives.
  const trail = parseTrail(
    rawParams,
    vi.vendors
      ? { href: `/vendors/${vi.vendors.id}`, label: vi.vendors.name }
      : { href: "/vendors", label: "Vendors" }
  );
  const here = { href: `/vendor-items/${id}${queryString}`, label };
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  return (
    <div className="space-y-6">
      {!inPanel && <Breadcrumbs trail={trail} current={label} />}

      <VendorItemFields vi={vi} here={here} />

      <section className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Per-location
        </h2>
        <VendorItemLocations
          rows={locationRows}
          vendorItemId={id}
          orgId={session.membership.org_id}
          globalPrice={vi.price}
          activeLocationId={session.activeLocation?.id ?? null}
        />
        <p className="text-xs text-subtle">
          A favorite day marks this as the preferred source for that day&apos;s
          guide. Price overrides are set by receiving; the guide and POs resolve
          override → vendor price.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Price history
        </h2>
        {(history ?? []).length === 0 ? (
          <p className="text-sm text-muted">No recorded price changes.</p>
        ) : (
          <table className="text-sm">
            <tbody>
              {((history ?? []) as PriceChange[]).map((h) => (
                <tr key={h.id} className="border-b border-hairline">
                  <td className="py-1 pr-4 tabular-nums text-subtle">
                    {h.changed_at.slice(0, 10)}
                  </td>
                  <td className="py-1 pr-4 text-muted">
                    {h.location_id ? (codeById.get(h.location_id) ?? "—") : "all locations"}
                  </td>
                  <td className="py-1 pr-4 tabular-nums">
                    {money(h.old_price)} → <strong>{money(h.new_price)}</strong>
                  </td>
                  <td className="py-1 text-xs text-subtle">{h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
