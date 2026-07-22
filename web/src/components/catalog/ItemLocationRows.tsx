"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/session";
import { money, unitPriceLabel, vendorItemLabel, type CatalogItemLocation } from "@/lib/catalog";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { FavoritesEditor } from "@/components/cleanup/FavoritesEditor";

/**
 * One row per location so the shops' differences are visible side by side: par,
 * shop section, the default vendor item, and the weekday favorites grid.
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byLocation = new Map(rows.map((r) => [r.location_id, r]));

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

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-600">
              <th className="px-2 py-1 font-medium">Location</th>
              <th className="px-2 py-1 font-medium">Section</th>
              <th className="px-2 py-1 font-medium text-right">Par ({baseUnit})</th>
              <th className="px-2 py-1 font-medium">Default vendor item</th>
              <th className="px-2 py-1 font-medium text-right">Price</th>
              <th className="px-2 py-1 font-medium">Note</th>
              <th className="px-2 py-1 font-medium">Active</th>
              <th className="px-2 py-1 font-medium">Favorites</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((loc) => {
              const il = byLocation.get(loc.id) ?? null;
              const vi = il?.vendor_items ?? null;
              const isOpen = il !== null && expanded === il.id;

              if (!il) {
                return (
                  <tr key={loc.id} className="border-b border-neutral-100 text-neutral-400">
                    <td className="px-2 py-1">
                      {loc.code}
                      {loc.id === activeLocationId && (
                        <span className="ml-1.5 rounded bg-blue-100 px-1 text-xs text-blue-800">
                          here
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1" colSpan={6}>
                      not stocked at this location
                    </td>
                    <td className="px-2 py-1">
                      <button
                        disabled={busy}
                        onClick={() => stockHere(loc.id)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                      >
                        Stock here
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <Fragment key={loc.id}>
                  <tr
                    className={`border-b border-neutral-100 ${
                      il.is_active ? "" : "text-neutral-400"
                    }`}
                  >
                    <td className="px-2 py-1">
                      {loc.code}
                      {loc.id === activeLocationId && (
                        <span className="ml-1.5 rounded bg-blue-100 px-1 text-xs text-blue-800">
                          here
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {il.shop_sections?.display_name ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <InlineValue
                        table="inventory_item_locations"
                        id={il.id}
                        column="default_par"
                        value={il.default_par}
                        kind="number"
                        align="right"
                      />
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {vi ? (
                        <>
                          <span className="font-medium text-neutral-700">
                            {vi.vendors?.name ?? "—"}
                          </span>{" "}
                          {vendorItemLabel(vi)}
                          {vi.package_desc ? (
                            <span className="text-neutral-500"> · {vi.package_desc}</span>
                          ) : null}
                          <span className="ml-1 text-xs text-neutral-500">
                            {unitPriceLabel(vi, baseUnit)}
                          </span>
                        </>
                      ) : (
                        <span className="text-neutral-400">none</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {money(vi?.price)}
                    </td>
                    <td className="px-2 py-1">
                      <InlineValue
                        table="inventory_item_locations"
                        id={il.id}
                        column="note"
                        value={il.note}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <ActiveToggle
                        table="inventory_item_locations"
                        id={il.id}
                        active={il.is_active}
                        label={`Item active at ${loc.code}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        onClick={() => setExpanded(isOpen ? null : il.id)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
                      >
                        {isOpen ? "Hide" : "Edit"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-neutral-100 bg-neutral-50">
                      <td colSpan={8} className="px-2 py-3">
                        <FavoritesEditor
                          itemLocationId={il.id}
                          inventoryItemId={inventoryItemId}
                          orgId={orgId}
                          onChanged={() => router.refresh()}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
