import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { VENDOR_ITEM_SELECT } from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { staleBucket } from "@/lib/lastOrdered";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { VendorLocationsTable } from "@/components/catalog/VendorLocationsTable";
import {
  VendorItemsTable,
  type VendorItemWithItem,
} from "@/components/catalog/VendorItemsTable";

type VendorLocationRow = {
  id: string;
  location_id: string;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
  sales_rep: string | null;
  rep_phone: string | null;
  rep_email: string | null;
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: string | null;
  order_type: string;
  url: string | null;
  is_active: boolean;
  vendor_locations: VendorLocationRow[];
};

/**
 * The vendor detail's whole body, shared by the dedicated page and the
 * app-wide slide-over panel (the intercepting route). Breadcrumbs only make
 * sense on the full page — the panel floats over wherever you already are.
 */
export async function VendorDetail({
  id,
  rawParams,
  inPanel = false,
}: {
  id: string;
  rawParams: RawSearchParams;
  inPanel?: boolean;
}) {
  // The trail follows the route actually taken (the list's filters ride along
  // inside the recorded href), falling back to the section for a pasted URL.
  const trail = parseTrail(rawParams, { href: "/vendors", label: "Vendors" });
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  // Every location's config is listed (not just the active one) — the vendor's
  // account number and minimum differ per shop, and seeing them together is the
  // point of the detail screen.
  const [{ data: vendor, error }, { data: vendorItems, error: viError }] =
    await Promise.all([
      supabase
        .from("vendors")
        .select(
          `id, name, vendor_type, order_type, url, is_active,
           vendor_locations ( id, location_id, account_number, minimum_order,
                              order_days, delivery_days, is_active,
                              sales_rep, rep_phone, rep_email )`
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("vendor_items")
        .select(`${VENDOR_ITEM_SELECT}, inventory_items ( id, name, base_unit, category )`)
        .eq("vendor_id", id)
        .order("is_active", { ascending: false })
        .order("description"),
    ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load vendor: {error.message}</p>;
  }
  if (!vendor) notFound();

  const v = vendor as unknown as Vendor;
  const items = (vendorItems ?? []) as unknown as VendorItemWithItem[];

  // Last-ordered for the age filter. Semantics match the Inventory list: when
  // the linked ITEM was last ordered at the active location, from any vendor —
  // not "last ordered from this vendor", which would need a per-vendor-item
  // view. Bounded to this vendor's items so it stays two small queries.
  const itemIds = [
    ...new Set(items.map((vi) => vi.inventory_items?.id).filter((x): x is string => !!x)),
  ];
  const lastOrderedByItem = new Map<string, string | null>();

  if (session.activeLocation && itemIds.length > 0) {
    const { data: locationRows } = await supabase
      .from("inventory_item_locations")
      .select("id, inventory_item_id")
      .eq("location_id", session.activeLocation.id)
      .in("inventory_item_id", itemIds);

    const itemByLocationRow = new Map(
      (locationRows ?? []).map((r) => [r.id, r.inventory_item_id])
    );

    if (itemByLocationRow.size > 0) {
      const { data: lastOrdered, error: loError } = await supabase
        .from("v_item_last_ordered")
        .select("item_location_id, last_order_date")
        .in("item_location_id", [...itemByLocationRow.keys()]);

      if (loError) {
        console.warn("v_item_last_ordered unavailable:", loError.message);
      } else {
        for (const row of lastOrdered ?? []) {
          const itemId = itemByLocationRow.get(row.item_location_id);
          if (itemId) lastOrderedByItem.set(itemId, row.last_order_date);
        }
      }
    }
  }

  const today = new Date();
  const itemsWithAge: VendorItemWithItem[] = items.map((vi) => {
    const last = vi.inventory_items ? lastOrderedByItem.get(vi.inventory_items.id) ?? null : null;
    return { ...vi, last_order_date: last, stale: staleBucket(last, today) };
  });
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  // Links out of this page come back here, with the trail so far intact.
  const here = { href: `/vendors/${id}${queryString}`, label: v.name };

  return (
    <div className="space-y-6">
      {!inPanel && <Breadcrumbs trail={trail} current={v.name} />}

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">{v.name}</h1>
        <span className="text-sm text-subtle">
          {v.vendor_type ?? "—"} · orders via {v.order_type}
          {v.is_active ? "" : " · inactive"}
        </span>
        {v.url && (
          <a
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            website
          </a>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Per-location config
        </h2>
        <VendorLocationsTable
          rows={v.vendor_locations}
          codeById={Object.fromEntries(codeById)}
          activeLocationId={session.activeLocation?.id ?? null}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Vendor items{" "}
          <span className="font-normal normal-case tracking-normal text-faint">
            {vendorItems?.length ?? 0}
          </span>
        </h2>
        {viError ? (
          <p className="text-sm text-accent">
            Could not load vendor items: {viError.message}
          </p>
        ) : (
          <VendorItemsTable
            vendorItems={itemsWithAge}
            showItem
            scroll
            from={here}
            filters
            showLastOrdered={session.activeLocation !== null}
          />
        )}
      </section>
    </div>
  );
}
