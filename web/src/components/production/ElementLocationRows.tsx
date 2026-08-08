"use client";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";

export type ElementLocationRow = {
  id: string;
  location_id: string;
  par_by_weekday: number[] | null;
  stock_count: number | null;
  stock_size: number | null;
  stock_unit: string | null;
  is_active: boolean;
};

/**
 * What each shop keeps on hand — the stock-up par, per location.
 *
 * FileMaker kept this as free text on the ELEMENT ("6x 1.5 GAL", "10 BAGS",
 * and one row reading "?"), with a calculation showing whichever location you
 * happened to be standing in. It is really per (element, location) — the export
 * proves it, DF01 49 rows and DF02 11 — so migration 036 gives it
 * `inventory_item_locations`' shape and the text parses to count × size × unit,
 * which is the batch log's own shape and the only form that can be multiplied.
 *
 * Enumerating over `activeLocations`, never `locations` — design rule 3: a row
 * per location is exactly the case where three closed shops would sprout dead
 * rows.
 */
export function ElementLocationRows({
  rows,
  locations,
  editable,
}: {
  elementId: string;
  rows: ElementLocationRow[];
  locations: { id: string; code: string; name: string }[];
  orgId: string;
  editable: boolean;
}) {
  const byLocation = new Map(rows.map((r) => [r.location_id, r]));

  type Line = { location: { id: string; code: string; name: string }; row: ElementLocationRow | null };
  const lines: Line[] = locations.map((l) => ({ location: l, row: byLocation.get(l.id) ?? null }));

  const columns: DataColumn<Line>[] = [
    {
      key: "location",
      label: "Location",
      width: 200,
      pinned: true,
      sortValue: (l) => l.location.code,
      render: (l) => (
        <span>
          <span className="font-medium">{l.location.code}</span>
          <span className="ml-2 text-muted">{l.location.name}</span>
        </span>
      ),
    },
    {
      key: "stock",
      label: "Keeps on hand",
      width: 320,
      wrap: true,
      sortValue: (l) => l.row?.stock_count ?? null,
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : editable ? (
          <span className="flex flex-wrap items-baseline gap-1">
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_count"
              kind="number"
              value={l.row.stock_count}
            />
            <span className="text-subtle">×</span>
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_size"
              kind="number"
              value={l.row.stock_size}
            />
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_unit"
              value={l.row.stock_unit}
            />
          </span>
        ) : (
          <span className={READ_ONLY_VALUE}>{describeStock(l.row)}</span>
        ),
    },
    {
      key: "par",
      label: "Par by weekday",
      width: 320,
      sortValue: undefined,
      render: (l) => (
        <span className="text-muted tabular-nums">
          {l.row?.par_by_weekday?.some((v) => v !== null)
            ? l.row.par_by_weekday
                .map((v) => (v === null ? "–" : String(v)))
                .join("  ")
            : "—"}
        </span>
      ),
    },
  ];

  return (
    <section>
      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.location.id}
        storageKey="production-element-locations"
        columnChooser
        leading={<SectionHeading count={rows.length}>Per location</SectionHeading>}
      />
    </section>
  );
}

/** "6 × 1.5 GAL", "10 BAGS", or an em dash. */
function describeStock(row: ElementLocationRow): string {
  if (row.stock_count === null) return "—";
  const size = row.stock_size === null ? "" : ` × ${row.stock_size}`;
  const unit = row.stock_unit ? ` ${row.stock_unit}` : "";
  return `${row.stock_count}${size}${unit}`;
}
