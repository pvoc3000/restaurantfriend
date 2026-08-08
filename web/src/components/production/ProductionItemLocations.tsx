"use client";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";

export type ItemLocationRow = {
  id: string;
  location_id: string;
  par_by_weekday: number[] | null;
  price_override: number | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Per-shop par and price for one item.
 *
 * The par is 009's seven-slot array, slot n = weekday n, and it really does
 * vary by day: item 32 is 18 all week at DF02 and 18/18/18/18/24/36/36 at
 * DF01, because Friday and the weekend are busier.
 *
 * IT IS READ-ONLY HERE, deliberately and temporarily. `InlineValue` writes a
 * whole COLUMN, and a par cell has to write one SLOT of a Postgres array —
 * there is no `jsonPath` equivalent for that, so an editor means either a new
 * component holding the array in state or a widening of `InlineValue`. Showing
 * the seven numbers is most of the value and none of the risk; a half-built
 * editor that writes the wrong slot would be worse than none. The order guide
 * is where a par gets changed in anger anyway.
 *
 * Enumerating over ACTIVE locations, never all of them — design rule 3.
 */
export function ProductionItemLocations({
  pars,
  locations,
  gridPrice,
  editable,
}: {
  itemId: string;
  pars: ItemLocationRow[];
  locations: { id: string; code: string; name: string }[];
  /** What the grid says, so an override can be read against it. */
  gridPrice: number | null;
  editable: boolean;
}) {
  const byLocation = new Map(pars.map((p) => [p.location_id, p]));

  type Line = {
    location: { id: string; code: string; name: string };
    row: ItemLocationRow | null;
  };
  const lines: Line[] = locations.map((l) => ({
    location: l,
    row: byLocation.get(l.id) ?? null,
  }));

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
      key: "par",
      label: "Par by weekday",
      width: 340,
      render: (l) => (
        <span className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
          {WEEKDAYS.map((day, i) => (
            <span key={day} className="inline-flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-[0.08em] text-subtle">{day}</span>
              <span className={l.row?.par_by_weekday?.[i] == null ? "text-subtle" : ""}>
                {l.row?.par_by_weekday?.[i] ?? "–"}
              </span>
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "price",
      label: "Price here",
      width: 200,
      align: "right",
      sortValue: (l) => l.row?.price_override ?? null,
      render: (l) => {
        if (!l.row) {
          return <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>;
        }
        return (
          <span className="flex flex-col items-end">
            {editable ? (
              <InlineValue
                table="production_item_locations"
                id={l.row.id}
                column="price_override"
                kind="number"
                align="right"
                value={l.row.price_override}
                format={(v) => `$${Number(v).toFixed(2)}`}
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                {l.row.price_override === null ? "—" : `$${l.row.price_override.toFixed(2)}`}
              </span>
            )}
            {/* What it would be without the override, so the exception reads as
                one. Grey, because it is not in force. */}
            {l.row.price_override === null ? (
              <span className={`${READ_ONLY_VALUE} text-[12px] text-subtle`}>
                {gridPrice === null ? "no grid price" : `grid $${gridPrice.toFixed(2)}`}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <section>
      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.location.id}
        storageKey="production-item-locations"
        columnChooser
        leading={
          <div className="space-y-1">
            <SectionHeading count={pars.length}>Per location</SectionHeading>
            <p className="max-w-[80ch] text-[13px] text-muted">
              A par of “–” means this shop has no par for that day. A price here
              overrides the grid for this item at this shop only.
            </p>
          </div>
        }
      />
    </section>
  );
}
