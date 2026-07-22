"use client";

import { money } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { WeekdayPicker } from "./WeekdayPicker";

// Sorting a weekday set on its canonical "1,3,5" string groups locations that
// share a schedule, which is what you're scanning for. Empty sorts last.
function daysKey(list: number[] | null) {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => a - b).join(",");
}

export type VendorLocationRow = {
  id: string;
  location_id: string;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
};

/**
 * A vendor's per-location config — account, minimum and days for each shop.
 * Editable in place (spec §4.8 puts this on the vendor screen); writes go
 * through RLS, which requires purchaser or above.
 */
export function VendorLocationsTable({
  rows,
  codeById,
  activeLocationId,
}: {
  rows: VendorLocationRow[];
  codeById: Record<string, string>;
  activeLocationId: string | null;
}) {
  const columns: DataColumn<VendorLocationRow>[] = [
    {
      key: "location",
      label: "Location",
      width: 130,
      sortValue: (r) => codeById[r.location_id] ?? null,
      render: (r) => (
        <>
          {codeById[r.location_id] ?? "—"}
          {r.location_id === activeLocationId && (
            <span className="ml-1.5 rounded bg-blue-100 px-1 text-xs text-blue-800">
              here
            </span>
          )}
        </>
      ),
    },
    {
      key: "account",
      label: "Account",
      width: 140,
      sortValue: (r) => r.account_number,
      render: (r) => (
        <InlineValue
          table="vendor_locations"
          id={r.id}
          column="account_number"
          value={r.account_number}
        />
      ),
    },
    {
      key: "minimum",
      label: "Minimum",
      width: 115,
      align: "right",
      sortValue: (r) => (r.minimum_order === null ? null : Number(r.minimum_order)),
      render: (r) => (
        <InlineValue
          table="vendor_locations"
          id={r.id}
          column="minimum_order"
          value={r.minimum_order}
          kind="number"
          align="right"
          format={(v) => money(Number(v))}
        />
      ),
    },
    {
      key: "order_days",
      label: "Order days",
      width: 190,
      sortValue: (r) => daysKey(r.order_days),
      render: (r) => (
        <WeekdayPicker
          table="vendor_locations"
          id={r.id}
          column="order_days"
          value={r.order_days}
          label="Order day"
        />
      ),
    },
    {
      key: "delivery_days",
      label: "Delivery days",
      width: 190,
      sortValue: (r) => daysKey(r.delivery_days),
      render: (r) => (
        <WeekdayPicker
          table="vendor_locations"
          id={r.id}
          column="delivery_days"
          value={r.delivery_days}
          label="Delivery day"
        />
      ),
    },
    {
      key: "is_active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) => (
        <ActiveToggle
          table="vendor_locations"
          id={r.id}
          active={r.is_active}
          label="Vendor active at this location"
        />
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.location_id}
      storageKey="rf.vendorLocations.columnWidths.v1"
      defaultSort={{ key: "location" }}
      empty={
        <p className="text-sm text-neutral-600">Not configured at any location yet.</p>
      }
    />
  );
}
