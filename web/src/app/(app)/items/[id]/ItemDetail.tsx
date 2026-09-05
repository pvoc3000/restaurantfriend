import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import {
  VENDOR_ITEM_SELECT_ACTIVE_VENDOR,
  type CatalogItem,
  type CatalogVendorItem,
} from "@/lib/catalog";
import type { RawSearchParams } from "@/lib/itemFilters";
import { crumbPath, currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { ItemFields, ItemTitle } from "@/components/catalog/ItemFields";
import { ItemLocationRows } from "@/components/catalog/ItemLocationRows";
import { VendorItemsTable } from "@/components/catalog/VendorItemsTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { canEditPage } from "@/lib/pageAccess";
import {
  ITEM_PURCHASE_CAP,
  ITEM_TABS,
  ITEM_TAB_LABEL,
  itemTabHref,
  parseItemTab,
} from "@/lib/inventoryItems";
import {
  ItemPurchaseHistory,
  type ItemPurchaseRow,
} from "@/components/catalog/ItemPurchaseHistory";
import type { PoStatus } from "@/lib/purchaseOrders";

// Item detail is per-ITEM, not per-location: every location's row is listed so
// the differences between shops are visible in one place (spec §4.8 — the
// desktop tab Mark used to duplicate config from).
const SELECT = `
  id, name, category, base_unit, note, is_active,
  inventory_item_locations (
    id, location_id, default_par, order_days, note, is_active,
    shop_section_id,
    shop_sections ( display_name, sort_order )
  )
`;

/**
 * The item detail's whole body. Its own full-screen page (Mark, 2026-07-30 —
 * detail views were slide-overs for a week and are pages again); the body
 * stays split out from the page shell so the two are easy to tell apart.
 */
export async function ItemDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  // The trail follows the route actually taken — reaching this item from a
  // vendor's item list must lead back to that vendor, not to the Inventory list.
  const trail = parseTrail(rawParams, { href: "/items", label: "Inventory" });
  const queryString = currentQuery(rawParams);
  const session = await getAppSession();
  const supabase = await createClient();

  // WHICH TAB, and therefore WHAT TO FETCH — the vendor record's split. Info
  // stops paying for the vendor items; Vendor Items stops paying for the
  // category and shelf lists only Info's pickers read; and the history is a
  // walk over purchase_order_items that only its own tab should ever pay for.
  const tab = parseItemTab(rawParams.tab);
  const SKIP = { data: null, error: null, count: null };
  const wantsInfo = tab === "info";
  const wantsVendorItems = tab === "vendor-items";
  const wantsHistory = tab === "purchase-history";

  const [
    { data: item, error },
    { data: vendorItems, error: viError },
    { data: categoryRows },
    { data: sectionRows },
    { data: sourceRows, error: sourceError },
  ] = await Promise.all([
      supabase.from("inventory_items").select(SELECT).eq("id", id).maybeSingle(),
      // Deactivated vendors are gone from this screen entirely — you can't
      // order from them, so their items are noise here. An individually
      // inactive item under an ACTIVE vendor still shows, dimmed and toggleable.
      wantsVendorItems
        ? supabase
            .from("vendor_items")
            .select(VENDOR_ITEM_SELECT_ACTIVE_VENDOR)
            .eq("inventory_item_id", id)
            .eq("vendors.is_active", true)
            .order("is_active", { ascending: false })
        : SKIP,
      // What the Category picker offers. One column over the catalog, fired
      // alongside the other two rather than after them, so it costs no round
      // trip of its own — there's no `distinct` in PostgREST, and 790 short
      // strings is cheaper than the view of them would be.
      wantsInfo ? supabase.from("inventory_items").select("category") : SKIP,
      // Every shelf at every shop this screen lists a row for, so the Section
      // picker on each row offers THAT shop's shelves. One query for all of
      // them rather than one per row, and in WALK order — which is the order
      // you think about shelves in, and not the order their names sort in.
      wantsInfo
        ? supabase
            .from("shop_sections")
            .select("id, location_id, display_name, sort_order")
            .in(
              "location_id",
              session.activeLocations.map((l) => l.id)
            )
            .order("sort_order")
            .order("display_name")
        : SKIP,
      // EVERY vendor item this item has ever been bought as — inactive ones and
      // retired vendors included, because history is history. A PO line reaches
      // its inventory item only through this link (013 snapshots the rest).
      wantsHistory
        ? supabase.from("vendor_items").select("id").eq("inventory_item_id", id)
        : SKIP,
    ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load item: {error.message}</p>;
  }
  if (!item) notFound();

  const row = item as unknown as CatalogItem;

  const categories = [
    ...new Set(
      ((categoryRows ?? []) as { category: string | null }[])
        .map((r) => r.category)
        .filter((c): c is string => c !== null && c !== "")
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Keyed by location, because each row of the table is a different shop and a
  // shelf belongs to exactly one of them — offering DF01's shelves on DF02's
  // row would write a section the guide there can never group by.
  // A plain object, not a Map: this crosses into a client component.
  const sectionsByLocation: Record<string, { value: string; label: string }[]> = {};
  for (const s of (sectionRows ?? []) as {
    id: string;
    location_id: string;
    display_name: string;
  }[]) {
    (sectionsByLocation[s.location_id] ??= []).push({
      value: s.id,
      label: s.display_name,
    });
  }

  // The Page Permissions sheet: a supervisor READS an item; staff are hidden.
  const editable = canEditPage(session.membership.role, "/items");

  // ---- the Purchase History tab's rows -----------------------------------
  // Received lines only (Mark: "filtered where received qty > 0"), on any
  // order that isn't void, AT THE WORKING SHOP (Mark, 2026-09-05: "scope the
  // purchase history to the current working location") — which is design
  // rule 3's ordinary reading and the OPPOSITE of the vendor record's two
  // tabs, deliberately: a vendor is one account across shops, where what a
  // shop paid for its flour is a fact about that shop. `!inner` makes the
  // location test a FILTER on the rows rather than a null on the embed.
  // Fetched WHOLE on a unique order and paginated —
  // PostgREST caps a page at 1000 and says nothing, and a flour can run to a
  // couple of thousand lines over the history — then sorted newest first and
  // capped in memory, because the sort key lives on the PARENT row and
  // PostgREST cannot order a top-level select by an embedded column.
  let history: ItemPurchaseRow[] = [];
  let historyCapped = false;
  let historyError: string | null = sourceError?.message ?? null;
  const sourceIds = ((sourceRows ?? []) as { id: string }[]).map((r) => r.id);
  const historyLocation = session.activeLocation;
  if (wantsHistory && !historyError && sourceIds.length > 0 && historyLocation) {
    type LineRow = {
      id: string;
      po_id: string;
      description: string | null;
      brand: string | null;
      package_desc: string | null;
      qty_ordered: number | string;
      qty_received: number | string;
      unit_price: number | string | null;
      purchase_orders: {
        po_number: string;
        order_date: string;
        status: PoStatus;
        location_id: string;
        vendors: { name: string } | null;
      } | null;
    };
    const lines: LineRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: lineError } = await supabase
        .from("purchase_order_items")
        .select(
          `id, po_id, description, brand, package_desc, qty_ordered, qty_received, unit_price,
           purchase_orders!inner ( po_number, order_date, status, location_id, vendors ( name ) )`
        )
        .in("vendor_item_id", sourceIds)
        .eq("purchase_orders.location_id", historyLocation.id)
        .gt("qty_received", 0)
        .order("id")
        .range(from, from + 999);
      if (lineError) {
        historyError = lineError.message;
        break;
      }
      lines.push(...((data ?? []) as unknown as LineRow[]));
      if (!data || data.length < 1000) break;
    }
    const all = lines
      .filter((l) => l.purchase_orders && l.purchase_orders.status !== "void")
      .map((l) => {
        const po = l.purchase_orders!;
        return {
          id: l.id,
          po_id: l.po_id,
          po_number: po.po_number,
          order_date: po.order_date,
          vendor_name: po.vendors?.name ?? null,
          description: l.description,
          brand: l.brand,
          package_desc: l.package_desc,
          qty_ordered: Number(l.qty_ordered),
          qty_received: Number(l.qty_received),
          unit_price: l.unit_price === null ? null : Number(l.unit_price),
        };
      })
      .sort((a, b) => (a.order_date < b.order_date ? 1 : a.order_date > b.order_date ? -1 : 0));
    historyCapped = all.length > ITEM_PURCHASE_CAP;
    history = all.slice(0, ITEM_PURCHASE_CAP);
  }

  // Links out of this page come back here, with the trail so far intact.
  const here = { href: `/items/${id}${queryString}`, label: row.name };
  const tabOptions = ITEM_TABS.map((t) => ({
    key: t,
    label: ITEM_TAB_LABEL[t],
    href: itemTabHref(id, t, rawParams),
  }));

  const locationRows = [...row.inventory_item_locations].sort((a, b) => {
    const codeA = session.locations.find((l) => l.id === a.location_id)?.code ?? "";
    const codeB = session.locations.find((l) => l.id === b.location_id)?.code ?? "";
    return codeA.localeCompare(codeB);
  });

  return (
    <div className="space-y-8">
      {/* The book walks the Inventory list's found set — see ui/RecordNav. */}
      <Breadcrumbs
        trail={trail}
        current={row.name}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* The identity block, ABOVE the split and indented to the content
          column — the vendor record's shape, copied rather than re-derived.
          `lg:ml-48` = the sidebar's `lg:w-40` + the row's `lg:gap-8`; the three
          values are coupled. */}
      <div className="lg:ml-48">
        <ItemTitle item={row} editable={editable} />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Two renderings of one control, wrapped rather than switched with a
            responsive `display` utility — see VendorDetail for why. */}
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this record" value={tab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which part of this record"
            value={tab}
            items={tabOptions}
          />
        </div>

        {/* space-y-16, matching vendor detail: with only 8px inside each
            block, the gap BETWEEN them is what says where one ends. */}
        <div className="min-w-0 flex-1 space-y-16">
          {tab === "info" && (
            <>
              <ItemFields item={row} categories={categories} editable={editable} />

              {/* The heading rides in the table's own strip (Mark, 2026-08-02:
                  too much air under each heading, not enough between blocks). */}
              <ItemLocationRows
                // `activeLocations`: this is the "stock here" list, and you
                // don't stock a closed shop. The code lookups above use
                // session.locations, which carries every location.
                leading={<SectionHeading>Per-location config</SectionHeading>}
                rows={locationRows}
                locations={session.activeLocations}
                inventoryItemId={row.id}
                baseUnit={row.base_unit}
                orgId={session.membership.org_id}
                activeLocationId={session.activeLocation?.id ?? null}
                sectionsByLocation={sectionsByLocation}
                editable={editable}
              />
            </>
          )}

          {tab === "vendor-items" &&
            (viError ? (
              <p className="text-sm text-accent">
                Could not load vendor items: {viError.message}
              </p>
            ) : (
              <VendorItemsTable
                heading={
                  <div className="space-y-1">
                    <SectionHeading count={vendorItems?.length ?? 0}>Vendor items</SectionHeading>
                    <p className="text-xs text-subtle">
                      Items from deactivated vendors are hidden. Reactivate the vendor
                      on its detail screen to bring them back.
                    </p>
                  </div>
                }
                vendorItems={(vendorItems ?? []) as unknown as CatalogVendorItem[]}
                baseUnit={row.base_unit}
                showVendor
                from={here}
                canEdit={editable}
              />
            ))}

          {tab === "purchase-history" &&
            (historyError ? (
              <p className="text-sm text-accent">
                Could not load purchase history: {historyError}
              </p>
            ) : (
              <ItemPurchaseHistory
                rows={history}
                from={here}
                capped={historyCapped}
                locationCode={historyLocation?.code ?? null}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
