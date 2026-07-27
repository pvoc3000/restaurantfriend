"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/session";
import { type CatalogItemLocation } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { WeekdayPicker, WEEKDAY_PICKER_WIDTH } from "./WeekdayPicker";
import { FavoritesEditor } from "@/components/cleanup/FavoritesEditor";

// One row per location, whether or not the item is stocked there — an item
// missing from a shop is a fact worth seeing, and it's where "Stock here" goes.
type Row = { location: Location; il: CatalogItemLocation | null };

/**
 * One row per location so the shops' differences are visible side by side: par,
 * shop section, order days, and the weekday favorites grid behind the row's
 * disclosure.
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

  const dash = <span className="text-faint">—</span>;

  const columns: DataColumn<Row>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23). For a location
    // that doesn't stock the item yet, the same slot holds "Stock here" —
    // both are the row's on/off switch.
    {
      key: "is_active",
      label: "Active",
      width: 130,
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
            className="border border-ink px-2 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Stock here
          </button>
        ),
    },
    {
      key: "location",
      label: "Location",
      width: 230,
      sortValue: (r) => r.location.code,
      render: (r) => (
        <>
          {r.location.code}
          {r.location.id === activeLocationId && (
            <span className="ml-1.5 border border-ink px-1 text-[10px] uppercase tracking-[0.12em] text-ink">
              here
            </span>
          )}
        </>
      ),
    },
    {
      key: "section",
      label: "Section",
      width: 205,
      sortValue: (r) => r.il?.shop_sections?.sort_order ?? null,
      render: (r) =>
        r.il ? (
          <span className="text-muted">{r.il.shop_sections?.display_name ?? "—"}</span>
        ) : (
          dash
        ),
    },
    {
      key: "order_days",
      label: "Order days",
      width: WEEKDAY_PICKER_WIDTH,
      // Sorts on how MANY days it's ordered — "which items do we buy most
      // often here" is the question worth asking of this column.
      sortValue: (r) => (r.il ? r.il.order_days.length : null),
      render: (r) =>
        r.il ? (
          <WeekdayPicker
            table="inventory_item_locations"
            id={r.il.id}
            column="order_days"
            value={r.il.order_days}
            label="Order days"
          />
        ) : (
          dash
        ),
    },
    {
      key: "par",
      label: `Par (${baseUnit})`,
      width: 120,
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
    // "Default vendor item" and its price lived here until migration 012.
    // The guide stopped resolving lines through the default in 008 and the
    // column is gone; which vendor supplies this item at this location is the
    // favorites grid behind the row's disclosure, and the Vendor items section
    // below carries the prices.
    {
      key: "note",
      label: "Note",
      width: 170,
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
  ];

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-accent">{error}</p>}

      <DataTable
        rows={tableRows}
        columns={columns}
        rowKey={(r) => r.location.id}
        storageKey="rf.itemLocations.columnWidths.v1"
        defaultSort={{ key: "location" }}
        rowClassName={(r) => (r.il && !r.il.is_active ? "text-faint" : "")}
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
