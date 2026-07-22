"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/session";
import { money, unitPriceLabel, vendorItemLabel, type CatalogItemLocation } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { FavoritesEditor } from "@/components/cleanup/FavoritesEditor";

// One row per location, whether or not the item is stocked there — an item
// missing from a shop is a fact worth seeing, and it's where "Stock here" goes.
type Row = { location: Location; il: CatalogItemLocation | null };

/**
 * One row per location so the shops' differences are visible side by side: par,
 * shop section, the default vendor item, and the weekday favorites grid behind
 * the row's disclosure.
 *
 * The favorites editor is the existing cleanup component reused as-is — same
 * grid, now reachable for healthy items too, which was the gap brief §D names.
 */
export function ItemLocationRows({
  rows,
  locations,
  inventoryItemId,
  baseUnit,
  orgId,
  activeLocationId,
}: {
  rows: CatalogItemLocation[];
  locations: Location[];
  inventoryItemId: string;
  baseUnit: string;
  orgId: string;
  activeLocationId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byLocation = new Map(rows.map((r) => [r.location_id, r]));
  const tableRows: Row[] = locations.map((location) => ({
    location,
    il: byLocation.get(location.id) ?? null,
  }));

  // Locations where this item isn't stocked yet get a one-click "Stock here",
  // which is how a new location's catalog gets seeded item by item.
  async function stockHere(locationId: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("inventory_item_locations").insert({
      org_id: orgId,
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  const dash = <span className="text-neutral-400">—</span>;

  const columns: DataColumn<Row>[] = [
    {
      key: "location",
      label: "Location",
      width: 190,
      sortValue: (r) => r.location.code,
      render: (r) => (
        <>
          {r.location.code}
          {r.location.id === activeLocationId && (
            <span className="ml-1.5 rounded bg-blue-100 px-1 text-xs text-blue-800">
              here
            </span>
          )}
        </>
      ),
    },
    {
      key: "section",
      label: "Section",
      width: 170,
      sortValue: (r) => r.il?.shop_sections?.sort_order ?? null,
      render: (r) =>
        r.il ? (
          <span className="text-neutral-600">{r.il.shop_sections?.display_name ?? "—"}</span>
        ) : (
          dash
        ),
    },
    {
      key: "par",
      label: `Par (${baseUnit})`,
      width: 100,
      align: "right",
      sortValue: (r) =>
        r.il?.default_par === null || r.il?.default_par === undefined
          ? null
          : Number(r.il.default_par),
      render: (r) =>
        r.il ? (
          <InlineValue
            table="inventory_item_locations"
            id={r.il.id}
            column="default_par"
            value={r.il.default_par}
            kind="number"
            align="right"
          />
        ) : (
          dash
        ),
    },
    {
      key: "vendor_item",
      label: "Default vendor item",
      width: 300,
      sortValue: (r) => r.il?.vendor_items?.vendors?.name ?? null,
      render: (r) => {
        if (!r.il) return dash;
        const vi = r.il.vendor_items;
        if (!vi) return <span className="text-neutral-400">none</span>;
        return (
          <span className="text-neutral-600">
            <span className="font-medium text-neutral-700">{vi.vendors?.name ?? "—"}</span>{" "}
            {vendorItemLabel(vi)}
            {vi.package_desc ? (
              <span className="text-neutral-500"> · {vi.package_desc}</span>
            ) : null}
            <span className="ml-1 text-xs text-neutral-500">
              {unitPriceLabel(vi, baseUnit)}
            </span>
          </span>
        );
      },
    },
    {
      key: "price",
      label: "Price",
      width: 90,
      align: "right",
      sortValue: (r) =>
        r.il?.vendor_items?.price === null || r.il?.vendor_items?.price === undefined
          ? null
          : Number(r.il.vendor_items.price),
      render: (r) =>
        r.il?.vendor_items ? (
          <span className="text-neutral-600">{money(r.il.vendor_items.price)}</span>
        ) : (
          dash
        ),
    },
    {
      key: "note",
      label: "Note",
      width: 140,
      sortValue: (r) => r.il?.note ?? null,
      render: (r) =>
        r.il ? (
          <InlineValue
            table="inventory_item_locations"
            id={r.il.id}
            column="note"
            value={r.il.note}
          />
        ) : (
          dash
        ),
    },
    {
      key: "is_active",
      label: "Active",
      width: 110,
      sortValue: (r) => (r.il ? (r.il.is_active ? 0 : 1) : 2),
      render: (r) =>
        r.il ? (
          <ActiveToggle
            table="inventory_item_locations"
            id={r.il.id}
            active={r.il.is_active}
            label={`Item active at ${r.location.code}`}
          />
        ) : (
          <button
            disabled={busy}
            onClick={() => stockHere(r.location.id)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            Stock here
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700">{error}</p>}

      <DataTable
        rows={tableRows}
        columns={columns}
        rowKey={(r) => r.location.id}
        storageKey="rf.itemLocations.columnWidths.v1"
        defaultSort={{ key: "location" }}
        rowClassName={(r) => (r.il && !r.il.is_active ? "text-neutral-400" : "")}
        expand={{
          // Only stocked locations have plan rows to favorite.
          canExpand: (r) => r.il !== null,
          summary: (r) => (r.il ? null : "not stocked here"),
          render: (r) =>
            r.il ? (
              <FavoritesEditor
                itemLocationId={r.il.id}
                inventoryItemId={inventoryItemId}
                orgId={orgId}
                onChanged={() => router.refresh()}
              />
            ) : null,
        }}
      />
    </div>
  );
}
