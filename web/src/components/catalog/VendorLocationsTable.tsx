"use client";

import { money } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";

// ISO weekdays, 1 = Monday (CLAUDE.md).
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function days(list: number[] | null) {
  if (!list || list.length === 0) return "—";
  return [...list].sort((a, b) => a - b).map((d) => DAY_LABELS[d - 1] ?? d).join(" ");
}

// Sorting a weekday set on its canonical "1,3,5" string groups locations that
// share a schedule, which is what you're scanning for. Empty sorts last.
function daysKey(list: number[] | null) {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => a - b).join(",");
}

export type VendorLocationRow = {
  location_id: string;
  account_number: string | null;
  minimum_order: number | null;
  order_days: number[] | null;
  delivery_days: number[] | null;
  is_active: boolean;
};

/** A vendor's per-location config — account, minimum and days for each shop. */
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
      render: (r) => <span className="text-neutral-600">{r.account_number ?? "—"}</span>,
    },
    {
      key: "minimum",
      label: "Minimum",
      width: 115,
      align: "right",
      sortValue: (r) => (r.minimum_order === null ? null : Number(r.minimum_order)),
      render: (r) => <span className="text-neutral-600">{money(r.minimum_order)}</span>,
    },
    {
      key: "order_days",
      label: "Order days",
      width: 150,
      sortValue: (r) => daysKey(r.order_days),
      render: (r) => <span className="text-neutral-600">{days(r.order_days)}</span>,
    },
    {
      key: "delivery_days",
      label: "Delivery days",
      width: 150,
      sortValue: (r) => daysKey(r.delivery_days),
      render: (r) => <span className="text-neutral-600">{days(r.delivery_days)}</span>,
    },
    {
      key: "is_active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) => <span className="text-neutral-600">{r.is_active ? "yes" : "no"}</span>,
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
