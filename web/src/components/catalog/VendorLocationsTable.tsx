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
  sales_rep: string | null;
  rep_phone: string | null;
  rep_email: string | null;
};

/**
 * Rep fields live behind the disclosure; this is what you see without opening.
 * Nothing is shown when there's no rep — a "none" on every row would cost the
 * width that makes the summary useful on the rows that do have one.
 */
function repSummary(row: VendorLocationRow) {
  // Falls back to the email: plenty of migrated rows have only that, and a row
  // with contact details must never look empty from the outside.
  const parts = [row.sales_rep, row.rep_phone].filter(Boolean);
  if (parts.length === 0 && row.rep_email) return row.rep_email;
  return parts.length > 0 ? parts.join(" · ") : null;
}

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
    // Active leads on every catalog table (Mark, 2026-07-23).
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
    {
      key: "location",
      label: "Location",
      // Wide enough for the code, the "here" badge and the rep summary.
      width: 250,
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
      width: 235,
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
      width: 235,
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
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.location_id}
      storageKey="rf.vendorLocations.columnWidths.v1"
      defaultSort={{ key: "location" }}
      expand={{
        summary: repSummary,
        render: (r) => (
          <dl className="grid max-w-md grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="py-0.5 text-neutral-500">Sales rep</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="sales_rep"
                value={r.sales_rep}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-neutral-500">Phone</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="rep_phone"
                value={r.rep_phone}
                placeholder="none"
              />
            </dd>
            <dt className="py-0.5 text-neutral-500">Email</dt>
            <dd>
              <InlineValue
                table="vendor_locations"
                id={r.id}
                column="rep_email"
                value={r.rep_email}
                placeholder="none"
              />
            </dd>
          </dl>
        ),
      }}
      empty={
        <p className="text-sm text-neutral-600">Not configured at any location yet.</p>
      }
    />
  );
}
